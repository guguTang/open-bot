package httpserver

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/crypto"
	"github.com/tangxin/open-bot/services/api/internal/db"
	"github.com/tangxin/open-bot/services/api/internal/sandbox"
)

const (
	gmailProvider          = "gmail"
	gmailAuthURL           = "https://accounts.google.com/o/oauth2/v2/auth"
	gmailTokenURL          = "https://oauth2.googleapis.com/token"
	gmailUserInfoURL       = "https://www.googleapis.com/oauth2/v2/userinfo"
	gmailSendURL           = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
	gmailOAuthStateCookie = "openbot_gmail_oauth_state"
	gmailScopeSend        = "https://www.googleapis.com/auth/gmail.send"
	gmailScopeEmail       = "https://www.googleapis.com/auth/userinfo.email"
	// Space-separated scopes for the authorize request (must include gmail.send).
	gmailDefaultScopes    = gmailScopeSend + " " + gmailScopeEmail
	gmailOAuthStateTTL    = 10 * time.Minute
	gmailConfirmTimeout   = 90 * time.Second
	gmailMaxAttachments   = 5
	gmailMaxAttachBytes   = 5 << 20 // 5 MiB per file
	gmailMaxAttachTotal   = 8 << 20 // 8 MiB total raw attachment bytes
)

type gmailOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	WebOrigin    string
}

func loadGmailOAuthConfig() gmailOAuthConfig {
	return gmailOAuthConfig{
		ClientID:     strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_SECRET")),
		RedirectURI: strings.TrimSpace(firstNonEmpty(
			os.Getenv("GOOGLE_OAUTH_REDIRECT_URI"),
			"http://127.0.0.1:18080/v1/integrations/gmail/callback",
		)),
		WebOrigin: strings.TrimRight(firstNonEmpty(
			os.Getenv("OPENBOT_WEB_ORIGIN"),
			"http://127.0.0.1:5173",
		), "/"),
	}
}

func (c gmailOAuthConfig) Enabled() bool {
	return c.ClientID != "" && c.ClientSecret != "" && c.RedirectURI != ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func gmailScopeList(scopes string) []string {
	var out []string
	for _, p := range strings.Fields(strings.ReplaceAll(scopes, ",", " ")) {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// gmailHasSendScope reports whether granted scopes can call users.messages.send.
func gmailHasSendScope(scopes string) bool {
	for _, s := range gmailScopeList(scopes) {
		switch s {
		case gmailScopeSend,
			"https://www.googleapis.com/auth/gmail.compose",
			"https://www.googleapis.com/auth/gmail.modify",
			"https://mail.google.com/":
			return true
		}
	}
	return false
}

func gmailMissingSendScopeHint() string {
	return "Gmail 授权缺少「发送邮件」范围（gmail.send）。请到「设置 → 连接应用」断开后重新连接，并在 Google 授权页勾选发送权限；同时确认 Google Cloud OAuth 同意屏幕已添加 https://www.googleapis.com/auth/gmail.send。"
}

// gmailBodyLooksLikePathOnly detects a body that is only a filesystem path
// (model forgot to read the file). Reject before confirm so the user never
// approves a path-as-body send.
func gmailBodyLooksLikePathOnly(body string) bool {
	b := strings.TrimSpace(body)
	if b == "" || strings.ContainsAny(b, "\n\r") {
		return false
	}
	b = strings.Trim(b, "`\"'")
	b = strings.TrimSpace(b)
	if b == "" {
		return false
	}
	// Multi-word prose is content, not a bare path.
	if strings.Contains(b, " ") {
		return false
	}
	lower := strings.ToLower(b)
	switch {
	case strings.HasPrefix(b, "/"),
		strings.HasPrefix(b, "~/"),
		strings.HasPrefix(b, "./"),
		strings.HasPrefix(b, "../"),
		strings.HasPrefix(lower, "workspace/"),
		strings.Contains(lower, "/workspace/"):
		return true
	}
	// Windows drive path: C:\... or C:/...
	if len(b) > 2 && ((b[0] >= 'A' && b[0] <= 'Z') || (b[0] >= 'a' && b[0] <= 'z')) && b[1] == ':' && (b[2] == '\\' || b[2] == '/') {
		return true
	}
	// relative path with slash and a file-ish suffix
	if strings.Contains(b, "/") && !strings.Contains(b, "://") {
		for _, ext := range []string{".md", ".txt", ".html", ".htm", ".csv", ".json", ".log", ".pdf", ".png", ".jpg"} {
			if strings.HasSuffix(lower, ext) {
				return true
			}
		}
	}
	return false
}

func gmailPathOnlyBodyHint() string {
	return "邮件正文不能只是文件路径。请把文件放进 attachments（工作区路径），或先读取内容写入 body；短正文 + 附件即可。"
}

func gmailInsufficientScopeError(msg string) bool {
	m := strings.ToLower(msg)
	return strings.Contains(msg, "授权范围不足") ||
		strings.Contains(m, "insufficient") ||
		strings.Contains(m, "insufficientpermissions") ||
		strings.Contains(m, "access_denied") ||
		strings.Contains(m, "access not configured") ||
		strings.Contains(m, "request had insufficient authentication scopes")
}

// ---- signed OAuth state (user binding; no in-memory / cookie-only dependency) ----
//
// Web (:5173) and API (:18080) are cross-origin. A SameSite=Lax CSRF cookie set on
// POST /start is often never stored unless fetch uses credentials:"include", which
// caused callback invalid_state after Google auth. State is therefore an HMAC-signed
// token carrying user_id + expiry. Cookie remains optional double-submit: if present
// it must match; if missing, signature verification alone is enough.

func issueGmailOAuthState(userID string) (string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", errors.New("user id required")
	}
	nonce := randomState()
	exp := time.Now().Add(gmailOAuthStateTTL).Unix()
	payload := userID + "|" + strconv.FormatInt(exp, 10) + "|" + nonce
	mac := gmailOAuthMAC([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac), nil
}

func parseGmailOAuthState(state string) (string, error) {
	state = strings.TrimSpace(state)
	parts := strings.Split(state, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", errors.New("malformed state")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("malformed state payload")
	}
	mac, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("malformed state mac")
	}
	expected := gmailOAuthMAC(payload)
	if !hmac.Equal(mac, expected) {
		return "", errors.New("invalid state signature")
	}
	fields := strings.Split(string(payload), "|")
	if len(fields) != 3 {
		return "", errors.New("malformed state fields")
	}
	userID := strings.TrimSpace(fields[0])
	expUnix, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil || userID == "" {
		return "", errors.New("malformed state claims")
	}
	if time.Now().Unix() > expUnix {
		return "", errors.New("state expired")
	}
	return userID, nil
}

func gmailOAuthMAC(payload []byte) []byte {
	m := hmac.New(sha256.New, []byte(auth.Secret()))
	_, _ = m.Write([]byte("gmail_oauth_state|"))
	_, _ = m.Write(payload)
	return m.Sum(nil)
}

// verifyGmailOAuthStateCookie is optional CSRF double-submit. Missing cookie is OK
// (cross-origin start often cannot set it); a present cookie must match state.
func verifyGmailOAuthStateCookie(r *http.Request, state string) error {
	c, err := r.Cookie(gmailOAuthStateCookie)
	if err != nil || c == nil || c.Value == "" {
		return nil
	}
	if c.Value != state {
		return errors.New("invalid_state")
	}
	return nil
}

// ---- JWT routes ----

func (s *Server) handleGmailStatus(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	cfg := loadGmailOAuthConfig()
	st := s.db.OAuthConnectionStatus(uid, gmailProvider)
	writeJSON(w, http.StatusOK, map[string]any{
		"provider":         gmailProvider,
		"connected":        st.Connected,
		"email":            st.Email,
		"scopes":           st.Scopes,
		"can_send":         st.Connected && gmailHasSendScope(st.Scopes),
		"updated_at":       st.UpdatedAt,
		"oauth_configured": cfg.Enabled(),
	})
}

func (s *Server) handleGmailStart(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	cfg := loadGmailOAuthConfig()
	if !cfg.Enabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "Gmail OAuth 未配置：请设置 GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI",
		})
		return
	}
	state, err := issueGmailOAuthState(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to issue oauth state"})
		return
	}
	// Best-effort CSRF cookie (works when client uses credentials:"include").
	http.SetCookie(w, &http.Cookie{
		Name:     gmailOAuthStateCookie,
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(gmailOAuthStateTTL.Seconds()),
	})
	q := url.Values{}
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", cfg.RedirectURI)
	q.Set("response_type", "code")
	q.Set("scope", gmailDefaultScopes)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent") // force refresh token + re-show scopes on reconnect
	// false: avoid incremental merge that can succeed with only email/openid
	// when gmail.send was unchecked (granular consent) or missing on GCP screen.
	q.Set("include_granted_scopes", "false")
	q.Set("state", state)
	authURL := gmailAuthURL + "?" + q.Encode()
	writeJSON(w, http.StatusOK, map[string]string{
		"authorize_url": authURL,
		"state":         state,
	})
}

func (s *Server) handleGmailCallback(w http.ResponseWriter, r *http.Request) {
	cfg := loadGmailOAuthConfig()
	webFail := func(msg string) {
		http.Redirect(w, r, cfg.WebOrigin+"/?open_settings=integrations&gmail_error="+url.QueryEscape(msg), http.StatusFound)
	}
	if !cfg.Enabled() {
		webFail("oauth_not_configured")
		return
	}
	q := r.URL.Query()
	if errParam := q.Get("error"); errParam != "" {
		webFail(errParam)
		return
	}
	// PathUnescape keeps literal '+' (Query().Get turns '+' into space and can
	// corrupt Google auth codes when the IdP does not percent-encode them).
	code := strings.TrimSpace(gmailQueryParam(r.URL.RawQuery, "code"))
	state := strings.TrimSpace(gmailQueryParam(r.URL.RawQuery, "state"))
	if code == "" || state == "" {
		webFail("missing_code_or_state")
		return
	}
	if err := verifyGmailOAuthStateCookie(r, state); err != nil {
		webFail("invalid_state")
		return
	}
	userID, err := parseGmailOAuthState(state)
	if err != nil || userID == "" {
		if err != nil && strings.Contains(err.Error(), "expired") {
			webFail("state_expired")
			return
		}
		webFail("invalid_state")
		return
	}
	tok, err := exchangeGmailCode(r.Context(), cfg, code)
	if err != nil {
		log.Printf("gmail oauth: token exchange failed: %v", sanitizeGmailOAuthLog(err.Error()))
		webFail(mapGmailTokenExchangeError(err))
		return
	}
	email, err := fetchGmailUserEmail(r.Context(), tok.AccessToken)
	if err != nil {
		webFail("userinfo_failed")
		return
	}
	key, err := crypto.LoadKey()
	if err != nil {
		webFail("encryption_key_missing")
		return
	}
	accessCT, err := crypto.Encrypt(key, []byte(tok.AccessToken))
	if err != nil {
		webFail("encrypt_failed")
		return
	}
	refreshCT := ""
	if tok.RefreshToken != "" {
		refreshCT, err = crypto.Encrypt(key, []byte(tok.RefreshToken))
		if err != nil {
			webFail("encrypt_failed")
			return
		}
	}
	var expiry *time.Time
	if tok.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
		expiry = &t
	}
	scopes := strings.TrimSpace(tok.Scope)
	if scopes == "" {
		// Do not assume gmail.send — empty scope from Google is a hard failure.
		webFail("missing_gmail_send_scope")
		return
	}
	if !gmailHasSendScope(scopes) {
		log.Printf("gmail oauth: granted scopes lack send: %q", sanitizeGmailOAuthLog(scopes))
		webFail("missing_gmail_send_scope")
		return
	}
	if _, err := s.db.UpsertOAuthConnection(userID, gmailProvider, email, scopes, accessCT, refreshCT, expiry); err != nil {
		webFail("store_failed")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: gmailOAuthStateCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, cfg.WebOrigin+"/?open_settings=integrations&gmail_connected=1", http.StatusFound)
}

func (s *Server) handleGmailDisconnect(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	if err := s.db.DeleteOAuthConnection(uid, gmailProvider); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "connected": false})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "connected": false})
}

// ---- Internal (runtime) ----

func (s *Server) handleInternalGmailStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	cfg := loadGmailOAuthConfig()
	st := s.db.OAuthConnectionStatus(uid, gmailProvider)
	canSend := st.Connected && gmailHasSendScope(st.Scopes)
	hint := gmailNotConnectedHint(st.Connected, cfg.Enabled())
	if st.Connected && !canSend {
		hint = gmailMissingSendScopeHint()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":               true,
		"connected":        st.Connected,
		"email":            st.Email,
		"scopes":           st.Scopes,
		"can_send":         canSend,
		"oauth_configured": cfg.Enabled(),
		"hint":             hint,
	})
}

func gmailNotConnectedHint(connected, configured bool) string {
	if connected {
		return ""
	}
	if !configured {
		return "服务端未配置 Google OAuth（GOOGLE_OAUTH_CLIENT_ID / SECRET）。请管理员配置后再在设置 → 连接应用 中连接 Gmail。"
	}
	return "尚未连接 Gmail。请用户打开「设置 → 连接应用」点击「连接 Gmail」完成授权后再发信。"
}

func (s *Server) handleInternalGmailSend(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string               `json:"user_id"`
		ConversationID string               `json:"conversation_id"`
		AgentID        string               `json:"agent_id"`
		To             string               `json:"to"`
		Cc             string               `json:"cc"`
		Bcc            string               `json:"bcc"`
		Subject        string               `json:"subject"`
		Body           string               `json:"body"`
		Attachments    []gmailAttachmentIn `json:"attachments"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	to := strings.TrimSpace(body.To)
	subject := strings.TrimSpace(body.Subject)
	msgBody := body.Body
	if uid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	if to == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "to required"})
		return
	}
	if err := validateEmailList(to); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "invalid to: " + err.Error()})
		return
	}
	if cc := strings.TrimSpace(body.Cc); cc != "" {
		if err := validateEmailList(cc); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "invalid cc: " + err.Error()})
			return
		}
	}
	if bcc := strings.TrimSpace(body.Bcc); bcc != "" {
		if err := validateEmailList(bcc); err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "invalid bcc: " + err.Error()})
			return
		}
	}
	hasAttachments := len(body.Attachments) > 0
	if gmailBodyLooksLikePathOnly(msgBody) && !hasAttachments {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "error": gmailPathOnlyBodyHint(),
		})
		return
	}

	cfg := loadGmailOAuthConfig()
	conn, err := s.db.GetOAuthConnection(uid, gmailProvider)
	if err != nil || conn == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "connected": false,
			"error": gmailNotConnectedHint(false, cfg.Enabled()),
		})
		return
	}
	if !gmailHasSendScope(conn.Scopes) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "connected": true, "can_send": false,
			"error": gmailMissingSendScopeHint(),
		})
		return
	}

	cid := strings.TrimSpace(body.ConversationID)
	attachFiles, attachNames, aerr := s.loadGmailAttachments(uid, strings.TrimSpace(body.AgentID), body.Attachments)
	if aerr != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": aerr.Error()})
		return
	}
	preview := buildEmailPreview(subject, msgBody, attachNames)
	rev := hostExecReview{
		Tier:   hostExecReviewConfirm,
		Reason: "将通过已连接的 Gmail（" + conn.AccountEmail + "）发送邮件，需你确认",
		Code:   "email_send_confirm",
	}
	// Product: 不擅自代发 — never skip confirm via allowlist.
	if cid == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "error": "conversation_id required for confirm-before-send",
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), gmailConfirmTimeout)
	defer cancel()
	allowed, reqID, cerr := s.requestChatHostConfirm(
		ctx, uid, cid, "email_send", to, subject, preview, rev,
	)
	if cerr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "denied": true, "error": cerr.Error(), "req_id": reqID,
		})
		return
	}
	if !allowed {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "denied": true, "error": "用户拒绝了这次发信", "req_id": reqID,
		})
		return
	}

	access, err := s.resolveGmailAccessToken(r.Context(), uid, conn)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "connected": false,
			"error": "Gmail 授权已失效，请重新在「设置 → 连接应用」连接：" + err.Error(),
		})
		return
	}
	rawMIME, err := buildRFC822Message(conn.AccountEmail, to, strings.TrimSpace(body.Cc), strings.TrimSpace(body.Bcc), subject, msgBody, attachFiles)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "req_id": reqID})
		return
	}
	msgID, err := gmailAPISend(r.Context(), access, rawMIME)
	result := map[string]any{
		"ok":          err == nil,
		"req_id":      reqID,
		"confirmed":   true,
		"from":        conn.AccountEmail,
		"to":          to,
		"subject":     subject,
		"attachments": attachNames,
	}
	if err != nil {
		errMsg := err.Error()
		if gmailInsufficientScopeError(errMsg) {
			errMsg = gmailMissingSendScopeHint()
		}
		result["error"] = errMsg
	} else {
		result["message_id"] = msgID
	}
	s.finishHostConfirm(uid, cid, result)
	writeJSON(w, http.StatusOK, result)
}

func buildEmailPreview(subject, body string, attachNames []string) string {
	s := strings.TrimSpace(subject)
	b := strings.TrimSpace(body)
	if s == "" {
		s = "(无主题)"
	}
	var parts []string
	parts = append(parts, s)
	if b != "" {
		parts = append(parts, b)
	}
	if len(attachNames) > 0 {
		parts = append(parts, "附件："+strings.Join(attachNames, " · "))
	}
	return strings.Join(parts, "\n\n")
}

func validateEmailList(raw string) error {
	parts := splitAddresses(raw)
	if len(parts) == 0 {
		return errors.New("empty")
	}
	for _, p := range parts {
		if _, err := mail.ParseAddress(p); err != nil {
			return fmt.Errorf("%q", p)
		}
	}
	return nil
}

func splitAddresses(raw string) []string {
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

type gmailAttachmentIn struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
}

type gmailAttachFile struct {
	Filename string
	MIMEType string
	Data     []byte
}

func buildRFC822Message(from, to, cc, bcc, subject, body string, files []gmailAttachFile) (string, error) {
	from = strings.TrimSpace(from)
	if from == "" {
		return "", errors.New("from address missing")
	}
	if len(files) == 0 {
		var b strings.Builder
		b.WriteString("From: " + from + "\r\n")
		b.WriteString("To: " + to + "\r\n")
		if cc != "" {
			b.WriteString("Cc: " + cc + "\r\n")
		}
		if bcc != "" {
			b.WriteString("Bcc: " + bcc + "\r\n")
		}
		b.WriteString("Subject: " + encodeHeader(subject) + "\r\n")
		b.WriteString("MIME-Version: 1.0\r\n")
		b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
		b.WriteString("\r\n")
		b.WriteString(body)
		if !strings.HasSuffix(body, "\n") {
			b.WriteString("\r\n")
		}
		return b.String(), nil
	}
	boundary := "openbot_" + randomState()
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	if cc != "" {
		b.WriteString("Cc: " + cc + "\r\n")
	}
	if bcc != "" {
		b.WriteString("Bcc: " + bcc + "\r\n")
	}
	b.WriteString("Subject: " + encodeHeader(subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"\r\n")
	b.WriteString("\r\n")
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	if !strings.HasSuffix(body, "\n") {
		b.WriteString("\r\n")
	}
	for _, f := range files {
		b.WriteString("--" + boundary + "\r\n")
		ct := f.MIMEType
		if ct == "" {
			ct = "application/octet-stream"
		}
		b.WriteString("Content-Type: " + ct + "\r\n")
		b.WriteString("Content-Transfer-Encoding: base64\r\n")
		b.WriteString("Content-Disposition: attachment; filename=\"" + mimeFilename(f.Filename) + "\"\r\n")
		b.WriteString("\r\n")
		b.WriteString(chunkBase64(f.Data))
		b.WriteString("\r\n")
	}
	b.WriteString("--" + boundary + "--\r\n")
	return b.String(), nil
}

func mimeFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "\"", "_")
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.ReplaceAll(name, "\n", "")
	name = strings.TrimSpace(name)
	if name == "" {
		return "attachment"
	}
	for _, r := range name {
		if r > 127 {
			return mimeEncodeUTF8(name)
		}
	}
	return name
}

func chunkBase64(data []byte) string {
	enc := base64.StdEncoding.EncodeToString(data)
	var b strings.Builder
	for i := 0; i < len(enc); i += 76 {
		end := i + 76
		if end > len(enc) {
			end = len(enc)
		}
		b.WriteString(enc[i:end])
		b.WriteString("\r\n")
	}
	return strings.TrimRight(b.String(), "\r\n")
}

func gmailContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == ".html" || ext == ".htm" {
		return "text/html; charset=UTF-8"
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func (s *Server) loadGmailAttachments(userID, agentID string, specs []gmailAttachmentIn) ([]gmailAttachFile, []string, error) {
	if len(specs) == 0 {
		return nil, nil, nil
	}
	if len(specs) > gmailMaxAttachments {
		return nil, nil, fmt.Errorf("最多 %d 个附件", gmailMaxAttachments)
	}
	var (
		files []gmailAttachFile
		names []string
		total int64
	)
	for i, spec := range specs {
		p := strings.TrimSpace(spec.Path)
		if p == "" {
			return nil, nil, fmt.Errorf("attachments[%d].path required", i)
		}
		wp, err := sandbox.ResolveWorkspacePath(p)
		if err != nil {
			return nil, nil, fmt.Errorf("附件路径无效 %q: %v", p, err)
		}
		op := s.fileOpFrom(userID, agentID, "", wp)
		f, st, err := s.sandboxMgr().OpenWorkspaceFile(op)
		if err != nil {
			return nil, nil, fmt.Errorf("无法读取附件 %s: %v", wp, err)
		}
		size := st.Size()
		if size > gmailMaxAttachBytes {
			_ = f.Close()
			return nil, nil, fmt.Errorf("附件 %s 过大（上限 %d MB/个）", filepath.Base(wp), gmailMaxAttachBytes>>20)
		}
		if total+size > gmailMaxAttachTotal {
			_ = f.Close()
			return nil, nil, fmt.Errorf("附件总大小超过 %d MB", gmailMaxAttachTotal>>20)
		}
		data, err := io.ReadAll(io.LimitReader(f, int64(gmailMaxAttachBytes)+1))
		_ = f.Close()
		if err != nil {
			return nil, nil, fmt.Errorf("读取附件失败 %s: %v", wp, err)
		}
		if int64(len(data)) > gmailMaxAttachBytes {
			return nil, nil, fmt.Errorf("附件 %s 过大（上限 %d MB/个）", filepath.Base(wp), gmailMaxAttachBytes>>20)
		}
		total += int64(len(data))
		name := strings.TrimSpace(spec.Filename)
		if name == "" {
			name = filepath.Base(wp)
		}
		name = filepath.Base(name)
		files = append(files, gmailAttachFile{
			Filename: name,
			MIMEType: gmailContentType(name),
			Data:     data,
		})
		names = append(names, name)
	}
	return files, names, nil
}

func encodeHeader(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	for _, r := range s {
		if r > 127 {
			return mimeEncodeUTF8(s)
		}
	}
	return s
}

func mimeEncodeUTF8(s string) string {
	// RFC 2047 encoded-word
	enc := base64.StdEncoding.EncodeToString([]byte(s))
	return "=?UTF-8?B?" + enc + "?="
}

// ---- Google HTTP helpers ----

type gmailTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func exchangeGmailCode(ctx context.Context, cfg gmailOAuthConfig, code string) (*gmailTokenResponse, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("redirect_uri", cfg.RedirectURI)
	form.Set("grant_type", "authorization_code")
	return postGmailToken(ctx, form)
}

func refreshGmailToken(ctx context.Context, cfg gmailOAuthConfig, refreshToken string) (*gmailTokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", cfg.ClientID)
	form.Set("client_secret", cfg.ClientSecret)
	form.Set("refresh_token", refreshToken)
	form.Set("grant_type", "refresh_token")
	return postGmailToken(ctx, form)
}

// gmailHTTPClient uses ProxyFromEnvironment (HTTP_PROXY/HTTPS_PROXY). Go does not
// read macOS System Settings proxies; without HTTPS_PROXY, calls to
// oauth2.googleapis.com often time out behind Clash/Surge/V2Ray.
func gmailHTTPClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second}
}

func postGmailToken(ctx context.Context, form url.Values) (*gmailTokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gmailTokenURL, strings.NewReader(form.Encode()))
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
	var tok gmailTokenResponse
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, fmt.Errorf("token parse: %w", err)
	}
	if tok.Error != "" || tok.AccessToken == "" {
		msg := tok.Error
		if tok.ErrorDesc != "" {
			msg = msg + ": " + tok.ErrorDesc
		}
		if msg == "" {
			msg = fmt.Sprintf("token http %d", res.StatusCode)
		}
		return nil, errors.New(msg)
	}
	return &tok, nil
}

// gmailQueryParam reads one query value with PathUnescape (preserves '+').
func gmailQueryParam(rawQuery, key string) string {
	if rawQuery == "" || key == "" {
		return ""
	}
	prefix := key + "="
	for _, part := range strings.Split(rawQuery, "&") {
		if part == key {
			return ""
		}
		if !strings.HasPrefix(part, prefix) {
			continue
		}
		val := strings.TrimPrefix(part, prefix)
		dec, err := url.PathUnescape(val)
		if err != nil {
			return val
		}
		return dec
	}
	return ""
}

func mapGmailTokenExchangeError(err error) string {
	if err == nil {
		return "token_exchange_failed"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded") ||
		strings.Contains(msg, "i/o timeout") || strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "token network"):
		return "token_exchange_network"
	case strings.Contains(msg, "redirect_uri_mismatch"):
		return "redirect_uri_mismatch"
	case strings.Contains(msg, "invalid_client"):
		return "invalid_client"
	case strings.Contains(msg, "invalid_grant"):
		return "invalid_grant"
	case strings.Contains(msg, "unauthorized_client"):
		return "unauthorized_client"
	default:
		return "token_exchange_failed"
	}
}

func sanitizeGmailOAuthLog(s string) string {
	// Never log client secrets; truncate long blobs.
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}

func fetchGmailUserEmail(ctx context.Context, accessToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, gmailUserInfoURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("userinfo network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("userinfo http %d", res.StatusCode)
	}
	var info struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(raw, &info); err != nil {
		return "", err
	}
	email := strings.TrimSpace(info.Email)
	if email == "" {
		return "", errors.New("no email in userinfo")
	}
	return email, nil
}

func (s *Server) resolveGmailAccessToken(ctx context.Context, userID string, conn *db.OAuthConnection) (string, error) {
	key, err := crypto.LoadKey()
	if err != nil {
		return "", err
	}
	accessRaw, err := crypto.Decrypt(key, conn.AccessTokenCT)
	if err != nil {
		return "", err
	}
	access := string(accessRaw)
	needRefresh := conn.TokenExpiry != nil && time.Now().After(conn.TokenExpiry.Add(-60*time.Second))
	if !needRefresh {
		return access, nil
	}
	if strings.TrimSpace(conn.RefreshTokenCT) == "" {
		return "", errors.New("access token expired and no refresh token")
	}
	refreshRaw, err := crypto.Decrypt(key, conn.RefreshTokenCT)
	if err != nil {
		return "", err
	}
	cfg := loadGmailOAuthConfig()
	tok, err := refreshGmailToken(ctx, cfg, string(refreshRaw))
	if err != nil {
		_ = s.db.DeleteOAuthConnection(userID, gmailProvider)
		return "", err
	}
	accessCT, err := crypto.Encrypt(key, []byte(tok.AccessToken))
	if err != nil {
		return "", err
	}
	refreshCT := ""
	if tok.RefreshToken != "" {
		refreshCT, _ = crypto.Encrypt(key, []byte(tok.RefreshToken))
	}
	var expiry *time.Time
	if tok.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
		expiry = &t
	}
	_ = s.db.UpdateOAuthTokens(userID, gmailProvider, accessCT, refreshCT, expiry)
	return tok.AccessToken, nil
}

func gmailAPISend(ctx context.Context, accessToken, rawMIME string) (string, error) {
	encoded := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte(rawMIME))
	payload, _ := json.Marshal(map[string]string{"raw": encoded})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gmailSendURL, strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var ge struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &ge)
		msg := strings.TrimSpace(ge.Error.Message)
		if msg == "" {
			msg = fmt.Sprintf("gmail send http %d", res.StatusCode)
		}
		return "", errors.New(msg)
	}
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(raw, &out)
	return out.ID, nil
}
