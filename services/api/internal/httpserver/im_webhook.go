package httpserver

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Telegram and Feishu inbound events share dispatchEventWakes with Slack and
// GitHub. Manual inbound hooks (any label other than openbot-oauth-install,
// or a different id) keep working. Mention filtering applies only to the
// auto-linked install hook.

func (s *Server) handleTelegramWebhook(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	hook, err := s.db.GetInboundHookByToken(token)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown hook"})
		return
	}
	if hook.Provider != "any" && !strings.EqualFold(hook.Provider, telegramProvider) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "hook provider mismatch"})
		return
	}
	if sec := strings.TrimSpace(hook.Secret); sec != "" {
		got := strings.TrimSpace(r.Header.Get("X-Telegram-Bot-Api-Secret-Token"))
		if !hmac.Equal([]byte(sec), []byte(got)) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "bad secret token"})
			return
		}
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body"})
		return
	}
	var upd tgUpdate
	if err := json.Unmarshal(raw, &upd); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if upd.Message == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "no_message"})
		return
	}
	msg := upd.Message
	if msg.From != nil && msg.From.IsBot {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "bot_message"})
		return
	}
	text := strings.TrimSpace(msg.Text)
	if text == "" {
		text = strings.TrimSpace(msg.Caption)
	}
	if text == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "non_text"})
		return
	}
	meta, linked := s.imInstallState(hook.UserID, telegramProvider, hook)
	mentioned := telegramMentioned(*msg, meta.BotUsername, meta.BotID)
	if linked && meta.MentionOnly && telegramNeedsMention(msg.Chat.Type) && !mentioned {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "mention_filter", "fired": 0})
		return
	}
	if linked {
		s.rememberIMTarget(hook.UserID, telegramProvider, strconv.FormatInt(msg.Chat.ID, 10), strconv.FormatInt(msg.MessageID, 10))
	}
	user := ""
	if msg.From != nil {
		user = firstNonEmpty(msg.From.Username, strconv.FormatInt(msg.From.ID, 10))
	}
	ev := db.EventMatch{
		Source: telegramProvider,
		Type:   "message",
		Text:   text,
	}
	if mentioned {
		ev.Action = "mention"
	}
	summary := fmt.Sprintf("source=telegram type=message chat_id=%d chat_type=%s message_id=%d user=%s\ntext=%s",
		msg.Chat.ID, msg.Chat.Type, msg.MessageID, user, text)
	fired := s.dispatchEventWakes(hook.UserID, ev, summary)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "fired": fired})
}

type tgUpdate struct {
	UpdateID int64      `json:"update_id"`
	Message  *tgMessage `json:"message"`
}

type tgMessage struct {
	MessageID int64 `json:"message_id"`
	From      *struct {
		ID       int64  `json:"id"`
		IsBot    bool   `json:"is_bot"`
		Username string `json:"username"`
	} `json:"from"`
	Chat struct {
		ID   int64  `json:"id"`
		Type string `json:"type"`
	} `json:"chat"`
	Text            string     `json:"text"`
	Caption         string     `json:"caption"`
	Entities        []tgEntity `json:"entities"`
	CaptionEntities []tgEntity `json:"caption_entities"`
}

type tgEntity struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
	User   *struct {
		ID int64 `json:"id"`
	} `json:"user"`
}

func telegramNeedsMention(chatType string) bool {
	switch strings.ToLower(strings.TrimSpace(chatType)) {
	case "", "private":
		return false
	default:
		return true
	}
}

func telegramMentioned(msg tgMessage, botUsername string, botID int64) bool {
	uname := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(botUsername)), "@")
	text := msg.Text
	entities := msg.Entities
	if strings.TrimSpace(text) == "" {
		text = msg.Caption
		entities = msg.CaptionEntities
	}
	for _, e := range entities {
		switch e.Type {
		case "text_mention":
			if botID != 0 && e.User != nil && e.User.ID == botID {
				return true
			}
		case "mention":
			slice, ok := sliceUTF16(text, e.Offset, e.Length)
			if !ok || uname == "" {
				continue
			}
			if strings.TrimPrefix(strings.ToLower(slice), "@") == uname {
				return true
			}
		}
	}
	if uname != "" && strings.Contains(strings.ToLower(text), "@"+uname) {
		return true
	}
	return false
}

// sliceUTF16 returns text[offset:offset+length] where offset and length are
// UTF-16 code units, which is how Telegram entity offsets are defined.
func sliceUTF16(s string, offset, length int) (string, bool) {
	if offset < 0 || length < 0 {
		return "", false
	}
	encoded := utf16.Encode([]rune(s))
	end := offset + length
	if offset > len(encoded) || end > len(encoded) {
		return "", false
	}
	return string(utf16.Decode(encoded[offset:end])), true
}

func (s *Server) handleFeishuWebhook(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	hook, err := s.db.GetInboundHookByToken(token)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown hook"})
		return
	}
	if hook.Provider != "any" && !strings.EqualFold(hook.Provider, feishuProvider) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "hook provider mismatch"})
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body"})
		return
	}
	encryptKey := s.feishuEncryptKey(hook.UserID)
	if err := verifyFeishuSignature(r, encryptKey, raw); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "bad signature"})
		return
	}
	payload, err := decodeFeishuBody(raw, encryptKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if !feishuTokenOK(hook.Secret, feishuPayloadToken(payload)) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "bad verification token"})
		return
	}
	evType := feishuEventType(payload)
	if evType == "url_verification" {
		challenge, _ := payload["challenge"].(string)
		writeJSON(w, http.StatusOK, map[string]string{"challenge": challenge})
		return
	}
	if evType != "im.message.receive_v1" && evType != "message" && evType != "event_callback" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "ignored_event"})
		return
	}
	text, chatID, messageID, chatType, senderType, senderOpenID, mentions := feishuMessageFields(payload)
	text = strings.TrimSpace(text)
	if strings.EqualFold(senderType, "app") {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "bot_message"})
		return
	}
	meta, linked := s.imInstallState(hook.UserID, feishuProvider, hook)
	if meta.OpenID != "" && senderOpenID == meta.OpenID {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "bot_message"})
		return
	}
	if text == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "non_text"})
		return
	}
	mentioned := feishuMentioned(mentions, meta.OpenID)
	if linked && meta.MentionOnly && feishuNeedsMention(chatType) && !mentioned {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "mention_filter", "fired": 0})
		return
	}
	if linked {
		s.rememberIMTarget(hook.UserID, feishuProvider, chatID, messageID)
	}
	ev := db.EventMatch{
		Source: feishuProvider,
		Type:   "message",
		Text:   text,
	}
	if mentioned {
		ev.Action = "mention"
	}
	summary := fmt.Sprintf("source=feishu type=%s chat_id=%s chat_type=%s message_id=%s\ntext=%s",
		evType, chatID, chatType, messageID, text)
	fired := s.dispatchEventWakes(hook.UserID, ev, summary)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "fired": fired})
}

func verifyFeishuSignature(r *http.Request, encryptKey string, body []byte) error {
	ts := strings.TrimSpace(r.Header.Get("X-Lark-Request-Timestamp"))
	nonce := strings.TrimSpace(r.Header.Get("X-Lark-Request-Nonce"))
	sig := strings.TrimSpace(r.Header.Get("X-Lark-Signature"))
	if ts == "" && nonce == "" && sig == "" {
		return nil
	}
	if strings.TrimSpace(encryptKey) == "" || !feishuTimestampFresh(ts) || !validFeishuSignature(ts, nonce, encryptKey, sig, body) {
		return errors.New("bad signature")
	}
	return nil
}

func feishuTimestampFresh(ts string) bool {
	n, err := strconv.ParseInt(strings.TrimSpace(ts), 10, 64)
	if err != nil {
		return false
	}
	if n > 1_000_000_000_000 {
		n /= 1000
	}
	delta := time.Since(time.Unix(n, 0))
	if delta < 0 {
		delta = -delta
	}
	return delta < time.Hour
}

func validFeishuSignature(timestamp, nonce, encryptKey, got string, body []byte) bool {
	got = strings.ToLower(strings.TrimSpace(got))
	if got == "" || strings.TrimSpace(encryptKey) == "" {
		return false
	}
	sum := sha256.Sum256([]byte(timestamp + nonce + encryptKey + string(body)))
	want := hex.EncodeToString(sum[:])
	return hmac.Equal([]byte(want), []byte(got))
}

func decodeFeishuBody(raw []byte, encryptKey string) (map[string]any, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("invalid json")
	}
	enc, _ := payload["encrypt"].(string)
	enc = strings.TrimSpace(enc)
	if enc == "" {
		return payload, nil
	}
	if strings.TrimSpace(encryptKey) == "" {
		return nil, errors.New("缺少 Encrypt Key，无法解密事件")
	}
	plain, err := decryptFeishuEncrypt(enc, encryptKey)
	if err != nil {
		return nil, errors.New("事件解密失败")
	}
	payload = map[string]any{}
	if err := json.Unmarshal(plain, &payload); err != nil {
		return nil, errors.New("解密后的事件不是 JSON")
	}
	return payload, nil
}

func decryptFeishuEncrypt(encryptB64, encryptKey string) ([]byte, error) {
	cipherRaw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encryptB64))
	if err != nil {
		return nil, err
	}
	if len(cipherRaw) < aes.BlockSize || len(cipherRaw)%aes.BlockSize != 0 {
		return nil, errors.New("bad ciphertext")
	}
	key := sha256.Sum256([]byte(encryptKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	iv := cipherRaw[:aes.BlockSize]
	data := make([]byte, len(cipherRaw)-aes.BlockSize)
	copy(data, cipherRaw[aes.BlockSize:])
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(data, data)
	return pkcs7Unpad(data)
}

func pkcs7Unpad(b []byte) ([]byte, error) {
	if len(b) == 0 || len(b)%aes.BlockSize != 0 {
		return nil, errors.New("bad padding")
	}
	n := int(b[len(b)-1])
	if n == 0 || n > aes.BlockSize || n > len(b) {
		return nil, errors.New("bad padding")
	}
	for _, c := range b[len(b)-n:] {
		if int(c) != n {
			return nil, errors.New("bad padding")
		}
	}
	return b[:len(b)-n], nil
}

func feishuPayloadToken(p map[string]any) string {
	if p == nil {
		return ""
	}
	if t, _ := p["token"].(string); strings.TrimSpace(t) != "" {
		return strings.TrimSpace(t)
	}
	if h, ok := p["header"].(map[string]any); ok {
		if t, _ := h["token"].(string); strings.TrimSpace(t) != "" {
			return strings.TrimSpace(t)
		}
	}
	return ""
}

func feishuTokenOK(want, got string) bool {
	want = strings.TrimSpace(want)
	if want == "" {
		return true
	}
	return hmac.Equal([]byte(want), []byte(strings.TrimSpace(got)))
}

func feishuEventType(p map[string]any) string {
	if p == nil {
		return ""
	}
	if t, _ := p["type"].(string); strings.TrimSpace(t) != "" {
		return strings.TrimSpace(t)
	}
	if h, ok := p["header"].(map[string]any); ok {
		if t, _ := h["event_type"].(string); strings.TrimSpace(t) != "" {
			return strings.TrimSpace(t)
		}
	}
	return ""
}

func feishuMessageFields(p map[string]any) (text, chatID, messageID, chatType, senderType, senderOpenID string, mentions []string) {
	if p == nil {
		return
	}
	if ev, ok := p["event"].(map[string]any); ok {
		if msg, ok := ev["message"].(map[string]any); ok {
			messageID, _ = msg["message_id"].(string)
			chatID, _ = msg["chat_id"].(string)
			chatType, _ = msg["chat_type"].(string)
			if content, _ := msg["content"].(string); content != "" {
				text = feishuPlainText(content)
			}
			if raw, ok := msg["mentions"].([]any); ok {
				for _, item := range raw {
					m, _ := item.(map[string]any)
					if m == nil {
						continue
					}
					id, _ := m["id"].(map[string]any)
					if id == nil {
						continue
					}
					if oid, _ := id["open_id"].(string); strings.TrimSpace(oid) != "" {
						mentions = append(mentions, strings.TrimSpace(oid))
					}
				}
			}
		}
		if sender, ok := ev["sender"].(map[string]any); ok {
			senderType, _ = sender["sender_type"].(string)
			if id, ok := sender["sender_id"].(map[string]any); ok {
				senderOpenID, _ = id["open_id"].(string)
			}
		}
	}
	if strings.TrimSpace(text) == "" {
		if t, _ := p["text"].(string); strings.TrimSpace(t) != "" {
			text = t
		}
	}
	if strings.TrimSpace(chatID) == "" {
		chatID, _ = p["chat_id"].(string)
	}
	if strings.TrimSpace(messageID) == "" {
		messageID, _ = p["message_id"].(string)
	}
	if strings.TrimSpace(chatType) == "" {
		chatType, _ = p["chat_type"].(string)
	}
	return
}

func feishuPlainText(content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	var body struct {
		Text string `json:"text"`
	}
	if json.Unmarshal([]byte(content), &body) == nil && strings.TrimSpace(body.Text) != "" {
		return body.Text
	}
	return content
}

func feishuMentioned(openIDs []string, botOpenID string) bool {
	if len(openIDs) == 0 {
		return false
	}
	botOpenID = strings.TrimSpace(botOpenID)
	if botOpenID == "" {
		return true
	}
	for _, id := range openIDs {
		if id == botOpenID {
			return true
		}
	}
	return false
}

func feishuNeedsMention(chatType string) bool {
	switch strings.ToLower(strings.TrimSpace(chatType)) {
	case "", "p2p", "private":
		return false
	default:
		return true
	}
}
