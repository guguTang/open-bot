package httpserver

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/crypto"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

const (
	slackProvider  = "slack"
	githubProvider = "github"

	// oauthInstallHookLabel marks the single inbound hook created by the
	// install wizard. Disconnect deletes a hook only when id, user, provider,
	// and this label all match. Hand-pasted hooks use other labels and stay.
	oauthInstallHookLabel = "openbot-oauth-install"
	installOAuthStateTTL  = 10 * time.Minute
)

// installMeta is non-secret display state stored next to the encrypted token.
type installMeta struct {
	Mode            string `json:"mode,omitempty"`
	Account         string `json:"account,omitempty"`
	TeamID          string `json:"team_id,omitempty"`
	TeamName        string `json:"team_name,omitempty"`
	BotUserID       string `json:"bot_user_id,omitempty"`
	InstallationID  string `json:"installation_id,omitempty"`
	Repo            string `json:"repo,omitempty"`
	RemoteHookID    int64  `json:"remote_hook_id,omitempty"`
	WebhookAttached bool   `json:"webhook_attached,omitempty"`
	AttachError     string `json:"attach_error,omitempty"`
}

func installWebOrigin() string {
	return strings.TrimRight(firstNonEmpty(os.Getenv("OPENBOT_WEB_ORIGIN"), "http://127.0.0.1:5173"), "/")
}

func installPublicAPIOrigin() string {
	if v := strings.TrimSpace(os.Getenv("OPENBOT_PUBLIC_API_ORIGIN")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://127.0.0.1:18080"
}

func installHookPath(provider, token string) string {
	return "/v1/webhooks/" + provider + "/" + token
}

func installHookURL(provider, token string) string {
	return installPublicAPIOrigin() + installHookPath(provider, token)
}

func installSetupHint(provider string) string {
	switch provider {
	case slackProvider:
		return "把 Event Request URL 粘贴到 Slack App → Event Subscriptions，并订阅 app_mention 与 message.channels。安装只保存 bot token，并自动绑定一条入站 Hook。不会创建 Slack App，也不启用 Socket Mode。事件唤醒仍走现有 webhook。"
	case githubProvider:
		return "填写 owner/repo 后可用 API 把 webhook 挂到该仓库。未挂上时，把 URL 和签名密钥手工填到 GitHub Webhook（Content type: application/json）。验签仍用这条 Hook 的 secret（X-Hub-Signature-256）。"
	default:
		return ""
	}
}

func parseInstallMeta(raw string) installMeta {
	var m installMeta
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return m
	}
	_ = json.Unmarshal([]byte(raw), &m)
	return m
}

func (m installMeta) JSON() string {
	b, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// ---- signed OAuth state, isolated per provider ----
//
// Same cross-origin constraint as Gmail: HMAC state binds the user; the cookie
// is optional double-submit. Slack and GitHub use different MAC prefixes, so a
// state issued for one provider cannot be replayed against the other (or Gmail).

func issueInstallOAuthState(provider, userID, extra string) (string, error) {
	return issueInstallOAuthStateAt(provider, userID, extra, time.Now().Add(installOAuthStateTTL))
}

func issueInstallOAuthStateAt(provider, userID, extra string, exp time.Time) (string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	userID = strings.TrimSpace(userID)
	extra = strings.TrimSpace(extra)
	if provider == "" || userID == "" {
		return "", errors.New("provider and user id required")
	}
	if strings.Contains(provider, "|") || strings.Contains(userID, "|") || strings.Contains(extra, "|") {
		return "", errors.New("invalid state claim")
	}
	nonce := randomState()
	payload := userID + "|" + strconv.FormatInt(exp.Unix(), 10) + "|" + nonce + "|" + extra
	mac := installOAuthMAC(provider, []byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac), nil
}

func parseInstallOAuthState(provider, state string) (userID, extra string, err error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	state = strings.TrimSpace(state)
	parts := strings.Split(state, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", errors.New("malformed state")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", "", errors.New("malformed state payload")
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", "", errors.New("malformed state mac")
	}
	expected := installOAuthMAC(provider, payload)
	if !hmac.Equal(mac, expected) {
		return "", "", errors.New("invalid state signature")
	}
	fields := strings.Split(string(payload), "|")
	if len(fields) != 4 {
		return "", "", errors.New("malformed state fields")
	}
	userID = strings.TrimSpace(fields[0])
	expUnix, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil || userID == "" {
		return "", "", errors.New("malformed state claims")
	}
	if time.Now().Unix() > expUnix {
		return "", "", errors.New("state expired")
	}
	return userID, fields[3], nil
}

func installOAuthMAC(provider string, payload []byte) []byte {
	m := hmac.New(sha256.New, []byte(auth.Secret()))
	_, _ = m.Write([]byte("install_oauth_state|" + provider + "|"))
	_, _ = m.Write(payload)
	return m.Sum(nil)
}

func installOAuthStateCookie(provider string) string {
	return "openbot_" + provider + "_oauth_state"
}

func verifyOptionalOAuthStateCookie(r *http.Request, cookieName, state string) error {
	c, err := r.Cookie(cookieName)
	if err != nil || c == nil || c.Value == "" {
		return nil
	}
	if c.Value != state {
		return errors.New("invalid_state")
	}
	return nil
}

func setInstallOAuthStateCookie(w http.ResponseWriter, provider, state string) {
	http.SetCookie(w, &http.Cookie{
		Name:     installOAuthStateCookie(provider),
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(installOAuthStateTTL.Seconds()),
	})
}

func clearInstallOAuthStateCookie(w http.ResponseWriter, provider string) {
	http.SetCookie(w, &http.Cookie{
		Name:   installOAuthStateCookie(provider),
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})
}

func installWebRedirect(webOrigin, provider, kind, detail string) string {
	q := url.Values{}
	q.Set("open_settings", "integrations")
	if kind == "ok" {
		q.Set(provider+"_connected", "1")
	} else {
		q.Set(provider+"_error", detail)
	}
	return strings.TrimRight(webOrigin, "/") + "/?" + q.Encode()
}

// oauthInstallHookDeletable is the only predicate allowed to select a hook for
// deletion during disconnect. A manual hook fails the label check even if the
// caller passes its id.
func oauthInstallHookDeletable(hook *db.InboundHook, userID, provider, linkedID string) bool {
	if hook == nil {
		return false
	}
	userID = strings.TrimSpace(userID)
	provider = strings.ToLower(strings.TrimSpace(provider))
	linkedID = strings.TrimSpace(linkedID)
	if userID == "" || provider == "" || linkedID == "" {
		return false
	}
	return hook.ID == linkedID &&
		hook.UserID == userID &&
		strings.EqualFold(hook.Provider, provider) &&
		hook.Label == oauthInstallHookLabel
}

func (s *Server) linkedInstallHook(userID, provider, linkedID string) *db.InboundHook {
	if s == nil || s.db == nil || strings.TrimSpace(linkedID) == "" {
		return nil
	}
	h, err := s.db.GetInboundHookForUser(userID, linkedID)
	if err != nil || !oauthInstallHookDeletable(h, userID, provider, linkedID) {
		return nil
	}
	return h
}

func (s *Server) ensureOAuthInstallHook(userID, provider, linkedID string) (*db.InboundHook, error) {
	if h := s.linkedInstallHook(userID, provider, linkedID); h != nil {
		return h, nil
	}
	list, err := s.db.ListInboundHooks(userID)
	if err != nil {
		return nil, err
	}
	for _, h := range list {
		if h != nil && strings.EqualFold(h.Provider, provider) && h.Label == oauthInstallHookLabel {
			return h, nil
		}
	}
	return s.db.CreateInboundHook(userID, provider, oauthInstallHookLabel, randomState())
}

type installDisconnectResult struct {
	RemovedHookID string
}

// disconnectOAuthInstall clears this provider's oauth_connections row and, when
// the linked hook is the wizard-created one, that hook only.
// It does not list or delete other inbound hooks, other providers, or remote
// webhooks other than the single GitHub hook id stored at attach time.
func (s *Server) disconnectOAuthInstall(ctx context.Context, userID, provider string) (installDisconnectResult, error) {
	var res installDisconnectResult
	conn, err := s.db.GetOAuthConnection(userID, provider)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return res, nil
		}
		return res, err
	}
	if provider == githubProvider {
		s.bestEffortRemoveGitHubRemoteHook(ctx, conn)
	}
	if hook, herr := s.db.GetInboundHookForUser(userID, conn.LinkedHookID); herr == nil {
		if oauthInstallHookDeletable(hook, userID, provider, conn.LinkedHookID) {
			if derr := s.db.DeleteInboundHook(userID, hook.ID); derr == nil {
				res.RemovedHookID = hook.ID
			}
		}
	}
	if err := s.db.DeleteOAuthConnection(userID, provider); err != nil && !errors.Is(err, db.ErrNotFound) {
		return res, err
	}
	return res, nil
}

func writeInstallDisconnect(w http.ResponseWriter, res installDisconnectResult, err error) {
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                 true,
		"connected":          false,
		"removed_hook_id":    res.RemovedHookID,
		"removed_oauth_hook": res.RemovedHookID != "",
		// Contract: disconnect never deletes hand-pasted or other-provider hooks.
		"kept_other_hooks": true,
	})
}

func (s *Server) installStatusPayload(userID, provider string, configured bool) map[string]any {
	out := map[string]any{
		"provider":         provider,
		"connected":        false,
		"oauth_configured": configured,
		"setup_hint":       installSetupHint(provider),
	}
	if provider == githubProvider {
		if mode := loadGitHubOAuthConfig().Mode(); mode != "" {
			out["mode"] = mode
		}
	}
	if s == nil || s.db == nil || strings.TrimSpace(userID) == "" {
		return out
	}
	conn, err := s.db.GetOAuthConnection(userID, provider)
	if err != nil || conn == nil {
		return out
	}
	meta := parseInstallMeta(conn.MetadataJSON)
	out["connected"] = true
	out["account"] = firstNonEmpty(conn.AccountEmail, meta.Account)
	out["scopes"] = conn.Scopes
	out["updated_at"] = db.FormatTime(conn.UpdatedAt)
	if meta.Mode != "" {
		out["mode"] = meta.Mode
	}
	if provider == githubProvider {
		out["repo"] = meta.Repo
		out["webhook_attached"] = meta.WebhookAttached
		if meta.AttachError != "" {
			out["attach_error"] = meta.AttachError
		}
	}
	hook := s.linkedInstallHook(userID, provider, conn.LinkedHookID)
	if hook == nil {
		out["hook_missing"] = true
		return out
	}
	path := installHookPath(provider, hook.Token)
	out["hook_id"] = hook.ID
	out["hook_path"] = path
	out["hook_url"] = installPublicAPIOrigin() + path
	if provider == githubProvider && strings.TrimSpace(hook.Secret) != "" {
		out["hook_secret"] = hook.Secret
	}
	return out
}

func encryptInstallSecret(plain string) (string, error) {
	plain = strings.TrimSpace(plain)
	if plain == "" {
		return "", errors.New("empty secret")
	}
	key, err := crypto.LoadKey()
	if err != nil {
		return "", err
	}
	return crypto.Encrypt(key, []byte(plain))
}

func decryptInstallSecret(ct string) (string, error) {
	key, err := crypto.LoadKey()
	if err != nil {
		return "", err
	}
	raw, err := crypto.Decrypt(key, ct)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func installStoreErrorCode(err error) string {
	if err == nil {
		return "store_failed"
	}
	if errors.Is(err, crypto.ErrNoKey) || strings.Contains(strings.ToLower(err.Error()), "encryption key") {
		return "encryption_key_missing"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "missing bot token"):
		return "missing_bot_token"
	case strings.Contains(msg, "encrypt"):
		return "encrypt_failed"
	default:
		return "store_failed"
	}
}

func readOptionalJSON(r *http.Request, dest any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := dec.Decode(dest); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
	return nil
}
