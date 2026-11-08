package httpserver

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestIMStatusAndConnectRejectMissingCredentials(t *testing.T) {
	t.Setenv("BOT_SECRETS_KEY", "")
	t.Setenv("ENCRYPTION_KEY", "")
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/v1/integrations/telegram", nil)
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec := httptest.NewRecorder()
	s.handleTelegramStatus(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["oauth_configured"] != false || body["connected"] != false || body["connect_mode"] != "credentials" {
		t.Fatalf("status=%s", rec.Body.String())
	}
	if _, ok := body["hook_url"]; ok {
		t.Fatal("unconfigured status must not invent a webhook url")
	}

	setInstallTestEnv(t)
	req = httptest.NewRequest(http.MethodPost, "/v1/integrations/telegram/connect", strings.NewReader(`{}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec = httptest.NewRecorder()
	s.handleTelegramConnect(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Bot token") {
		t.Fatalf("telegram missing %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/integrations/feishu/connect", strings.NewReader(`{"app_id":"cli_x","app_secret":"sec"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec = httptest.NewRecorder()
	s.handleFeishuConnect(rec, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Encrypt Key") {
		t.Fatalf("feishu missing %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/integrations/feishu/connect", strings.NewReader(`{"app_id":"cli_x","app_secret":"sec","encrypt_key":"k","domain":"discord"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec = httptest.NewRecorder()
	s.handleFeishuConnect(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("domain %d %s", rec.Code, rec.Body.String())
	}
}

func TestIMEncryptionMissingIsHonest(t *testing.T) {
	t.Setenv("BOT_SECRETS_KEY", "")
	t.Setenv("ENCRYPTION_KEY", "")
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/v1/integrations/telegram/connect", strings.NewReader(`{"bot_token":"123456789:AAEexampletokenvalue"}`))
	req = req.WithContext(context.WithValue(req.Context(), userIDKey, "user-1"))
	rec := httptest.NewRecorder()
	s.handleTelegramConnect(rec, req)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "BOT_SECRETS_KEY") {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}

func TestFeishuDecryptAndSignature(t *testing.T) {
	plain := `{"type":"url_verification","challenge":"ch-9","token":"vt"}`
	enc := encryptFeishuPayload(t, "encrypt-key", plain)
	got, err := decryptFeishuEncrypt(enc, "encrypt-key")
	if err != nil || string(got) != plain {
		t.Fatalf("got=%s err=%v", got, err)
	}
	if _, err := decryptFeishuEncrypt(enc, "other-key"); err == nil {
		t.Fatal("wrong key must fail")
	}
	body := []byte(`{"encrypt":"` + enc + `"}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	sum := sha256.Sum256([]byte(ts + "nonce" + "encrypt-key" + string(body)))
	sig := hexEncode(sum[:])
	if !validFeishuSignature(ts, "nonce", "encrypt-key", sig, body) {
		t.Fatal("signature rejected")
	}
	if validFeishuSignature(ts, "nonce", "encrypt-key", "00", body) {
		t.Fatal("bad signature accepted")
	}
	if feishuTimestampFresh(strconv.FormatInt(time.Now().Add(-2*time.Hour).Unix(), 10)) {
		t.Fatal("stale timestamp accepted")
	}
}

func TestTelegramMentionAndFeishuHelpers(t *testing.T) {
	msg := tgMessage{
		Text: "hi @open_bot",
		Entities: []tgEntity{{
			Type:   "mention",
			Offset: 3,
			Length: 9,
		}},
	}
	if !telegramMentioned(msg, "@open_bot", 9) {
		t.Fatal("expected ascii mention")
	}
	if telegramMentioned(msg, "other_bot", 9) {
		t.Fatal("wrong username matched")
	}
	emoji := tgMessage{
		Text: "🙂 @ab",
		Entities: []tgEntity{{
			Type:   "mention",
			Offset: 3, // 🙂 is a surrogate pair (2 UTF-16 units) plus the space
			Length: 3,
		}},
	}
	if !telegramMentioned(emoji, "ab", 0) {
		t.Fatal("utf-16 mention offset missed")
	}
	if telegramNeedsMention("private") || !telegramNeedsMention("supergroup") {
		t.Fatal("chat type gate")
	}
	if !feishuMentioned([]string{"ou_bot"}, "ou_bot") || feishuMentioned([]string{"ou_other"}, "ou_bot") {
		t.Fatal("feishu open_id mention")
	}
	if !feishuMentioned([]string{"ou_any"}, "") {
		t.Fatal("unknown bot open_id should treat any mention as a hit")
	}
	if feishuNeedsMention("p2p") || !feishuNeedsMention("group") {
		t.Fatal("feishu chat type")
	}
	if feishuPlainText(`{"text":"你好 @_user_1"}`) != "你好 @_user_1" {
		t.Fatal("content unwrap")
	}

	msgTrig := &db.Routine{Enabled: true, Triggers: []db.RoutineTrigger{{Source: "telegram", Type: "message"}}}
	if !db.RoutineMatchesEvent(msgTrig, db.EventMatch{Source: "telegram", Type: "message", Text: "hi"}) {
		t.Fatal("telegram message trigger")
	}
	if db.RoutineMatchesEvent(msgTrig, db.EventMatch{Source: "slack", Type: "message", Text: "hi"}) {
		t.Fatal("slack event must not match a telegram trigger")
	}
	kw := &db.Routine{Enabled: true, Triggers: []db.RoutineTrigger{{Source: "feishu", Type: "keyword", Keywords: []string{"日报"}}}}
	if !db.RoutineMatchesEvent(kw, db.EventMatch{Source: "feishu", Type: "message", Text: "请出日报"}) {
		t.Fatal("feishu keyword")
	}
	if db.RoutineMatchesEvent(kw, db.EventMatch{Source: "feishu", Type: "message", Text: "hello"}) {
		t.Fatal("keyword should miss")
	}
	mention := &db.Routine{Enabled: true, Triggers: []db.RoutineTrigger{{Source: "telegram", Type: "message", Actions: []string{"mention"}}}}
	if !db.RoutineMatchesEvent(mention, db.EventMatch{Source: "telegram", Type: "message", Action: "mention", Text: "@bot"}) {
		t.Fatal("mention action")
	}
	if db.RoutineMatchesEvent(mention, db.EventMatch{Source: "telegram", Type: "message", Text: "nope"}) {
		t.Fatal("non-mention should miss action filter")
	}
}

func TestIMReplyStubs(t *testing.T) {
	var mu sync.Mutex
	var calls []recordedCall
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		mu.Lock()
		calls = append(calls, recordedCall{Path: r.URL.Path, Body: body, Auth: r.Header.Get("Authorization")})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/sendMessage"):
			_, _ = w.Write([]byte(`{"ok":true,"result":{"message_id":3}}`))
		case strings.HasSuffix(r.URL.Path, "/tenant_access_token/internal"):
			if body["app_id"] != "cli_app" || body["app_secret"] != "sec" {
				t.Errorf("tenant body=%v", body)
			}
			_, _ = w.Write([]byte(`{"code":0,"tenant_access_token":"t-1","expire":7200}`))
		case strings.Contains(r.URL.Path, "/messages/") && strings.HasSuffix(r.URL.Path, "/reply"):
			_, _ = w.Write([]byte(`{"code":0,"msg":"ok"}`))
		default:
			t.Errorf("unexpected %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	t.Setenv("TELEGRAM_API_BASE", srv.URL)
	t.Setenv("FEISHU_API_BASE", srv.URL)

	if err := telegramSendMessage(context.Background(), "123:TOKEN", "42", "7", "pong"); err != nil {
		t.Fatal(err)
	}
	if err := feishuReplyMessage(context.Background(), "feishu", "cli_app", "sec", "om_1", "收到"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(calls) != 3 {
		t.Fatalf("calls=%d", len(calls))
	}
	send := calls[0]
	if !strings.Contains(send.Path, "/bot123:TOKEN/sendMessage") {
		t.Fatalf("path=%s", send.Path)
	}
	if send.Body["chat_id"] != "42" || send.Body["text"] != "pong" || send.Body["reply_to_message_id"] != float64(7) {
		t.Fatalf("send=%v", send.Body)
	}
	reply := calls[2]
	if !strings.HasSuffix(reply.Path, "/messages/om_1/reply") || reply.Auth != "Bearer t-1" || reply.Body["msg_type"] != "text" {
		t.Fatalf("reply=%+v", reply)
	}
	content, _ := reply.Body["content"].(string)
	if !strings.Contains(content, "收到") {
		t.Fatalf("content=%s", content)
	}
}

func TestIMAPIRoots(t *testing.T) {
	t.Setenv("TELEGRAM_API_BASE", "")
	t.Setenv("FEISHU_API_BASE", "")
	if telegramAPIRoot() != "https://api.telegram.org" {
		t.Fatal(telegramAPIRoot())
	}
	if feishuAPIRoot("feishu") != "https://open.feishu.cn" || feishuAPIRoot("lark") != "https://open.larksuite.com" {
		t.Fatalf("feishu=%s lark=%s", feishuAPIRoot("feishu"), feishuAPIRoot("lark"))
	}
}

func TestIMConnectWebhookReplyAndDisconnectIsolation(t *testing.T) {
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
	username := "im-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash, org_id, role, email, created_at) VALUES ($1,$2,'x',$3,'member',$4,$5)`,
		userID, username, org.ID, username+"@example.com", db.Now(),
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, userID) })

	manualTG, err := d.CreateInboundHook(userID, "telegram", "手工粘贴", "")
	if err != nil {
		t.Fatal(err)
	}
	manualSlack, err := d.CreateInboundHook(userID, "slack", "手工 Slack", "")
	if err != nil {
		t.Fatal(err)
	}
	manualGH, err := d.CreateInboundHook(userID, "github", "手工 GitHub", "")
	if err != nil {
		t.Fatal(err)
	}
	manualFS, err := d.CreateInboundHook(userID, "feishu", "手工飞书", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.UpsertOAuthConnection(userID, gmailProvider, "me@example.com", "gmail.send", "ct-gmail", "", nil); err != nil {
		t.Fatal(err)
	}
	tgRoutine := insertIMRoutine(t, d, userID, "tg-wake", `[{"source":"telegram","type":"message"}]`)
	fsRoutine := insertIMRoutine(t, d, userID, "fs-wake", `[{"source":"feishu","type":"message"}]`)
	slackRoutine := insertIMRoutine(t, d, userID, "slack-wake", `[{"source":"slack","type":"message"}]`)
	ghRoutine := insertIMRoutine(t, d, userID, "gh-wake", `[{"source":"github","type":"ping"}]`)

	var mu sync.Mutex
	var calls []recordedCall
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		mu.Lock()
		calls = append(calls, recordedCall{Path: r.URL.Path, Body: body, Auth: r.Header.Get("Authorization")})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/getMe"):
			_, _ = w.Write([]byte(`{"ok":true,"result":{"id":42,"is_bot":true,"username":"open_bot","first_name":"Open"}}`))
		case strings.HasSuffix(r.URL.Path, "/setWebhook"), strings.HasSuffix(r.URL.Path, "/deleteWebhook"), strings.HasSuffix(r.URL.Path, "/sendMessage"):
			_, _ = w.Write([]byte(`{"ok":true,"result":true}`))
		case strings.HasSuffix(r.URL.Path, "/tenant_access_token/internal"):
			_, _ = w.Write([]byte(`{"code":0,"tenant_access_token":"t-tenant","expire":100}`))
		case strings.HasSuffix(r.URL.Path, "/bot/v3/info"):
			_, _ = w.Write([]byte(`{"code":0,"bot":{"open_id":"ou_bot","app_name":"Open Bot"}}`))
		case strings.Contains(r.URL.Path, "/messages/") && strings.HasSuffix(r.URL.Path, "/reply"):
			_, _ = w.Write([]byte(`{"code":0,"msg":"ok"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	t.Setenv("TELEGRAM_API_BASE", srv.URL)
	t.Setenv("FEISHU_API_BASE", srv.URL)

	rt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: done\ndata: {}\n\n")
	}))
	defer rt.Close()

	s := &Server{db: d, runtimeURL: rt.URL, client: rt.Client()}

	statusReq := httptest.NewRequest(http.MethodGet, "/v1/integrations/telegram", nil)
	statusReq = statusReq.WithContext(context.WithValue(statusReq.Context(), userIDKey, userID))
	statusRec := httptest.NewRecorder()
	s.handleTelegramStatus(statusRec, statusReq)
	if !strings.Contains(statusRec.Body.String(), `"connected":false`) || strings.Contains(statusRec.Body.String(), `"hook_url"`) {
		t.Fatalf("empty status=%s", statusRec.Body.String())
	}

	connect := func(path, payload string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(payload))
		req = req.WithContext(context.WithValue(req.Context(), userIDKey, userID))
		rec := httptest.NewRecorder()
		switch {
		case strings.Contains(path, "telegram"):
			s.handleTelegramConnect(rec, req)
		default:
			s.handleFeishuConnect(rec, req)
		}
		return rec
	}
	tgRec := connect("/v1/integrations/telegram/connect", `{"bot_token":"123456:AAEexampletokenvalue"}`)
	if tgRec.Code != http.StatusOK || !strings.Contains(tgRec.Body.String(), `"webhook_attached":true`) {
		t.Fatalf("connect telegram %d %s", tgRec.Code, tgRec.Body.String())
	}
	if strings.Contains(tgRec.Body.String(), "AAEexampletokenvalue") || strings.Contains(tgRec.Body.String(), `"hook_secret"`) {
		t.Fatal("status leaked the bot token or hook secret")
	}
	tgRec2 := connect("/v1/integrations/telegram/connect", `{"bot_token":"123456:AAEexampletokenvalue"}`)
	if tgRec2.Code != http.StatusOK {
		t.Fatalf("reconnect %d %s", tgRec2.Code, tgRec2.Body.String())
	}

	conn, err := d.GetOAuthConnection(userID, telegramProvider)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := decryptInstallSecret(conn.AccessTokenCT)
	if err != nil || plain != "123456:AAEexampletokenvalue" {
		t.Fatalf("plain=%q err=%v", plain, err)
	}
	hook := s.linkedInstallHook(userID, telegramProvider, conn.LinkedHookID)
	if hook == nil || hook.Label != oauthInstallHookLabel || hook.Secret == "" {
		t.Fatalf("hook=%+v", hook)
	}
	if !strings.Contains(tgRec.Body.String(), installHookURL(telegramProvider, hook.Token)) {
		t.Fatalf("missing hook url in %s", tgRec.Body.String())
	}
	mu.Lock()
	var setN int
	var setURL, setSecret string
	for _, c := range calls {
		if strings.HasSuffix(c.Path, "/setWebhook") {
			setN++
			setURL, _ = c.Body["url"].(string)
			setSecret, _ = c.Body["secret_token"].(string)
		}
	}
	mu.Unlock()
	if setN != 2 || setURL != installHookURL(telegramProvider, hook.Token) || setSecret != hook.Secret {
		t.Fatalf("setWebhook n=%d url=%s secret=%s want=%s", setN, setURL, setSecret, hook.Secret)
	}
	var oauthTG int
	hooks, _ := d.ListInboundHooks(userID)
	for _, h := range hooks {
		if h.Provider == telegramProvider && h.Label == oauthInstallHookLabel {
			oauthTG++
		}
	}
	if oauthTG != 1 {
		t.Fatalf("auto telegram hooks=%d", oauthTG)
	}

	fsRec := connect("/v1/integrations/feishu/connect", `{"app_id":"cli_app","app_secret":"app-sec","encrypt_key":"enc-key","verification_token":"vt-1","domain":"lark"}`)
	if fsRec.Code != http.StatusOK || !strings.Contains(fsRec.Body.String(), "/v1/webhooks/feishu/") {
		t.Fatalf("connect feishu %d %s", fsRec.Code, fsRec.Body.String())
	}
	if strings.Contains(fsRec.Body.String(), "app-sec") || strings.Contains(fsRec.Body.String(), "enc-key") {
		t.Fatal("feishu status leaked secrets")
	}
	fsConn, err := d.GetOAuthConnection(userID, feishuProvider)
	if err != nil {
		t.Fatal(err)
	}
	gotSecret, err := decryptInstallSecret(fsConn.AccessTokenCT)
	gotKey, err2 := decryptInstallSecret(fsConn.RefreshTokenCT)
	if err != nil || err2 != nil || gotSecret != "app-sec" || gotKey != "enc-key" {
		t.Fatalf("secret=%q key=%q err=%v %v", gotSecret, gotKey, err, err2)
	}
	fsHook := s.linkedInstallHook(userID, feishuProvider, fsConn.LinkedHookID)
	if fsHook == nil || fsHook.Secret != "vt-1" {
		t.Fatalf("feishu hook=%+v", fsHook)
	}
	if d.OAuthConnectionStatus(userID, slackProvider).Connected {
		t.Fatal("im connect wrote slack")
	}
	gmailStill, err := d.GetOAuthConnection(userID, gmailProvider)
	if err != nil || gmailStill.AccountEmail != "me@example.com" {
		t.Fatal("gmail changed")
	}

	postHook := func(handler http.HandlerFunc, path, tok, body, header, headerVal string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path+tok, strings.NewReader(body))
		req.SetPathValue("token", tok)
		if header != "" {
			req.Header.Set(header, headerVal)
		}
		rec := httptest.NewRecorder()
		handler(rec, req)
		return rec
	}

	noHdr := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", hook.Token, `{"update_id":1,"message":{"message_id":7,"chat":{"id":42,"type":"private"},"text":"hello","from":{"id":5,"is_bot":false}}}`, "", "")
	if noHdr.Code != http.StatusUnauthorized {
		t.Fatalf("install hook without secret %d %s", noHdr.Code, noHdr.Body.String())
	}
	okUpd := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", hook.Token, `{"update_id":1,"message":{"message_id":7,"chat":{"id":42,"type":"private"},"text":"hello","from":{"id":5,"is_bot":false}}}`, "X-Telegram-Bot-Api-Secret-Token", hook.Secret)
	if okUpd.Code != http.StatusOK || !strings.Contains(okUpd.Body.String(), `"fired":1`) {
		t.Fatalf("telegram wake %d %s", okUpd.Code, okUpd.Body.String())
	}
	manualWake := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", manualTG.Token, `{"update_id":2,"message":{"message_id":1,"chat":{"id":9,"type":"private"},"text":"manual","from":{"id":5,"is_bot":false}}}`, "", "")
	if manualWake.Code != http.StatusOK || !strings.Contains(manualWake.Body.String(), `"fired":1`) {
		t.Fatalf("manual telegram %d %s", manualWake.Code, manualWake.Body.String())
	}

	replyReq := httptest.NewRequest(http.MethodPost, "/v1/integrations/telegram/reply", strings.NewReader(`{"text":"pong"}`))
	replyReq = replyReq.WithContext(context.WithValue(replyReq.Context(), userIDKey, userID))
	replyRec := httptest.NewRecorder()
	s.handleTelegramReply(replyRec, replyReq)
	if replyRec.Code != http.StatusOK {
		t.Fatalf("reply %d %s", replyRec.Code, replyRec.Body.String())
	}
	mu.Lock()
	var sawSend bool
	for _, c := range calls {
		if strings.HasSuffix(c.Path, "/sendMessage") && c.Body["chat_id"] == "42" && c.Body["text"] == "pong" && c.Body["reply_to_message_id"] == float64(7) {
			sawSend = true
		}
	}
	mu.Unlock()
	if !sawSend {
		t.Fatal("sendMessage was not called for the same chat")
	}

	enc := encryptFeishuPayload(t, "enc-key", `{"challenge":"ch-fs","token":"vt-1","type":"url_verification"}`)
	rawEnc := []byte(`{"encrypt":"` + enc + `"}`)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	sum := sha256.Sum256([]byte(ts + "n1" + "enc-key" + string(rawEnc)))
	vreq := httptest.NewRequest(http.MethodPost, "/v1/webhooks/feishu/"+fsHook.Token, strings.NewReader(string(rawEnc)))
	vreq.SetPathValue("token", fsHook.Token)
	vreq.Header.Set("X-Lark-Request-Timestamp", ts)
	vreq.Header.Set("X-Lark-Request-Nonce", "n1")
	vreq.Header.Set("X-Lark-Signature", hexEncode(sum[:]))
	vrec := httptest.NewRecorder()
	s.handleFeishuWebhook(vrec, vreq)
	if vrec.Code != http.StatusOK || !strings.Contains(vrec.Body.String(), `"challenge":"ch-fs"`) {
		t.Fatalf("feishu verify %d %s", vrec.Code, vrec.Body.String())
	}
	bad := httptest.NewRequest(http.MethodPost, "/v1/webhooks/feishu/"+fsHook.Token, strings.NewReader(string(rawEnc)))
	bad.SetPathValue("token", fsHook.Token)
	bad.Header.Set("X-Lark-Request-Timestamp", ts)
	bad.Header.Set("X-Lark-Request-Nonce", "n1")
	bad.Header.Set("X-Lark-Signature", "deadbeef")
	badRec := httptest.NewRecorder()
	s.handleFeishuWebhook(badRec, bad)
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("bad sig %d %s", badRec.Code, badRec.Body.String())
	}

	fsMsg := `{"schema":"2.0","header":{"event_type":"im.message.receive_v1","token":"vt-1"},"event":{"sender":{"sender_type":"user","sender_id":{"open_id":"ou_user"}},"message":{"message_id":"om_9","chat_id":"oc_9","chat_type":"p2p","message_type":"text","content":"{\"text\":\"飞书你好\"}"}}}`
	fsWake := postHook(s.handleFeishuWebhook, "/v1/webhooks/feishu/", fsHook.Token, fsMsg, "", "")
	if fsWake.Code != http.StatusOK || !strings.Contains(fsWake.Body.String(), `"fired":1`) {
		t.Fatalf("feishu wake %d %s", fsWake.Code, fsWake.Body.String())
	}
	fsReply := httptest.NewRequest(http.MethodPost, "/v1/integrations/feishu/reply", strings.NewReader(`{"text":"在"}`))
	fsReply = fsReply.WithContext(context.WithValue(fsReply.Context(), userIDKey, userID))
	fsReplyRec := httptest.NewRecorder()
	s.handleFeishuReply(fsReplyRec, fsReply)
	if fsReplyRec.Code != http.StatusOK {
		t.Fatalf("feishu reply %d %s", fsReplyRec.Code, fsReplyRec.Body.String())
	}
	mu.Lock()
	var sawFS bool
	for _, c := range calls {
		if strings.HasSuffix(c.Path, "/messages/om_9/reply") && c.Auth == "Bearer t-tenant" {
			sawFS = true
		}
	}
	mu.Unlock()
	if !sawFS {
		t.Fatal("feishu reply API was not called")
	}

	// Mention filter is install-hook only. Manual hooks still accept every text.
	again := connect("/v1/integrations/telegram/connect", `{"bot_token":"123456:AAEexampletokenvalue","mention_only":true}`)
	if again.Code != http.StatusOK || !strings.Contains(again.Body.String(), `"mention_only":true`) {
		t.Fatalf("mention reconnect %d %s", again.Code, again.Body.String())
	}
	conn, _ = d.GetOAuthConnection(userID, telegramProvider)
	hook = s.linkedInstallHook(userID, telegramProvider, conn.LinkedHookID)
	group := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", hook.Token, `{"update_id":3,"message":{"message_id":8,"chat":{"id":-100,"type":"supergroup"},"text":"hello","from":{"id":5,"is_bot":false}}}`, "X-Telegram-Bot-Api-Secret-Token", hook.Secret)
	if group.Code != http.StatusOK || !strings.Contains(group.Body.String(), `"skipped":"mention_filter"`) {
		t.Fatalf("mention filter %d %s", group.Code, group.Body.String())
	}
	mentioned := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", hook.Token, `{"update_id":4,"message":{"message_id":10,"chat":{"id":-100,"type":"supergroup"},"text":"@open_bot hi","entities":[{"type":"mention","offset":0,"length":9}],"from":{"id":5,"is_bot":false}}}`, "X-Telegram-Bot-Api-Secret-Token", hook.Secret)
	if mentioned.Code != http.StatusOK || !strings.Contains(mentioned.Body.String(), `"fired":1`) {
		t.Fatalf("mentioned %d %s", mentioned.Code, mentioned.Body.String())
	}

	slackV := postHook(s.handleSlackWebhook, "/v1/webhooks/slack/", manualSlack.Token, `{"type":"url_verification","challenge":"ch-slack"}`, "", "")
	if slackV.Code != http.StatusOK || !strings.Contains(slackV.Body.String(), `"challenge":"ch-slack"`) {
		t.Fatalf("slack verify %d %s", slackV.Code, slackV.Body.String())
	}
	slackMsg := postHook(s.handleSlackWebhook, "/v1/webhooks/slack/", manualSlack.Token, `{"type":"event_callback","event":{"type":"message","text":"slack hi","channel":"C1","user":"U1"}}`, "", "")
	if slackMsg.Code != http.StatusOK || !strings.Contains(slackMsg.Body.String(), `"fired":1`) {
		t.Fatalf("slack wake %d %s", slackMsg.Code, slackMsg.Body.String())
	}
	gh := postHook(s.handleGitHubWebhook, "/v1/webhooks/github/", manualGH.Token, `{"zen":"keep"}`, "X-GitHub-Event", "ping")
	if gh.Code != http.StatusOK || !strings.Contains(gh.Body.String(), `"fired":1`) {
		t.Fatalf("github wake %d %s", gh.Code, gh.Body.String())
	}

	callsBefore := len(calls)
	dreq := httptest.NewRequest(http.MethodDelete, "/v1/integrations/telegram", nil)
	dreq = dreq.WithContext(context.WithValue(dreq.Context(), userIDKey, userID))
	drec := httptest.NewRecorder()
	s.handleTelegramDisconnect(drec, dreq)
	if drec.Code != http.StatusOK || !strings.Contains(drec.Body.String(), `"kept_other_hooks":true`) {
		t.Fatalf("disconnect telegram %d %s", drec.Code, drec.Body.String())
	}
	mu.Lock()
	var deleted bool
	for _, c := range calls[callsBefore:] {
		if strings.HasSuffix(c.Path, "/deleteWebhook") && strings.Contains(c.Path, "123456:AAEexampletokenvalue") {
			deleted = true
		}
	}
	mu.Unlock()
	if !deleted {
		t.Fatal("deleteWebhook was not called for this bot only")
	}
	if d.OAuthConnectionStatus(userID, telegramProvider).Connected {
		t.Fatal("telegram still connected")
	}
	if !d.OAuthConnectionStatus(userID, feishuProvider).Connected {
		t.Fatal("feishu removed by telegram disconnect")
	}
	if _, err := d.GetOAuthConnection(userID, gmailProvider); err != nil {
		t.Fatal("gmail removed")
	}
	hooks, _ = d.ListInboundHooks(userID)
	seen := map[string]bool{}
	for _, h := range hooks {
		seen[h.ID] = true
		if h.Provider == telegramProvider && h.Label == oauthInstallHookLabel {
			t.Fatal("telegram auto hook survived")
		}
	}
	for _, id := range []string{manualTG.ID, manualSlack.ID, manualGH.ID, manualFS.ID, fsHook.ID} {
		if !seen[id] {
			t.Fatalf("hook %s missing after telegram disconnect", id)
		}
	}
	dead := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", hook.Token, `{"update_id":5,"message":{"message_id":1,"chat":{"id":1,"type":"private"},"text":"x","from":{"id":1,"is_bot":false}}}`, "X-Telegram-Bot-Api-Secret-Token", hook.Secret)
	if dead.Code != http.StatusNotFound {
		t.Fatalf("deleted hook %d %s", dead.Code, dead.Body.String())
	}
	still := postHook(s.handleTelegramWebhook, "/v1/webhooks/telegram/", manualTG.Token, `{"update_id":6,"message":{"message_id":2,"chat":{"id":9,"type":"private"},"text":"still","from":{"id":5,"is_bot":false}}}`, "", "")
	if still.Code != http.StatusOK || !strings.Contains(still.Body.String(), `"fired":`) {
		t.Fatalf("manual after disconnect %d %s", still.Code, still.Body.String())
	}

	dreq = httptest.NewRequest(http.MethodDelete, "/v1/integrations/feishu", nil)
	dreq = dreq.WithContext(context.WithValue(dreq.Context(), userIDKey, userID))
	drec = httptest.NewRecorder()
	s.handleFeishuDisconnect(drec, dreq)
	if drec.Code != http.StatusOK {
		t.Fatalf("disconnect feishu %d %s", drec.Code, drec.Body.String())
	}
	if d.OAuthConnectionStatus(userID, feishuProvider).Connected {
		t.Fatal("feishu still connected")
	}
	hooks, _ = d.ListInboundHooks(userID)
	seen = map[string]bool{}
	for _, h := range hooks {
		seen[h.ID] = true
		if h.Label == oauthInstallHookLabel {
			t.Fatalf("auto hook survived: %+v", h)
		}
	}
	for _, id := range []string{manualTG.ID, manualSlack.ID, manualGH.ID, manualFS.ID} {
		if !seen[id] {
			t.Fatalf("manual hook %s removed by feishu disconnect", id)
		}
	}
	if _, err := d.GetOAuthConnection(userID, gmailProvider); err != nil {
		t.Fatal("gmail removed by feishu disconnect")
	}
	plainFS := postHook(s.handleFeishuWebhook, "/v1/webhooks/feishu/", manualFS.Token, `{"type":"url_verification","challenge":"plain"}`, "", "")
	if plainFS.Code != http.StatusOK || !strings.Contains(plainFS.Body.String(), `"challenge":"plain"`) {
		t.Fatalf("manual feishu verify %d %s", plainFS.Code, plainFS.Body.String())
	}

	waitRoutineRun(t, d, tgRoutine)
	waitRoutineRun(t, d, fsRoutine)
	waitRoutineRun(t, d, slackRoutine)
	waitRoutineRun(t, d, ghRoutine)
}

type recordedCall struct {
	Path string
	Body map[string]any
	Auth string
}

func insertIMRoutine(t *testing.T, d *db.DB, userID, name, triggers string) string {
	t.Helper()
	id := uuid.NewString()
	now := db.Now()
	_, err := d.SQL.Exec(
		`INSERT INTO routines (id, user_id, name, prompt, schedule_cron, enabled, agent_id, timezone, triggers_json, created_at, updated_at)
		 VALUES ($1,$2,$3,'ping','', TRUE, 'open-bot', 'Asia/Shanghai', $4, $5, $5)`,
		id, userID, name, triggers, now,
	)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func waitRoutineRun(t *testing.T, d *db.DB, id string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := d.SQL.QueryRow(`SELECT COUNT(*) FROM routine_runs WHERE routine_id=$1`, id).Scan(&n); err == nil && n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Logf("routine %s did not record a run within 3s", id)
}

func encryptFeishuPayload(t *testing.T, key, plain string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		t.Fatal(err)
	}
	iv := make([]byte, aes.BlockSize)
	if _, err := rand.Read(iv); err != nil {
		t.Fatal(err)
	}
	src := pkcs7Pad([]byte(plain))
	dst := make([]byte, len(src))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(dst, src)
	return base64.StdEncoding.EncodeToString(append(iv, dst...))
}

func pkcs7Pad(b []byte) []byte {
	n := aes.BlockSize - len(b)%aes.BlockSize
	out := append([]byte{}, b...)
	for i := 0; i < n; i++ {
		out = append(out, byte(n))
	}
	return out
}

func hexEncode(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, c := range b {
		out[i*2] = hexdigits[c>>4]
		out[i*2+1] = hexdigits[c&0x0f]
	}
	return string(out)
}
