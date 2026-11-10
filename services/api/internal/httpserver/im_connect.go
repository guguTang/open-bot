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
	"strconv"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/crypto"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Telegram and Feishu phase-1 connect.
//
// Credentials are encrypted into oauth_connections (same row shape as Slack /
// GitHub). A successful connect binds one inbound hook labeled
// openbot-oauth-install. Disconnect deletes that hook only, then the
// credential row. Hand-pasted hooks and other providers stay.
//
// Feishu column use: access_token_ct = App Secret, refresh_token_ct = Encrypt
// Key. Do not call UpdateOAuthTokens for provider=feishu.
// Verification Token lives on the hook secret (same place as a GitHub secret).

func imEncryptionReady() bool {
	_, err := crypto.LoadKey()
	return err == nil
}

func (s *Server) handleTelegramStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.installStatusPayload(userIDFrom(r.Context()), telegramProvider, imEncryptionReady()))
}

func (s *Server) handleFeishuStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.installStatusPayload(userIDFrom(r.Context()), feishuProvider, imEncryptionReady()))
}

func (s *Server) handleTelegramDisconnect(w http.ResponseWriter, r *http.Request) {
	res, err := s.disconnectOAuthInstall(r.Context(), userIDFrom(r.Context()), telegramProvider)
	writeInstallDisconnect(w, res, err)
}

func (s *Server) handleFeishuDisconnect(w http.ResponseWriter, r *http.Request) {
	res, err := s.disconnectOAuthInstall(r.Context(), userIDFrom(r.Context()), feishuProvider)
	writeInstallDisconnect(w, res, err)
}

type telegramConnectBody struct {
	BotToken    string `json:"bot_token"`
	MentionOnly bool   `json:"mention_only"`
}

type feishuConnectBody struct {
	AppID             string `json:"app_id"`
	AppSecret         string `json:"app_secret"`
	EncryptKey        string `json:"encrypt_key"`
	VerificationToken string `json:"verification_token"`
	MentionOnly       bool   `json:"mention_only"`
	Domain            string `json:"domain"`
}

func (s *Server) handleTelegramConnect(w http.ResponseWriter, r *http.Request) {
	if !imEncryptionReady() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "无法加密保存凭据：请设置 BOT_SECRETS_KEY 或 ENCRYPTION_KEY 后重启 API",
		})
		return
	}
	var body telegramConnectBody
	if err := readOptionalJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	token := strings.TrimSpace(body.BotToken)
	if token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "缺少 Bot token。请粘贴 @BotFather 发给你的 token，本服务不会代你创建机器人。",
		})
		return
	}
	if err := validateBotToken(token); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database unavailable"})
		return
	}
	bot, err := telegramGetMe(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "Bot token 无效或无法访问 Telegram：" + redactSecret(err.Error(), token),
		})
		return
	}
	uid := userIDFrom(r.Context())
	payload, err := s.storeTelegramInstall(r.Context(), uid, token, bot, body.MentionOnly)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": installStoreErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleFeishuConnect(w http.ResponseWriter, r *http.Request) {
	if !imEncryptionReady() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "无法加密保存凭据：请设置 BOT_SECRETS_KEY 或 ENCRYPTION_KEY 后重启 API",
		})
		return
	}
	var body feishuConnectBody
	if err := readOptionalJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	appID := strings.TrimSpace(body.AppID)
	appSecret := strings.TrimSpace(body.AppSecret)
	encryptKey := strings.TrimSpace(body.EncryptKey)
	verify := strings.TrimSpace(body.VerificationToken)
	switch {
	case appID == "" || appSecret == "" || encryptKey == "":
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "缺少 App ID、App Secret 或 Encrypt Key。本服务不会代你创建飞书应用。",
		})
		return
	case len(appID) > 128 || len(appSecret) > 256 || len(encryptKey) > 256 || len(verify) > 256:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "凭据过长"})
		return
	case strings.ContainsAny(appID, " \t\r\n"):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "App ID 不能包含空白"})
		return
	}
	domain, err := normalizeIMDomain(body.Domain)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database unavailable"})
		return
	}
	tenant, err := feishuTenantToken(r.Context(), domain, appID, appSecret)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{
			"error": "App ID / App Secret 无效或无法访问开放平台：" + redactSecret(err.Error(), appSecret),
		})
		return
	}
	openID, appName := feishuBotIdentity(r.Context(), domain, tenant)
	uid := userIDFrom(r.Context())
	payload, err := s.storeFeishuInstall(uid, domain, appID, appSecret, encryptKey, verify, appName, openID, body.MentionOnly)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": installStoreErrorCode(err)})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func validateBotToken(token string) error {
	if len(token) < 20 || len(token) > 200 {
		return errors.New("Bot token 长度不对。请粘贴 @BotFather 的完整 token。")
	}
	if strings.ContainsAny(token, " \t\r\n/") || !strings.Contains(token, ":") {
		return errors.New("Bot token 格式不对。它应类似 123456:AAA...，且不能包含空格。")
	}
	return nil
}

func normalizeIMDomain(v string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "feishu":
		return "feishu", nil
	case "lark", "larksuite":
		return "lark", nil
	default:
		return "", errors.New("domain 只能是 feishu 或 lark")
	}
}

func (s *Server) storeTelegramInstall(ctx context.Context, userID, token string, bot telegramBot, mentionOnly bool) (map[string]any, error) {
	accessCT, err := encryptInstallSecret(token)
	if err != nil {
		return nil, err
	}
	linked := ""
	var keptChat, keptMessage string
	if prev, err := s.db.GetOAuthConnection(userID, telegramProvider); err == nil && prev != nil {
		linked = prev.LinkedHookID
		old := parseInstallMeta(prev.MetadataJSON)
		keptChat, keptMessage = old.LastChatID, old.LastMessageID
	}
	hook, err := s.ensureOAuthInstallHook(userID, telegramProvider, linked)
	if err != nil {
		return nil, err
	}
	account := telegramAccount(bot)
	meta := installMeta{
		Mode:          "bot_token",
		Account:       account,
		BotUsername:   bot.Username,
		BotID:         bot.ID,
		MentionOnly:   mentionOnly,
		LastChatID:    keptChat,
		LastMessageID: keptMessage,
	}
	if _, err := s.db.UpsertOAuthInstall(userID, telegramProvider, account, "bot", accessCT, "", hook.ID, meta.JSON(), nil); err != nil {
		return nil, err
	}
	hookURL := installHookURL(telegramProvider, hook.Token)
	if err := telegramSetWebhook(ctx, token, hookURL, hook.Secret); err != nil {
		meta.WebhookAttached = false
		meta.AttachError = trimErr(redactSecret(err.Error(), token), 400)
	} else {
		meta.WebhookAttached = true
		meta.AttachError = ""
	}
	if err := s.db.UpdateOAuthInstallMeta(userID, telegramProvider, meta.JSON()); err != nil {
		log.Printf("telegram connect: meta update: %v", err)
	}
	payload := s.installStatusPayload(userID, telegramProvider, true)
	payload["webhook_attached"] = meta.WebhookAttached
	if meta.AttachError != "" {
		payload["attach_error"] = meta.AttachError
	}
	return payload, nil
}

func telegramAccount(bot telegramBot) string {
	if u := strings.TrimPrefix(strings.TrimSpace(bot.Username), "@"); u != "" {
		return "@" + u
	}
	if bot.ID != 0 {
		return strconv.FormatInt(bot.ID, 10)
	}
	if n := strings.TrimSpace(bot.Name); n != "" {
		return n
	}
	return "telegram"
}

func (s *Server) storeFeishuInstall(userID, domain, appID, appSecret, encryptKey, verify, appName, openID string, mentionOnly bool) (map[string]any, error) {
	accessCT, err := encryptInstallSecret(appSecret)
	if err != nil {
		return nil, err
	}
	refreshCT, err := encryptInstallSecret(encryptKey)
	if err != nil {
		return nil, err
	}
	linked := ""
	var keptChat, keptMessage string
	if prev, err := s.db.GetOAuthConnection(userID, feishuProvider); err == nil && prev != nil {
		linked = prev.LinkedHookID
		old := parseInstallMeta(prev.MetadataJSON)
		keptChat, keptMessage = old.LastChatID, old.LastMessageID
	}
	hook, err := s.ensureOAuthInstallHook(userID, feishuProvider, linked)
	if err != nil {
		return nil, err
	}
	if err := s.db.UpdateInboundHookSecret(userID, hook.ID, verify); err != nil {
		return nil, err
	}
	account := appID
	if name := strings.TrimSpace(appName); name != "" {
		account = name + " (" + appID + ")"
	}
	meta := installMeta{
		Mode:          "app_credentials",
		Account:       account,
		AppID:         appID,
		Domain:        domain,
		OpenID:        openID,
		MentionOnly:   mentionOnly,
		LastChatID:    keptChat,
		LastMessageID: keptMessage,
	}
	if _, err := s.db.UpsertOAuthInstall(
		userID, feishuProvider, account, "im.message.receive_v1", accessCT, refreshCT, hook.ID, meta.JSON(), nil,
	); err != nil {
		return nil, err
	}
	return s.installStatusPayload(userID, feishuProvider, true), nil
}

func (s *Server) bestEffortDeleteTelegramWebhook(ctx context.Context, conn *db.OAuthConnection) {
	if conn == nil {
		return
	}
	token, err := decryptInstallSecret(conn.AccessTokenCT)
	if err != nil || strings.TrimSpace(token) == "" {
		log.Printf("telegram disconnect: skip deleteWebhook: %v", err)
		return
	}
	if err := telegramDeleteWebhook(ctx, token); err != nil {
		log.Printf("telegram disconnect: deleteWebhook: %s", redactSecret(err.Error(), token))
	}
}

type imReplyBody struct {
	Text      string `json:"text"`
	ChatID    string `json:"chat_id"`
	MessageID string `json:"message_id"`
}

func (s *Server) handleTelegramReply(w http.ResponseWriter, r *http.Request) {
	s.handleIMReply(w, r, telegramProvider)
}

func (s *Server) handleFeishuReply(w http.ResponseWriter, r *http.Request) {
	s.handleIMReply(w, r, feishuProvider)
}

func (s *Server) handleIMReply(w http.ResponseWriter, r *http.Request, provider string) {
	var body imReplyBody
	if err := readOptionalJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少 text"})
		return
	}
	if len(text) > 4096 {
		text = text[:4096]
	}
	uid := userIDFrom(r.Context())
	conn, err := s.db.GetOAuthConnection(uid, provider)
	if err != nil || conn == nil {
		if err != nil && !errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": "尚未连接 " + provider + "，没有可用来回复的凭据。",
		})
		return
	}
	meta := parseInstallMeta(conn.MetadataJSON)
	switch provider {
	case telegramProvider:
		token, derr := decryptInstallSecret(conn.AccessTokenCT)
		if derr != nil || strings.TrimSpace(token) == "" {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "无法读出 Bot token"})
			return
		}
		chatID := firstNonEmpty(strings.TrimSpace(body.ChatID), meta.LastChatID)
		if chatID == "" {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "还没有可回复的会话。先让对方给机器人发一条消息，或在请求里带上 chat_id。",
			})
			return
		}
		replyTo := firstNonEmpty(strings.TrimSpace(body.MessageID), meta.LastMessageID)
		if err := telegramSendMessage(r.Context(), token, chatID, replyTo, text); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{
				"error": "Telegram sendMessage 失败：" + redactSecret(err.Error(), token),
			})
			return
		}
	case feishuProvider:
		appSecret, derr := decryptInstallSecret(conn.AccessTokenCT)
		if derr != nil || strings.TrimSpace(appSecret) == "" {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "无法读出 App Secret"})
			return
		}
		messageID := firstNonEmpty(strings.TrimSpace(body.MessageID), meta.LastMessageID)
		if messageID == "" {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "还没有可回复的消息。先收到一条飞书消息，或在请求里带上 message_id。",
			})
			return
		}
		appID := firstNonEmpty(meta.AppID, conn.AccountEmail)
		domain := firstNonEmpty(meta.Domain, "feishu")
		if err := feishuReplyMessage(r.Context(), domain, appID, appSecret, messageID, text); err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{
				"error": "飞书回复失败：" + redactSecret(err.Error(), appSecret),
			})
			return
		}
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported provider"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "provider": provider})
}

func (s *Server) rememberIMTarget(userID, provider, chatID, messageID string) {
	if s == nil || s.db == nil {
		return
	}
	chatID = strings.TrimSpace(chatID)
	messageID = strings.TrimSpace(messageID)
	if chatID == "" && messageID == "" {
		return
	}
	conn, err := s.db.GetOAuthConnection(userID, provider)
	if err != nil || conn == nil {
		return
	}
	meta := parseInstallMeta(conn.MetadataJSON)
	if chatID != "" {
		meta.LastChatID = chatID
	}
	if messageID != "" {
		meta.LastMessageID = messageID
	}
	if err := s.db.UpdateOAuthInstallMeta(userID, provider, meta.JSON()); err != nil {
		log.Printf("im remember target %s: %v", provider, err)
	}
}

func (s *Server) imInstallState(userID, provider string, hook *db.InboundHook) (installMeta, bool) {
	var zero installMeta
	if s == nil || s.db == nil || hook == nil {
		return zero, false
	}
	conn, err := s.db.GetOAuthConnection(userID, provider)
	if err != nil || conn == nil {
		return zero, false
	}
	if !oauthInstallHookDeletable(hook, userID, provider, conn.LinkedHookID) {
		return zero, false
	}
	return parseInstallMeta(conn.MetadataJSON), true
}

func (s *Server) feishuEncryptKey(userID string) string {
	if s == nil || s.db == nil {
		return ""
	}
	conn, err := s.db.GetOAuthConnection(userID, feishuProvider)
	if err != nil || conn == nil {
		return ""
	}
	key, err := decryptInstallSecret(conn.RefreshTokenCT)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(key)
}

func redactSecret(msg, secret string) string {
	secret = strings.TrimSpace(secret)
	if secret == "" || msg == "" {
		return msg
	}
	return strings.ReplaceAll(msg, secret, "[redacted]")
}

func trimErr(msg string, n int) string {
	msg = strings.TrimSpace(msg)
	if len(msg) <= n {
		return msg
	}
	return msg[:n]
}

func telegramAPIRoot() string {
	if v := strings.TrimRight(strings.TrimSpace(os.Getenv("TELEGRAM_API_BASE")), "/"); v != "" {
		return v
	}
	return "https://api.telegram.org"
}

func feishuAPIRoot(domain string) string {
	if v := strings.TrimRight(strings.TrimSpace(os.Getenv("FEISHU_API_BASE")), "/"); v != "" {
		return v
	}
	if strings.EqualFold(strings.TrimSpace(domain), "lark") {
		return "https://open.larksuite.com"
	}
	return "https://open.feishu.cn"
}

type telegramBot struct {
	ID       int64
	Username string
	Name     string
}

func telegramGetMe(ctx context.Context, token string) (telegramBot, error) {
	var result struct {
		ID        int64  `json:"id"`
		IsBot     bool   `json:"is_bot"`
		Username  string `json:"username"`
		FirstName string `json:"first_name"`
	}
	if err := telegramCall(ctx, token, http.MethodGet, "getMe", nil, &result); err != nil {
		return telegramBot{}, err
	}
	if result.ID == 0 && strings.TrimSpace(result.Username) == "" {
		return telegramBot{}, errors.New("getMe 没有返回机器人")
	}
	return telegramBot{ID: result.ID, Username: result.Username, Name: result.FirstName}, nil
}

func telegramSetWebhook(ctx context.Context, token, hookURL, secret string) error {
	payload := map[string]any{
		"url":                  hookURL,
		"allowed_updates":      []string{"message"},
		"drop_pending_updates": false,
	}
	if sec := strings.TrimSpace(secret); sec != "" {
		payload["secret_token"] = sec
	}
	return telegramCall(ctx, token, http.MethodPost, "setWebhook", payload, nil)
}

func telegramDeleteWebhook(ctx context.Context, token string) error {
	return telegramCall(ctx, token, http.MethodPost, "deleteWebhook", map[string]any{
		"drop_pending_updates": false,
	}, nil)
}

// telegramSendMessage replies in the same chat. replyToMessageID is optional;
// when set, Telegram threads the reply onto that message.
func telegramSendMessage(ctx context.Context, token, chatID, replyToMessageID, text string) error {
	chatID = strings.TrimSpace(chatID)
	text = strings.TrimSpace(text)
	if chatID == "" || text == "" {
		return errors.New("chat_id and text required")
	}
	payload := map[string]any{
		"chat_id": chatID,
		"text":    text,
	}
	if id := strings.TrimSpace(replyToMessageID); id != "" && id != "0" {
		n, err := strconv.ParseInt(id, 10, 64)
		if err != nil || n == 0 {
			return errors.New("reply_to message_id 无效")
		}
		payload["reply_to_message_id"] = n
	}
	return telegramCall(ctx, token, http.MethodPost, "sendMessage", payload, nil)
}

func telegramCall(ctx context.Context, token, httpMethod, method string, payload any, dest any) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("missing bot token")
	}
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
		httpMethod = http.MethodPost
	}
	endpoint := telegramAPIRoot() + "/bot" + token + "/" + method
	req, err := http.NewRequestWithContext(ctx, httpMethod, endpoint, body)
	if err != nil {
		return err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return fmt.Errorf("telegram network: %s", redactSecret(err.Error(), token))
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("telegram http %d: %s", res.StatusCode, trimErr(redactSecret(string(raw), token), 300))
	}
	var env struct {
		OK          bool            `json:"ok"`
		Description string          `json:"description"`
		Result      json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("telegram parse: %w", err)
	}
	if !env.OK {
		msg := strings.TrimSpace(env.Description)
		if msg == "" {
			msg = "telegram api error"
		}
		return errors.New(msg)
	}
	if dest != nil && len(env.Result) > 0 && string(env.Result) != "null" {
		if err := json.Unmarshal(env.Result, dest); err != nil {
			return err
		}
	}
	return nil
}

func feishuTenantToken(ctx context.Context, domain, appID, appSecret string) (string, error) {
	var env struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
	}
	err := feishuJSON(ctx, http.MethodPost, feishuAPIRoot(domain)+"/open-apis/auth/v3/tenant_access_token/internal", "", map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	}, &env)
	if err != nil {
		return "", err
	}
	if env.Code != 0 || strings.TrimSpace(env.TenantAccessToken) == "" {
		msg := strings.TrimSpace(env.Msg)
		if msg == "" {
			msg = "tenant_access_token 为空"
		}
		return "", errors.New(msg)
	}
	return env.TenantAccessToken, nil
}

func feishuBotIdentity(ctx context.Context, domain, tenantToken string) (openID, appName string) {
	var env struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Bot  struct {
			OpenID  string `json:"open_id"`
			AppName string `json:"app_name"`
		} `json:"bot"`
	}
	if err := feishuJSON(ctx, http.MethodGet, feishuAPIRoot(domain)+"/open-apis/bot/v3/info", tenantToken, nil, &env); err != nil {
		log.Printf("feishu bot info: %s", trimErr(err.Error(), 200))
		return "", ""
	}
	if env.Code != 0 {
		log.Printf("feishu bot info: %s", trimErr(env.Msg, 200))
		return "", ""
	}
	return strings.TrimSpace(env.Bot.OpenID), strings.TrimSpace(env.Bot.AppName)
}

// feishuReplyMessage replies in the same thread via the message reply API.
func feishuReplyMessage(ctx context.Context, domain, appID, appSecret, messageID, text string) error {
	messageID = strings.TrimSpace(messageID)
	text = strings.TrimSpace(text)
	appID = strings.TrimSpace(appID)
	appSecret = strings.TrimSpace(appSecret)
	if messageID == "" || text == "" || appID == "" || appSecret == "" {
		return errors.New("message_id, text, app id and app secret required")
	}
	tenant, err := feishuTenantToken(ctx, domain, appID, appSecret)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return err
	}
	var env struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	endpoint := feishuAPIRoot(domain) + "/open-apis/im/v1/messages/" + url.PathEscape(messageID) + "/reply"
	if err := feishuJSON(ctx, http.MethodPost, endpoint, tenant, map[string]string{
		"msg_type": "text",
		"content":  string(content),
	}, &env); err != nil {
		return err
	}
	if env.Code != 0 {
		msg := strings.TrimSpace(env.Msg)
		if msg == "" {
			msg = "feishu reply failed"
		}
		return errors.New(msg)
	}
	return nil
}

func feishuJSON(ctx context.Context, method, endpoint, bearer string, payload any, dest any) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(bearer) != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	res, err := gmailHTTPClient().Do(req)
	if err != nil {
		return fmt.Errorf("feishu network: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("feishu http %d: %s", res.StatusCode, trimErr(string(raw), 300))
	}
	if dest == nil {
		return nil
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("feishu parse: %w", err)
	}
	return nil
}
