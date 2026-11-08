package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

const slackBotScopes = "app_mentions:read,channels:history,groups:history,im:history,mpim:history"

var slackOAuthTokenURL = "https://slack.com/api/oauth.v2.access"

type slackOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	WebOrigin    string
}

func loadSlackOAuthConfig() slackOAuthConfig {
	return slackOAuthConfig{
		ClientID:     strings.TrimSpace(os.Getenv("SLACK_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(os.Getenv("SLACK_CLIENT_SECRET")),
		RedirectURI: strings.TrimSpace(firstNonEmpty(
			os.Getenv("SLACK_OAUTH_REDIRECT_URI"),
			"http://127.0.0.1:18080/v1/integrations/slack/callback",
		)),
		WebOrigin: installWebOrigin(),
	}
}

func (c slackOAuthConfig) Enabled() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.RedirectURI != ""
}

func (c slackOAuthConfig) authorizeURL(state string) string {
	q := url.Values{}
	q.Set("client_id", c.ClientID)
	q.Set("scope", slackBotScopes)
	q.Set("redirect_uri", c.RedirectURI)
	q.Set("state", state)
	return "https://slack.com/oauth/v2/authorize?" + q.Encode()
}

type slackCredential struct {
	AccessToken string
	Scope       string
	TeamID      string
	TeamName    string
	BotUserID   string
}

var fetchSlackCredential = defaultFetchSlackCredential

func (s *Server) handleSlackStatus(w http.ResponseWriter, r *http.Request) {
	cfg := loadSlackOAuthConfig()
	writeJSON(w, http.StatusOK, s.installStatusPayload(userIDFrom(r.Context()), slackProvider, cfg.Enabled()))
}

func (s *Server) handleSlackStart(w http.ResponseWriter, r *http.Request) {
	cfg := loadSlackOAuthConfig()
	if !cfg.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Slack OAuth 未配置：请设置 SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_OAUTH_REDIRECT_URI",
		})
		return
	}
	uid := userIDFrom(r.Context())
	state, err := issueInstallOAuthState(slackProvider, uid, "")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to issue oauth state"})
		return
	}
	setInstallOAuthStateCookie(w, slackProvider, state)
	writeJSON(w, http.StatusOK, map[string]string{
		"authorize_url": cfg.authorizeURL(state),
		"state":         state,
	})
}

func (s *Server) handleSlackCallback(w http.ResponseWriter, r *http.Request) {
	cfg := loadSlackOAuthConfig()
	webFail := func(msg string) {
		http.Redirect(w, r, installWebRedirect(cfg.WebOrigin, slackProvider, "err", msg), http.StatusFound)
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
	if code == "" || state == "" {
		webFail("missing_code_or_state")
		return
	}
	if err := verifyOptionalOAuthStateCookie(r, installOAuthStateCookie(slackProvider), state); err != nil {
		webFail("invalid_state")
		return
	}
	userID, _, err := parseInstallOAuthState(slackProvider, state)
	if err != nil || userID == "" {
		if err != nil && strings.Contains(err.Error(), "expired") {
			webFail("state_expired")
			return
		}
		webFail("invalid_state")
		return
	}
	cred, err := fetchSlackCredential(r.Context(), cfg, code)
	if err != nil {
		log.Printf("slack oauth: token exchange failed: %v", sanitizeGmailOAuthLog(err.Error()))
		webFail(mapGmailTokenExchangeError(err))
		return
	}
	if err := s.storeSlackInstall(userID, cred); err != nil {
		log.Printf("slack oauth: store failed: %v", sanitizeGmailOAuthLog(err.Error()))
		webFail(installStoreErrorCode(err))
		return
	}
	clearInstallOAuthStateCookie(w, slackProvider)
	http.Redirect(w, r, installWebRedirect(cfg.WebOrigin, slackProvider, "ok", ""), http.StatusFound)
}

func (s *Server) handleSlackDisconnect(w http.ResponseWriter, r *http.Request) {
	res, err := s.disconnectOAuthInstall(r.Context(), userIDFrom(r.Context()), slackProvider)
	writeInstallDisconnect(w, res, err)
}

func (s *Server) storeSlackInstall(userID string, cred *slackCredential) error {
	if cred == nil || strings.TrimSpace(cred.AccessToken) == "" {
		return errors.New("missing bot token")
	}
	linked := ""
	if prev, err := s.db.GetOAuthConnection(userID, slackProvider); err == nil && prev != nil {
		linked = prev.LinkedHookID
	}
	hook, err := s.ensureOAuthInstallHook(userID, slackProvider, linked)
	if err != nil {
		return err
	}
	accessCT, err := encryptInstallSecret(cred.AccessToken)
	if err != nil {
		return err
	}
	account := firstNonEmpty(cred.TeamName, cred.TeamID)
	meta := installMeta{
		Mode:      "oauth",
		Account:   account,
		TeamID:    cred.TeamID,
		TeamName:  cred.TeamName,
		BotUserID: cred.BotUserID,
	}
	_, err = s.db.UpsertOAuthInstall(
		userID, slackProvider, account, cred.Scope, accessCT, "", hook.ID, meta.JSON(), nil,
	)
	return err
}

func defaultFetchSlackCredential(ctx context.Context, cfg slackOAuthConfig, code string) (*slackCredential, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("code", code)
	form.Set("redirect_uri", cfg.RedirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackOAuthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("token network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var body struct {
		OK          bool   `json:"ok"`
		Error       string `json:"error"`
		AccessToken string `json:"access_token"`
		Scope       string `json:"scope"`
		BotUserID   string `json:"bot_user_id"`
		Team        struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"team"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("token parse: %w", err)
	}
	if !body.OK || strings.TrimSpace(body.AccessToken) == "" {
		msg := strings.TrimSpace(body.Error)
		if msg == "" {
			msg = fmt.Sprintf("slack oauth http %d", res.StatusCode)
		}
		return nil, errors.New(msg)
	}
	if !strings.HasPrefix(body.AccessToken, "xoxb-") && !strings.HasPrefix(body.AccessToken, "xoxe-") {
		return nil, errors.New("missing bot token")
	}
	return &slackCredential{
		AccessToken: body.AccessToken,
		Scope:       body.Scope,
		TeamID:      body.Team.ID,
		TeamName:    body.Team.Name,
		BotUserID:   body.BotUserID,
	}, nil
}
