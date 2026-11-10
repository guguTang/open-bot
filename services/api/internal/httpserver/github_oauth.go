package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const githubOAuthScopes = "read:user admin:repo_hook"

var (
	githubOAuthTokenURL = "https://github.com/login/oauth/access_token"
	githubAPIBase       = "https://api.github.com"
	githubRepoPattern   = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	githubHookEvents    = []string{"pull_request", "issues", "check_suite", "workflow_run", "push"}
)

type githubOAuthConfig struct {
	ClientID      string
	ClientSecret  string
	RedirectURI   string
	WebOrigin     string
	AppID         string
	AppSlug       string
	AppPrivateKey string
}

func loadGitHubOAuthConfig() githubOAuthConfig {
	return githubOAuthConfig{
		ClientID:     strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(os.Getenv("GITHUB_CLIENT_SECRET")),
		RedirectURI: strings.TrimSpace(firstNonEmpty(
			os.Getenv("GITHUB_OAUTH_REDIRECT_URI"),
			"http://127.0.0.1:18080/v1/integrations/github/callback",
		)),
		WebOrigin:     installWebOrigin(),
		AppID:         strings.TrimSpace(os.Getenv("GITHUB_APP_ID")),
		AppSlug:       strings.TrimSpace(os.Getenv("GITHUB_APP_SLUG")),
		AppPrivateKey: loadGitHubAppPrivateKey(),
	}
}

func loadGitHubAppPrivateKey() string {
	raw := strings.TrimSpace(os.Getenv("GITHUB_APP_PRIVATE_KEY"))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("GITHUB_APP_PRIVATE_KEY_FILE"))
		if raw == "" {
			return ""
		}
		b, err := os.ReadFile(raw)
		if err != nil {
			log.Printf("github oauth: read private key file: %v", err)
			return ""
		}
		return string(b)
	}
	if !strings.Contains(raw, "BEGIN") {
		if st, err := os.Stat(raw); err == nil && !st.IsDir() {
			b, err := os.ReadFile(raw)
			if err == nil {
				return string(b)
			}
		}
	}
	return strings.ReplaceAll(raw, `\n`, "\n")
}

func (c githubOAuthConfig) OAuthEnabled() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.RedirectURI != ""
}

func (c githubOAuthConfig) AppEnabled() bool {
	return c.AppID != "" && c.AppSlug != "" && strings.TrimSpace(c.AppPrivateKey) != ""
}

func (c githubOAuthConfig) Enabled() bool {
	return c.OAuthEnabled() || c.AppEnabled()
}

// Mode is github_app when the App id, slug, and private key are all set.
// That install path takes precedence over the OAuth App client.
func (c githubOAuthConfig) Mode() string {
	if c.AppEnabled() {
		return "github_app"
	}
	if c.OAuthEnabled() {
		return "oauth"
	}
	return ""
}

func (c githubOAuthConfig) authorizeURL(state string) string {
	if c.AppEnabled() {
		return "https://github.com/apps/" + url.PathEscape(c.AppSlug) + "/installations/new?state=" + url.QueryEscape(state)
	}
	q := url.Values{}
	q.Set("client_id", c.ClientID)
	q.Set("redirect_uri", c.RedirectURI)
	q.Set("scope", githubOAuthScopes)
	q.Set("state", state)
	return "https://github.com/login/oauth/authorize?" + q.Encode()
}

func normalizeGitHubRepo(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "https://github.com/")
	raw = strings.TrimPrefix(raw, "http://github.com/")
	raw = strings.TrimSuffix(raw, ".git")
	raw = strings.Trim(raw, "/")
	if i := strings.Index(raw, "?"); i >= 0 {
		raw = raw[:i]
	}
	if raw == "" {
		return "", nil
	}
	if !githubRepoPattern.MatchString(raw) {
		return "", errors.New("repo must look like owner/name")
	}
	return raw, nil
}

type githubCredential struct {
	AccessToken    string
	RefreshToken   string
	Scope          string
	Account        string
	ExpiresIn      int
	InstallationID string
	Mode           string
}

var (
	fetchGitHubCredential = defaultFetchGitHubCredential
	registerGitHubWebhook = defaultRegisterGitHubWebhook
	removeGitHubWebhook   = defaultRemoveGitHubWebhook
)

func (s *Server) handleGitHubStatus(w http.ResponseWriter, r *http.Request) {
	cfg := loadGitHubOAuthConfig()
	writeJSON(w, http.StatusOK, s.installStatusPayload(userIDFrom(r.Context()), githubProvider, cfg.Enabled()))
}

func (s *Server) handleGitHubStart(w http.ResponseWriter, r *http.Request) {
	cfg := loadGitHubOAuthConfig()
	if !cfg.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "GitHub 安装未配置：请设置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_OAUTH_REDIRECT_URI，或 GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_PRIVATE_KEY",
		})
		return
	}
	var body struct {
		Repo string `json:"repo"`
	}
	if err := readOptionalJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	repo, err := normalizeGitHubRepo(body.Repo)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	state, err := issueInstallOAuthState(githubProvider, userIDFrom(r.Context()), repo)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to issue oauth state"})
		return
	}
	setInstallOAuthStateCookie(w, githubProvider, state)
	writeJSON(w, http.StatusOK, map[string]any{
		"authorize_url": cfg.authorizeURL(state),
		"state":         state,
		"mode":          cfg.Mode(),
		"repo":          repo,
	})
}

func (s *Server) handleGitHubCallback(w http.ResponseWriter, r *http.Request) {
	cfg := loadGitHubOAuthConfig()
	webFail := func(msg string) {
		http.Redirect(w, r, installWebRedirect(cfg.WebOrigin, githubProvider, "err", msg), http.StatusFound)
	}
	if !cfg.Enabled() {
		webFail("oauth_not_configured")
		return
	}
	raw := r.URL.RawQuery
	if errParam := strings.TrimSpace(gmailQueryParam(raw, "error")); errParam != "" {
		webFail(errParam)
		return
	}
	code := strings.TrimSpace(gmailQueryParam(raw, "code"))
	state := strings.TrimSpace(gmailQueryParam(raw, "state"))
	installationID := strings.TrimSpace(gmailQueryParam(raw, "installation_id"))
	if state == "" || (code == "" && installationID == "") {
		webFail("missing_code_or_state")
		return
	}
	if err := verifyOptionalOAuthStateCookie(r, installOAuthStateCookie(githubProvider), state); err != nil {
		webFail("invalid_state")
		return
	}
	userID, repoExtra, err := parseInstallOAuthState(githubProvider, state)
	if err != nil || userID == "" {
		if err != nil && strings.Contains(err.Error(), "expired") {
			webFail("state_expired")
			return
		}
		webFail("invalid_state")
		return
	}
	repo, err := normalizeGitHubRepo(repoExtra)
	if err != nil {
		webFail("invalid_repo")
		return
	}
	if installationID != "" && !cfg.AppEnabled() && code == "" {
		webFail("github_app_not_configured")
		return
	}
	cred, err := fetchGitHubCredential(r.Context(), cfg, code, installationID)
	if err != nil {
		log.Printf("github oauth: token exchange failed: %v", sanitizeGmailOAuthLog(err.Error()))
		webFail(mapGitHubInstallError(err))
		return
	}
	if err := s.storeGitHubInstall(r.Context(), userID, cred, repo); err != nil {
		log.Printf("github oauth: store failed: %v", sanitizeGmailOAuthLog(err.Error()))
		webFail(installStoreErrorCode(err))
		return
	}
	clearInstallOAuthStateCookie(w, githubProvider)
	http.Redirect(w, r, installWebRedirect(cfg.WebOrigin, githubProvider, "ok", ""), http.StatusFound)
}

func (s *Server) handleGitHubDisconnect(w http.ResponseWriter, r *http.Request) {
	res, err := s.disconnectOAuthInstall(r.Context(), userIDFrom(r.Context()), githubProvider)
	writeInstallDisconnect(w, res, err)
}

func (s *Server) handleGitHubAttach(w http.ResponseWriter, r *http.Request) {
	cfg := loadGitHubOAuthConfig()
	if !cfg.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "GitHub 安装未配置",
		})
		return
	}
	var body struct {
		Repo string `json:"repo"`
	}
	if err := readOptionalJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	repo, err := normalizeGitHubRepo(body.Repo)
	if err != nil || repo == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "repo must look like owner/name"})
		return
	}
	uid := userIDFrom(r.Context())
	if err := s.attachGitHubRepo(r.Context(), uid, repo); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": sanitizeGmailOAuthLog(err.Error())})
		return
	}
	writeJSON(w, http.StatusOK, s.installStatusPayload(uid, githubProvider, true))
}

func (s *Server) storeGitHubInstall(ctx context.Context, userID string, cred *githubCredential, repo string) error {
	if cred == nil || strings.TrimSpace(cred.AccessToken) == "" {
		return errors.New("missing bot token")
	}
	linked := ""
	if prev, err := s.db.GetOAuthConnection(userID, githubProvider); err == nil && prev != nil {
		linked = prev.LinkedHookID
	}
	hook, err := s.ensureOAuthInstallHook(userID, githubProvider, linked)
	if err != nil {
		return err
	}
	accessCT, err := encryptInstallSecret(cred.AccessToken)
	if err != nil {
		return err
	}
	refreshCT := ""
	if strings.TrimSpace(cred.RefreshToken) != "" {
		refreshCT, err = encryptInstallSecret(cred.RefreshToken)
		if err != nil {
			return err
		}
	}
	var expiry *time.Time
	if cred.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(cred.ExpiresIn) * time.Second)
		expiry = &t
	}
	account := firstNonEmpty(cred.Account, cred.InstallationID)
	meta := installMeta{
		Mode:           firstNonEmpty(cred.Mode, "oauth"),
		Account:        account,
		InstallationID: cred.InstallationID,
		Repo:           repo,
	}
	if repo != "" {
		remoteID, aerr := registerGitHubWebhook(ctx, cred.AccessToken, repo, installHookURL(githubProvider, hook.Token), hook.Secret)
		if aerr != nil {
			meta.WebhookAttached = false
			meta.AttachError = sanitizeGmailOAuthLog(aerr.Error())
			log.Printf("github oauth: attach webhook %s: %v", repo, sanitizeGmailOAuthLog(aerr.Error()))
		} else {
			meta.WebhookAttached = true
			meta.RemoteHookID = remoteID
			meta.AttachError = ""
		}
	}
	_, err = s.db.UpsertOAuthInstall(
		userID, githubProvider, account, cred.Scope, accessCT, refreshCT, hook.ID, meta.JSON(), expiry,
	)
	return err
}

func (s *Server) attachGitHubRepo(ctx context.Context, userID, repo string) error {
	conn, err := s.db.GetOAuthConnection(userID, githubProvider)
	if err != nil || conn == nil {
		return errors.New("尚未连接 GitHub")
	}
	token, err := s.githubAPIToken(ctx, conn)
	if err != nil {
		return err
	}
	hook, err := s.ensureOAuthInstallHook(userID, githubProvider, conn.LinkedHookID)
	if err != nil {
		return err
	}
	remoteID, aerr := registerGitHubWebhook(ctx, token, repo, installHookURL(githubProvider, hook.Token), hook.Secret)
	meta := parseInstallMeta(conn.MetadataJSON)
	meta.Repo = repo
	if aerr != nil {
		meta.WebhookAttached = false
		meta.AttachError = sanitizeGmailOAuthLog(aerr.Error())
	} else {
		meta.WebhookAttached = true
		meta.RemoteHookID = remoteID
		meta.AttachError = ""
	}
	if _, err := s.db.UpsertOAuthInstall(
		userID, githubProvider, conn.AccountEmail, conn.Scopes, conn.AccessTokenCT, conn.RefreshTokenCT,
		hook.ID, meta.JSON(), conn.TokenExpiry,
	); err != nil {
		return err
	}
	return aerr
}

func (s *Server) githubAPIToken(ctx context.Context, conn *db.OAuthConnection) (string, error) {
	if conn == nil {
		return "", errors.New("尚未连接 GitHub")
	}
	meta := parseInstallMeta(conn.MetadataJSON)
	needRefresh := conn.TokenExpiry != nil && time.Now().After(conn.TokenExpiry.Add(-60*time.Second))
	if !needRefresh {
		tok, err := decryptInstallSecret(conn.AccessTokenCT)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(tok) != "" {
			return tok, nil
		}
	}
	cfg := loadGitHubOAuthConfig()
	if meta.InstallationID != "" && cfg.AppEnabled() {
		tok, exp, err := mintGitHubInstallationToken(ctx, cfg, meta.InstallationID)
		if err != nil {
			return "", err
		}
		accessCT, err := encryptInstallSecret(tok)
		if err != nil {
			return "", err
		}
		var expiry *time.Time
		if exp > 0 {
			t := time.Now().Add(time.Duration(exp) * time.Second)
			expiry = &t
		}
		_ = s.db.UpdateOAuthTokens(conn.UserID, githubProvider, accessCT, "", expiry)
		return tok, nil
	}
	if strings.TrimSpace(conn.RefreshTokenCT) != "" && cfg.OAuthEnabled() {
		refresh, err := decryptInstallSecret(conn.RefreshTokenCT)
		if err != nil {
			return "", err
		}
		tok, exp, newRefresh, err := refreshGitHubUserToken(ctx, cfg, refresh)
		if err != nil {
			return "", err
		}
		accessCT, err := encryptInstallSecret(tok)
		if err != nil {
			return "", err
		}
		refreshCT := ""
		if strings.TrimSpace(newRefresh) != "" {
			refreshCT, _ = encryptInstallSecret(newRefresh)
		}
		var expiry *time.Time
		if exp > 0 {
			t := time.Now().Add(time.Duration(exp) * time.Second)
			expiry = &t
		}
		_ = s.db.UpdateOAuthTokens(conn.UserID, githubProvider, accessCT, refreshCT, expiry)
		return tok, nil
	}
	if !needRefresh {
		return "", errors.New("github token missing")
	}
	return "", errors.New("github token expired")
}

// bestEffortRemoveGitHubRemoteHook deletes only the webhook id we stored when
// attaching. Other webhooks on the repository are left in place.
func (s *Server) bestEffortRemoveGitHubRemoteHook(ctx context.Context, conn *db.OAuthConnection) {
	if conn == nil {
		return
	}
	meta := parseInstallMeta(conn.MetadataJSON)
	if meta.RemoteHookID <= 0 || strings.TrimSpace(meta.Repo) == "" {
		return
	}
	token, err := s.githubAPIToken(ctx, conn)
	if err != nil {
		log.Printf("github oauth: skip remote hook delete: %v", sanitizeGmailOAuthLog(err.Error()))
		return
	}
	if err := removeGitHubWebhook(ctx, token, meta.Repo, meta.RemoteHookID); err != nil {
		log.Printf("github oauth: remote hook delete repo=%s id=%d: %v", meta.Repo, meta.RemoteHookID, sanitizeGmailOAuthLog(err.Error()))
	}
}

func defaultFetchGitHubCredential(ctx context.Context, cfg githubOAuthConfig, code, installationID string) (*githubCredential, error) {
	if installationID != "" && cfg.AppEnabled() {
		tok, exp, err := mintGitHubInstallationToken(ctx, cfg, installationID)
		if err != nil {
			return nil, err
		}
		account, _ := githubInstallationAccount(ctx, cfg, installationID)
		return &githubCredential{
			AccessToken:    tok,
			Scope:          "installation",
			Account:        account,
			ExpiresIn:      exp,
			InstallationID: installationID,
			Mode:           "github_app",
		}, nil
	}
	if strings.TrimSpace(code) == "" {
		return nil, errors.New("missing code")
	}
	if !cfg.OAuthEnabled() {
		return nil, errors.New("github oauth client not configured")
	}
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", cfg.RedirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, githubOAuthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "open-bot")
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("token network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		Scope        string `json:"scope"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		ErrorDesc    string `json:"error_description"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, fmt.Errorf("token parse: %w", err)
	}
	if tok.Error != "" || strings.TrimSpace(tok.AccessToken) == "" {
		msg := tok.Error
		if tok.ErrorDesc != "" {
			msg = msg + ": " + tok.ErrorDesc
		}
		if msg == "" {
			msg = fmt.Sprintf("token http %d", res.StatusCode)
		}
		return nil, errors.New(msg)
	}
	login, err := githubUserLogin(ctx, tok.AccessToken)
	if err != nil {
		return nil, err
	}
	return &githubCredential{
		AccessToken:  tok.AccessToken,
		RefreshToken: tok.RefreshToken,
		Scope:        tok.Scope,
		Account:      login,
		ExpiresIn:    tok.ExpiresIn,
		Mode:         "oauth",
	}, nil
}

func githubUserLogin(ctx context.Context, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPIBase+"/user", nil)
	if err != nil {
		return "", err
	}
	setGitHubAuth(req, token)
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("token network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("github user http %d", res.StatusCode)
	}
	var body struct {
		Login string `json:"login"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", err
	}
	login := strings.TrimSpace(body.Login)
	if login == "" {
		return "", errors.New("github user missing login")
	}
	return login, nil
}

func githubInstallationAccount(ctx context.Context, cfg githubOAuthConfig, installationID string) (string, error) {
	jwtTok, err := githubAppJWT(cfg.AppID, cfg.AppPrivateKey)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubAPIBase+"/app/installations/"+url.PathEscape(installationID), nil)
	if err != nil {
		return "", err
	}
	setGitHubAuth(req, jwtTok)
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("installation http %d", res.StatusCode)
	}
	var body struct {
		Account struct {
			Login string `json:"login"`
		} `json:"account"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", err
	}
	return strings.TrimSpace(body.Account.Login), nil
}

func mintGitHubInstallationToken(ctx context.Context, cfg githubOAuthConfig, installationID string) (string, int, error) {
	installationID = strings.TrimSpace(installationID)
	if installationID == "" {
		return "", 0, errors.New("installation_id required")
	}
	jwtTok, err := githubAppJWT(cfg.AppID, cfg.AppPrivateKey)
	if err != nil {
		return "", 0, err
	}
	u := githubAPIBase + "/app/installations/" + url.PathEscape(installationID) + "/access_tokens"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader("{}"))
	if err != nil {
		return "", 0, err
	}
	setGitHubAuth(req, jwtTok)
	req.Header.Set("Content-Type", "application/json")
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("token network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var body struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
		Message   string `json:"message"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return "", 0, fmt.Errorf("token parse: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 || strings.TrimSpace(body.Token) == "" {
		msg := strings.TrimSpace(body.Message)
		if msg == "" {
			msg = fmt.Sprintf("installation token http %d", res.StatusCode)
		}
		return "", 0, errors.New(msg)
	}
	exp := 50 * 60
	if t, err := time.Parse(time.RFC3339, body.ExpiresAt); err == nil {
		sec := int(time.Until(t).Seconds())
		if sec > 30 {
			exp = sec
		}
	}
	return body.Token, exp, nil
}

func refreshGitHubUserToken(ctx context.Context, cfg githubOAuthConfig, refreshToken string) (string, int, string, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, githubOAuthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "open-bot")
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return "", 0, "", fmt.Errorf("token network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
	}
	if err := json.Unmarshal(raw, &tok); err != nil {
		return "", 0, "", err
	}
	if tok.Error != "" || strings.TrimSpace(tok.AccessToken) == "" {
		msg := tok.Error
		if msg == "" {
			msg = fmt.Sprintf("refresh http %d", res.StatusCode)
		}
		return "", 0, "", errors.New(msg)
	}
	return tok.AccessToken, tok.ExpiresIn, tok.RefreshToken, nil
}

func githubAppJWT(appID, privateKeyPEM string) (string, error) {
	key, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(privateKeyPEM))
	if err != nil {
		return "", fmt.Errorf("github app private key: %w", err)
	}
	claims := jwt.RegisteredClaims{
		Issuer:    strings.TrimSpace(appID),
		IssuedAt:  jwt.NewNumericDate(time.Now().Add(-60 * time.Second)),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Minute)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
}

func setGitHubAuth(req *http.Request, token string) {
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "open-bot")
}

func githubRepoAPI(repo, suffix string) (string, error) {
	repo, err := normalizeGitHubRepo(repo)
	if err != nil || repo == "" {
		return "", errors.New("repo must look like owner/name")
	}
	parts := strings.Split(repo, "/")
	return githubAPIBase + "/repos/" + url.PathEscape(parts[0]) + "/" + url.PathEscape(parts[1]) + suffix, nil
}

func githubInsecureSSL(hookURL string) string {
	if strings.HasPrefix(strings.ToLower(hookURL), "http://") {
		return "1"
	}
	return "0"
}

func defaultRegisterGitHubWebhook(ctx context.Context, token, repo, hookURL, secret string) (int64, error) {
	endpoint, err := githubRepoAPI(repo, "/hooks")
	if err != nil {
		return 0, err
	}
	payload, _ := json.Marshal(map[string]any{
		"name":   "web",
		"active": true,
		"events": githubHookEvents,
		"config": map[string]string{
			"url":          hookURL,
			"content_type": "json",
			"secret":       secret,
			"insecure_ssl": githubInsecureSSL(hookURL),
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	setGitHubAuth(req, token)
	req.Header.Set("Content-Type", "application/json")
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return 0, fmt.Errorf("token network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		var created struct {
			ID int64 `json:"id"`
		}
		if err := json.Unmarshal(raw, &created); err != nil {
			return 0, err
		}
		if created.ID == 0 {
			return 0, errors.New("github hook id missing")
		}
		return created.ID, nil
	}
	msg := githubAPIError(raw, res.StatusCode)
	if res.StatusCode == http.StatusUnprocessableEntity || strings.Contains(strings.ToLower(msg), "already exists") {
		if id, ferr := findGitHubHookByURL(ctx, token, repo, hookURL); ferr == nil && id > 0 {
			return id, nil
		}
	}
	return 0, errors.New(msg)
}

func findGitHubHookByURL(ctx context.Context, token, repo, hookURL string) (int64, error) {
	endpoint, err := githubRepoAPI(repo, "/hooks?per_page=100")
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	setGitHubAuth(req, token)
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return 0, errors.New(githubAPIError(raw, res.StatusCode))
	}
	var list []struct {
		ID     int64 `json:"id"`
		Config struct {
			URL string `json:"url"`
		} `json:"config"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return 0, err
	}
	for _, h := range list {
		if h.Config.URL == hookURL && h.ID > 0 {
			return h.ID, nil
		}
	}
	return 0, errors.New("github hook already exists but url was not found")
}

func defaultRemoveGitHubWebhook(ctx context.Context, token, repo string, hookID int64) error {
	if hookID <= 0 {
		return errors.New("hook id required")
	}
	endpoint, err := githubRepoAPI(repo, "/hooks/"+fmt.Sprint(hookID))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	setGitHubAuth(req, token)
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusNotFound || (res.StatusCode >= 200 && res.StatusCode < 300) {
		return nil
	}
	return errors.New(githubAPIError(raw, res.StatusCode))
}

func githubAPIError(raw []byte, status int) string {
	var body struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &body)
	msg := strings.TrimSpace(body.Message)
	if msg == "" {
		msg = fmt.Sprintf("github http %d", status)
	}
	if len(msg) > 300 {
		msg = msg[:300] + "…"
	}
	return msg
}

func mapGitHubInstallError(err error) string {
	if err == nil {
		return "token_exchange_failed"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "private key"):
		return "github_app_key_invalid"
	case strings.Contains(msg, "github oauth client not configured"):
		return "github_app_not_configured"
	default:
		return mapGmailTokenExchangeError(err)
	}
}
