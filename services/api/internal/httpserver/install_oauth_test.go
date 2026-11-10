package httpserver

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func setInstallTestEnv(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", "test-install-oauth-state-secret")
	t.Setenv("BOT_SECRETS_KEY", "dev-bot-secrets-key-change-me!!")
	t.Setenv("SLACK_CLIENT_ID", "slack-cid")
	t.Setenv("SLACK_CLIENT_SECRET", "slack-sec")
	t.Setenv("SLACK_OAUTH_REDIRECT_URI", "http://127.0.0.1:18080/v1/integrations/slack/callback")
	t.Setenv("GITHUB_CLIENT_ID", "gh-cid")
	t.Setenv("GITHUB_CLIENT_SECRET", "gh-sec")
	t.Setenv("GITHUB_OAUTH_REDIRECT_URI", "http://127.0.0.1:18080/v1/integrations/github/callback")
	t.Setenv("GITHUB_APP_ID", "")
	t.Setenv("GITHUB_APP_SLUG", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY_FILE", "")
	t.Setenv("OPENBOT_WEB_ORIGIN", "http://127.0.0.1:5173")
	t.Setenv("OPENBOT_PUBLIC_API_ORIGIN", "https://api.example.test")
}

func TestIssueParseInstallOAuthState(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-install-oauth-state-secret")
	state, err := issueInstallOAuthState(slackProvider, "user-123", "")
	if err != nil {
		t.Fatal(err)
	}
	uid, extra, err := parseInstallOAuthState(slackProvider, state)
	if err != nil {
		t.Fatal(err)
	}
	if uid != "user-123" || extra != "" {
		t.Fatalf("uid=%q extra=%q", uid, extra)
	}
	gh, err := issueInstallOAuthState(githubProvider, "user-9", "octo/hello")
	if err != nil {
		t.Fatal(err)
	}
	uid, extra, err = parseInstallOAuthState(githubProvider, gh)
	if err != nil {
		t.Fatal(err)
	}
	if uid != "user-9" || extra != "octo/hello" {
		t.Fatalf("uid=%q extra=%q", uid, extra)
	}
}

func TestInstallOAuthStateProviderIsolation(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-install-oauth-state-secret")
	slackState, err := issueInstallOAuthState(slackProvider, "user-123", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := parseInstallOAuthState(githubProvider, slackState); err == nil {
		t.Fatal("slack state must not parse as github")
	}
	ghState, err := issueInstallOAuthState(githubProvider, "user-123", "octo/hello")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := parseInstallOAuthState(slackProvider, ghState); err == nil {
		t.Fatal("github state must not parse as slack")
	}
	gmailState, err := issueGmailOAuthState("user-123")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := parseInstallOAuthState(slackProvider, gmailState); err == nil {
		t.Fatal("gmail state must not parse as slack")
	}
	if _, err := parseGmailOAuthState(slackState); err == nil {
		t.Fatal("slack state must not parse as gmail")
	}
}

func TestInstallOAuthStateRejectsTamperAndExpiry(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-install-oauth-state-secret")
	state, err := issueInstallOAuthState(slackProvider, "user-123", "")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(state, ".")
	parts[1] = "AAAA" + parts[1]
	if _, _, err := parseInstallOAuthState(slackProvider, parts[0]+"."+parts[1]); err == nil {
		t.Fatal("expected tamper rejection")
	}
	expired, err := issueInstallOAuthStateAt(slackProvider, "user-123", "", time.Now().Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := parseInstallOAuthState(slackProvider, expired); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired, got %v", err)
	}
}

func TestVerifyOptionalOAuthStateCookie(t *testing.T) {
	state := "signed.state.value"
	req := httptest.NewRequest(http.MethodGet, "/callback", nil)
	if err := verifyOptionalOAuthStateCookie(req, installOAuthStateCookie(slackProvider), state); err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: installOAuthStateCookie(slackProvider), Value: state})
	if err := verifyOptionalOAuthStateCookie(req, installOAuthStateCookie(slackProvider), state); err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: installOAuthStateCookie(githubProvider), Value: "other"})
	if err := verifyOptionalOAuthStateCookie(req, installOAuthStateCookie(slackProvider), state); err != nil {
		t.Fatal("github cookie must not fail slack check when slack cookie matches")
	}
	bad := httptest.NewRequest(http.MethodGet, "/callback", nil)
	bad.AddCookie(&http.Cookie{Name: installOAuthStateCookie(slackProvider), Value: "nope"})
	if err := verifyOptionalOAuthStateCookie(bad, installOAuthStateCookie(slackProvider), state); err == nil {
		t.Fatal("expected mismatch")
	}
}

func TestLoadSlackOAuthConfigDisabled(t *testing.T) {
	t.Setenv("SLACK_CLIENT_ID", "")
	t.Setenv("SLACK_CLIENT_SECRET", "")
	if loadSlackOAuthConfig().Enabled() {
		t.Fatal("expected disabled")
	}
}

func TestSlackStartUnconfigured(t *testing.T) {
	t.Setenv("SLACK_CLIENT_ID", "")
	t.Setenv("SLACK_CLIENT_SECRET", "")
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/v1/integrations/slack/start", strings.NewReader("{}"))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec := httptest.NewRecorder()
	s.handleSlackStart(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "SLACK_CLIENT_ID") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestSlackStatusUnconfigured(t *testing.T) {
	t.Setenv("SLACK_CLIENT_ID", "")
	t.Setenv("SLACK_CLIENT_SECRET", "")
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/v1/integrations/slack", nil)
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec := httptest.NewRecorder()
	s.handleSlackStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["oauth_configured"] != false || body["connected"] != false {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestGitHubStartUnconfigured(t *testing.T) {
	t.Setenv("GITHUB_CLIENT_ID", "")
	t.Setenv("GITHUB_CLIENT_SECRET", "")
	t.Setenv("GITHUB_APP_ID", "")
	t.Setenv("GITHUB_APP_SLUG", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "")
	t.Setenv("GITHUB_APP_PRIVATE_KEY_FILE", "")
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/v1/integrations/github/start", strings.NewReader("{}"))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec := httptest.NewRecorder()
	s.handleGitHubStart(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestGitHubStartCarriesRepoInState(t *testing.T) {
	setInstallTestEnv(t)
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/v1/integrations/github/start", strings.NewReader(`{"repo":"https://github.com/octo/hello.git"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-77"))
	rec := httptest.NewRecorder()
	s.handleGitHubStart(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["mode"] != "oauth" {
		t.Fatalf("mode=%v", body["mode"])
	}
	authURL, _ := body["authorize_url"].(string)
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(authURL, "github.com/login/oauth/authorize") || !strings.Contains(parsed.Query().Get("scope"), "admin:repo_hook") {
		t.Fatalf("authorize_url=%s", authURL)
	}
	uid, extra, err := parseInstallOAuthState(githubProvider, body["state"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if uid != "user-77" || extra != "octo/hello" {
		t.Fatalf("uid=%q extra=%q", uid, extra)
	}
}

func TestGitHubAppStartURL(t *testing.T) {
	setInstallTestEnv(t)
	t.Setenv("GITHUB_APP_ID", "99")
	t.Setenv("GITHUB_APP_SLUG", "open-bot")
	t.Setenv("GITHUB_APP_PRIVATE_KEY", "not-a-real-key")
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/v1/integrations/github/start", strings.NewReader(`{}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec := httptest.NewRecorder()
	s.handleGitHubStart(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "github.com/apps/open-bot/installations/new") {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestInstallCallbackRejectsCrossProviderState(t *testing.T) {
	setInstallTestEnv(t)
	slackState, err := issueInstallOAuthState(slackProvider, "user-1", "")
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/cb?code=abc&state="+url.QueryEscape(slackState), nil)
	rec := httptest.NewRecorder()
	s.handleGitHubCallback(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "github_error=invalid_state") {
		t.Fatalf("code=%d loc=%s", rec.Code, rec.Header().Get("Location"))
	}
	gmailState, err := issueGmailOAuthState("user-1")
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/cb?code=abc&state="+url.QueryEscape(gmailState), nil)
	rec = httptest.NewRecorder()
	s.handleSlackCallback(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "slack_error=invalid_state") {
		t.Fatalf("code=%d loc=%s", rec.Code, rec.Header().Get("Location"))
	}
}

func TestNormalizeGitHubRepo(t *testing.T) {
	got, err := normalizeGitHubRepo(" https://github.com/Octo/Hello.git ")
	if err != nil || got != "Octo/Hello" {
		t.Fatalf("got=%q err=%v", got, err)
	}
	if _, err := normalizeGitHubRepo("not a repo"); err == nil {
		t.Fatal("expected error")
	}
	if _, err := normalizeGitHubRepo("octo/hello/extra"); err == nil {
		t.Fatal("expected error")
	}
	empty, err := normalizeGitHubRepo("  ")
	if err != nil || empty != "" {
		t.Fatalf("empty=%q err=%v", empty, err)
	}
}

func TestOAuthInstallHookDeletable(t *testing.T) {
	hook := &db.InboundHook{ID: "h1", UserID: "u1", Provider: "slack", Label: oauthInstallHookLabel}
	if !oauthInstallHookDeletable(hook, "u1", "slack", "h1") {
		t.Fatal("expected deletable")
	}
	manual := &db.InboundHook{ID: "h2", UserID: "u1", Provider: "slack", Label: "手工粘贴"}
	if oauthInstallHookDeletable(manual, "u1", "slack", "h2") {
		t.Fatal("manual label must survive")
	}
	if oauthInstallHookDeletable(hook, "u1", "github", "h1") {
		t.Fatal("provider mismatch")
	}
	if oauthInstallHookDeletable(hook, "other", "slack", "h1") {
		t.Fatal("user mismatch")
	}
	if oauthInstallHookDeletable(hook, "u1", "slack", "other") {
		t.Fatal("id mismatch")
	}
	if oauthInstallHookDeletable(nil, "u1", "slack", "h1") {
		t.Fatal("nil")
	}
}

func TestOAuthHookSecretUsesExistingGitHubVerifier(t *testing.T) {
	secret := randomState()
	body := []byte(`{"zen":"keep"}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if !validGitHubSignature(secret, body, sig) {
		t.Fatal("existing verifier rejected install hook secret")
	}
	if validGitHubSignature(secret, body, "sha256=00") {
		t.Fatal("bad signature accepted")
	}
}

func TestDefaultFetchSlackCredential(t *testing.T) {
	var sawSecret bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		form, _ := url.ParseQuery(string(raw))
		if form.Get("code") != "the-code" || form.Get("client_id") != "cid" {
			t.Errorf("form=%s", raw)
		}
		sawSecret = form.Get("client_secret") == "sec"
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"access_token":"xoxb-bot","scope":"app_mentions:read","bot_user_id":"UBOT","team":{"id":"T1","name":"Acme"}}`))
	}))
	defer srv.Close()
	prev := slackOAuthTokenURL
	slackOAuthTokenURL = srv.URL
	t.Cleanup(func() { slackOAuthTokenURL = prev })
	cred, err := defaultFetchSlackCredential(context.Background(), slackOAuthConfig{
		ClientID: "cid", ClientSecret: "sec", RedirectURI: "http://cb",
	}, "the-code")
	if err != nil {
		t.Fatal(err)
	}
	if !sawSecret || cred.AccessToken != "xoxb-bot" || cred.TeamName != "Acme" || cred.TeamID != "T1" {
		t.Fatalf("cred=%+v sawSecret=%v", cred, sawSecret)
	}
}

func TestDefaultFetchSlackCredentialRejectsUserToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true,"access_token":"xoxp-user","team":{"id":"T1","name":"Acme"}}`))
	}))
	defer srv.Close()
	prev := slackOAuthTokenURL
	slackOAuthTokenURL = srv.URL
	t.Cleanup(func() { slackOAuthTokenURL = prev })
	_, err := defaultFetchSlackCredential(context.Background(), slackOAuthConfig{ClientID: "c", ClientSecret: "s"}, "code")
	if err == nil || !strings.Contains(err.Error(), "bot token") {
		t.Fatalf("err=%v", err)
	}
}

func TestRegisterGitHubWebhookPostsOurSecret(t *testing.T) {
	var created map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/octo/hello/hooks" || r.Method != http.MethodPost {
			t.Fatalf("path=%s method=%s", r.URL.Path, r.Method)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer gho_test") {
			t.Fatalf("auth=%s", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&created); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":7}`))
	}))
	defer srv.Close()
	prev := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = prev })
	id, err := defaultRegisterGitHubWebhook(context.Background(), "gho_test", "octo/hello", "https://api.example.test/v1/webhooks/github/tok", "sec-1")
	if err != nil || id != 7 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	cfg, _ := created["config"].(map[string]any)
	if cfg["secret"] != "sec-1" || cfg["url"] != "https://api.example.test/v1/webhooks/github/tok" || cfg["content_type"] != "json" {
		t.Fatalf("config=%v", cfg)
	}
}

func TestRegisterGitHubWebhookReusesExistingURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"message":"Validation Failed: Hook already exists"}`))
		case r.Method == http.MethodGet:
			_, _ = w.Write([]byte(`[{"id":3,"config":{"url":"https://other.example/hook"}},{"id":9,"config":{"url":"https://api.example.test/v1/webhooks/github/tok"}}]`))
		default:
			t.Fatalf("method=%s", r.Method)
		}
	}))
	defer srv.Close()
	prev := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = prev })
	id, err := defaultRegisterGitHubWebhook(context.Background(), "gho", "octo/hello", "https://api.example.test/v1/webhooks/github/tok", "sec")
	if err != nil || id != 9 {
		t.Fatalf("id=%d err=%v", id, err)
	}
}

func TestGitHubAppJWTRoundTrip(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	tok, err := githubAppJWT("12345", string(pemBytes))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.Parse(tok, func(token *jwt.Token) (any, error) {
		return &key.PublicKey, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatal(err)
	}
	claims, _ := parsed.Claims.(jwt.MapClaims)
	if claims["iss"] != "12345" {
		t.Fatalf("iss=%v", claims["iss"])
	}
}

func TestInstallCallbackHappyPathProviderIsolationAndDisconnect(t *testing.T) {
	setInstallTestEnv(t)
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(func() { _ = d.Close() })

	org, err := d.EnsureDefaultOrg()
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.NewString()
	username := "inst-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash, org_id, role, email, created_at) VALUES ($1,$2,'x',$3,'member',$4,$5)`,
		userID, username, org.ID, username+"@example.com", db.Now(),
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, userID) })

	manualSlack, err := d.CreateInboundHook(userID, "slack", "手工粘贴", "manual-secret")
	if err != nil {
		t.Fatal(err)
	}
	manualAny, err := d.CreateInboundHook(userID, "any", "默认入站", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.UpsertOAuthConnection(userID, gmailProvider, "me@example.com", "gmail.send", "ct-gmail", "", nil); err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d}
	var slackCalls int
	prevSlack := fetchSlackCredential
	fetchSlackCredential = func(ctx context.Context, cfg slackOAuthConfig, code string) (*slackCredential, error) {
		slackCalls++
		if code != "slack-code" {
			t.Fatalf("code=%s", code)
		}
		return &slackCredential{AccessToken: "xoxb-test", Scope: slackBotScopes, TeamID: "T1", TeamName: "Acme", BotUserID: "UBOT"}, nil
	}
	t.Cleanup(func() { fetchSlackCredential = prevSlack })

	slackState, err := issueInstallOAuthState(slackProvider, userID, "")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/cb?code=slack-code&state="+url.QueryEscape(slackState), nil)
	rec := httptest.NewRecorder()
	s.handleSlackCallback(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "slack_connected=1") {
		t.Fatalf("code=%d loc=%s", rec.Code, rec.Header().Get("Location"))
	}
	// Reconnect keeps the same auto hook.
	req = httptest.NewRequest(http.MethodGet, "/cb?code=slack-code&state="+url.QueryEscape(slackState), nil)
	rec = httptest.NewRecorder()
	s.handleSlackCallback(rec, req)
	if rec.Code != http.StatusFound {
		t.Fatalf("reconnect code=%d loc=%s", rec.Code, rec.Header().Get("Location"))
	}

	slackConn, err := d.GetOAuthConnection(userID, slackProvider)
	if err != nil || slackConn.AccountEmail != "Acme" {
		t.Fatalf("conn=%+v err=%v", slackConn, err)
	}
	plain, err := decryptInstallSecret(slackConn.AccessTokenCT)
	if err != nil || plain != "xoxb-test" {
		t.Fatalf("plain=%q err=%v", plain, err)
	}
	if d.OAuthConnectionStatus(userID, githubProvider).Connected {
		t.Fatal("slack callback wrote a github connection")
	}
	gmailStill, err := d.GetOAuthConnection(userID, gmailProvider)
	if err != nil || gmailStill.AccountEmail != "me@example.com" {
		t.Fatal("gmail connection changed")
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/v1/integrations/slack", nil)
	statusReq = statusReq.WithContext(context.WithValue(statusReq.Context(), userIDKey, userID))
	statusRec := httptest.NewRecorder()
	s.handleSlackStatus(statusRec, statusReq)
	var status map[string]any
	if err := json.Unmarshal(statusRec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	hookURL, _ := status["hook_url"].(string)
	if !strings.HasPrefix(hookURL, "https://api.example.test/v1/webhooks/slack/") || status["account"] != "Acme" {
		t.Fatalf("status=%s", statusRec.Body.String())
	}
	if _, ok := status["hook_secret"]; ok {
		t.Fatal("slack status must not return a hook secret")
	}

	var ghSecret, ghURL, ghToken string
	var ghRemove []int64
	prevGH := fetchGitHubCredential
	fetchGitHubCredential = func(ctx context.Context, cfg githubOAuthConfig, code, installationID string) (*githubCredential, error) {
		if code != "gh-code" || installationID != "" {
			t.Fatalf("code=%s installation=%s", code, installationID)
		}
		return &githubCredential{AccessToken: "gho_test", Scope: githubOAuthScopes, Account: "octocat", Mode: "oauth"}, nil
	}
	prevReg := registerGitHubWebhook
	registerGitHubWebhook = func(ctx context.Context, token, repo, hookURL, secret string) (int64, error) {
		ghToken, ghURL, ghSecret = token, hookURL, secret
		if repo != "octo/hello" {
			t.Fatalf("repo=%s", repo)
		}
		return 42, nil
	}
	prevRm := removeGitHubWebhook
	removeGitHubWebhook = func(ctx context.Context, token, repo string, hookID int64) error {
		ghRemove = append(ghRemove, hookID)
		if token != "gho_test" || repo != "octo/hello" || hookID != 42 {
			t.Fatalf("unexpected remote delete token=%s repo=%s id=%d", token, repo, hookID)
		}
		return nil
	}
	t.Cleanup(func() {
		fetchGitHubCredential = prevGH
		registerGitHubWebhook = prevReg
		removeGitHubWebhook = prevRm
	})

	ghState, err := issueInstallOAuthState(githubProvider, userID, "octo/hello")
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, "/cb?code=gh-code&state="+url.QueryEscape(ghState), nil)
	rec = httptest.NewRecorder()
	s.handleGitHubCallback(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "github_connected=1") {
		t.Fatalf("code=%d loc=%s", rec.Code, rec.Header().Get("Location"))
	}
	if ghToken != "gho_test" || ghSecret == "" || !strings.Contains(ghURL, "/v1/webhooks/github/") {
		t.Fatalf("token=%s url=%s secret=%s", ghToken, ghURL, ghSecret)
	}

	hooks, err := d.ListInboundHooks(userID)
	if err != nil {
		t.Fatal(err)
	}
	var oauthSlack, oauthGitHub int
	var ghHook *db.InboundHook
	for _, h := range hooks {
		if h.Label != oauthInstallHookLabel {
			continue
		}
		switch h.Provider {
		case slackProvider:
			oauthSlack++
		case githubProvider:
			oauthGitHub++
			ghHook = h
		}
	}
	if oauthSlack != 1 || oauthGitHub != 1 || ghHook == nil {
		t.Fatalf("oauth slack=%d github=%d hooks=%d", oauthSlack, oauthGitHub, len(hooks))
	}
	if ghHook.Secret != ghSecret || installHookURL(githubProvider, ghHook.Token) != ghURL {
		t.Fatalf("hook secret/url mismatch hook=%s url=%s", ghHook.Secret, ghURL)
	}
	if slackCalls != 2 {
		t.Fatalf("slack exchange calls=%d", slackCalls)
	}

	// Disconnect Slack first: GitHub remote hook must stay untouched.
	dreq := httptest.NewRequest(http.MethodDelete, "/v1/integrations/slack", nil)
	dreq = dreq.WithContext(context.WithValue(dreq.Context(), userIDKey, userID))
	drec := httptest.NewRecorder()
	s.handleSlackDisconnect(drec, dreq)
	if drec.Code != http.StatusOK || !strings.Contains(drec.Body.String(), `"kept_other_hooks":true`) {
		t.Fatalf("disconnect slack %d %s", drec.Code, drec.Body.String())
	}
	if len(ghRemove) != 0 {
		t.Fatalf("slack disconnect removed github hooks %#v", ghRemove)
	}
	if d.OAuthConnectionStatus(userID, slackProvider).Connected {
		t.Fatal("slack still connected")
	}
	if !d.OAuthConnectionStatus(userID, githubProvider).Connected {
		t.Fatal("github connection removed by slack disconnect")
	}
	if _, err := d.GetOAuthConnection(userID, gmailProvider); err != nil {
		t.Fatal("gmail removed")
	}
	hooks, _ = d.ListInboundHooks(userID)
	seenManualSlack, seenManualAny, seenGH := false, false, false
	for _, h := range hooks {
		if h.ID == manualSlack.ID {
			seenManualSlack = true
		}
		if h.ID == manualAny.ID {
			seenManualAny = true
		}
		if h.Provider == slackProvider && h.Label == oauthInstallHookLabel {
			t.Fatal("slack oauth hook survived disconnect")
		}
		if h.ID == ghHook.ID {
			seenGH = true
		}
	}
	if !seenManualSlack || !seenManualAny || !seenGH {
		t.Fatalf("hooks missing manual=%v any=%v gh=%v", seenManualSlack, seenManualAny, seenGH)
	}

	// Hand-pasted Slack hook still answers url_verification. OAuth token does not.
	vreq := httptest.NewRequest(http.MethodPost, "/v1/webhooks/slack/"+manualSlack.Token, strings.NewReader(`{"type":"url_verification","challenge":"ch-1"}`))
	vreq.SetPathValue("token", manualSlack.Token)
	vrec := httptest.NewRecorder()
	s.handleSlackWebhook(vrec, vreq)
	if vrec.Code != http.StatusOK || !strings.Contains(vrec.Body.String(), `"challenge":"ch-1"`) {
		t.Fatalf("manual hook %d %s", vrec.Code, vrec.Body.String())
	}
	dead := strings.TrimPrefix(hookURL, "https://api.example.test")
	deadTok := strings.TrimPrefix(dead, "/v1/webhooks/slack/")
	breq := httptest.NewRequest(http.MethodPost, "/v1/webhooks/slack/"+deadTok, strings.NewReader(`{"type":"url_verification","challenge":"nope"}`))
	breq.SetPathValue("token", deadTok)
	brec := httptest.NewRecorder()
	s.handleSlackWebhook(brec, breq)
	if brec.Code != http.StatusNotFound {
		t.Fatalf("deleted oauth hook still accepted %d %s", brec.Code, brec.Body.String())
	}

	dreq = httptest.NewRequest(http.MethodDelete, "/v1/integrations/github", nil)
	dreq = dreq.WithContext(context.WithValue(dreq.Context(), userIDKey, userID))
	drec = httptest.NewRecorder()
	s.handleGitHubDisconnect(drec, dreq)
	if drec.Code != http.StatusOK {
		t.Fatalf("disconnect github %d %s", drec.Code, drec.Body.String())
	}
	if len(ghRemove) != 1 || ghRemove[0] != 42 {
		t.Fatalf("remote deletes=%v", ghRemove)
	}
	if d.OAuthConnectionStatus(userID, githubProvider).Connected {
		t.Fatal("github still connected")
	}
	hooks, _ = d.ListInboundHooks(userID)
	for _, h := range hooks {
		if h.Label == oauthInstallHookLabel {
			t.Fatalf("oauth hook survived: %+v", h)
		}
		if h.ID != manualSlack.ID && h.ID != manualAny.ID {
			t.Fatalf("unexpected hook %+v", h)
		}
	}
	if _, err := d.GetOAuthConnection(userID, gmailProvider); err != nil {
		t.Fatal("gmail removed by github disconnect")
	}
}

func TestGitHubCallbackWithoutRepoKeepsManualAttach(t *testing.T) {
	setInstallTestEnv(t)
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	org, err := d.EnsureDefaultOrg()
	if err != nil {
		t.Fatal(err)
	}
	userID := uuid.NewString()
	username := "ghnorepo-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash, org_id, role, email, created_at) VALUES ($1,$2,'x',$3,'member',$4,$5)`,
		userID, username, org.ID, username+"@example.com", db.Now(),
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, userID) })

	s := &Server{db: d}
	prev := fetchGitHubCredential
	fetchGitHubCredential = func(ctx context.Context, cfg githubOAuthConfig, code, installationID string) (*githubCredential, error) {
		return &githubCredential{AccessToken: "gho_norepo", Account: "octocat", Mode: "oauth"}, nil
	}
	prevReg := registerGitHubWebhook
	registerGitHubWebhook = func(ctx context.Context, token, repo, hookURL, secret string) (int64, error) {
		t.Fatal("register should not run without a repo")
		return 0, nil
	}
	t.Cleanup(func() {
		fetchGitHubCredential = prev
		registerGitHubWebhook = prevReg
	})
	state, err := issueInstallOAuthState(githubProvider, userID, "")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/cb?code=x&state="+url.QueryEscape(state), nil)
	rec := httptest.NewRecorder()
	s.handleGitHubCallback(rec, req)
	if rec.Code != http.StatusFound || !strings.Contains(rec.Header().Get("Location"), "github_connected=1") {
		t.Fatalf("code=%d loc=%s", rec.Code, rec.Header().Get("Location"))
	}
	st := s.installStatusPayload(userID, githubProvider, true)
	if st["webhook_attached"] != false || st["hook_url"] == "" || st["hook_secret"] == "" {
		t.Fatalf("status=%v", st)
	}

	prevReg = registerGitHubWebhook
	registerGitHubWebhook = func(ctx context.Context, token, repo, hookURL, secret string) (int64, error) {
		if token != "gho_norepo" || repo != "octo/widgets" || secret != st["hook_secret"] {
			t.Fatalf("token=%s repo=%s secret=%s want=%s", token, repo, secret, st["hook_secret"])
		}
		return 11, nil
	}
	areq := httptest.NewRequest(http.MethodPost, "/v1/integrations/github/attach", strings.NewReader(`{"repo":"octo/widgets"}`))
	areq = areq.WithContext(context.WithValue(areq.Context(), userIDKey, userID))
	arec := httptest.NewRecorder()
	s.handleGitHubAttach(arec, areq)
	if arec.Code != http.StatusOK || !strings.Contains(arec.Body.String(), `"webhook_attached":true`) {
		t.Fatalf("attach %d %s", arec.Code, arec.Body.String())
	}
}
