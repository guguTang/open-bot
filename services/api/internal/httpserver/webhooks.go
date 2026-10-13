package httpserver

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Inbound hook CRUD (JWT) + Slack/GitHub webhook receivers.

func (s *Server) handleListInboundHooks(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListInboundHooks(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []*db.InboundHook{}
	}
	// Redact secrets in list response.
	out := make([]map[string]any, 0, len(list))
	for _, h := range list {
		out = append(out, map[string]any{
			"id":         h.ID,
			"user_id":    h.UserID,
			"provider":   h.Provider,
			"token":      h.Token,
			"label":      h.Label,
			"has_secret": strings.TrimSpace(h.Secret) != "",
			"created_at": h.CreatedAt,
			"url_slack":  fmt.Sprintf("/v1/webhooks/slack/%s", h.Token),
			"url_github": fmt.Sprintf("/v1/webhooks/github/%s", h.Token),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"hooks": out})
}

func (s *Server) handleCreateInboundHook(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		Provider string `json:"provider"`
		Label    string `json:"label"`
		Secret   string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	provider := strings.ToLower(strings.TrimSpace(body.Provider))
	if provider == "" {
		provider = "any"
	}
	h, err := s.db.CreateInboundHook(uid, provider, body.Label, body.Secret)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         h.ID,
		"provider":   h.Provider,
		"token":      h.Token,
		"label":      h.Label,
		"created_at": h.CreatedAt,
		"url_slack":  fmt.Sprintf("/v1/webhooks/slack/%s", h.Token),
		"url_github": fmt.Sprintf("/v1/webhooks/github/%s", h.Token),
		"hint":       "将 Slack Event Subscriptions / GitHub Webhook 指向上述 URL；GitHub 可选填与 secret 相同的签名密钥。",
	})
}

func (s *Server) handleDeleteInboundHook(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if err := s.db.DeleteInboundHook(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSlackWebhook(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	hook, err := s.db.GetInboundHookByToken(token)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown hook"})
		return
	}
	if hook.Provider != "any" && hook.Provider != "slack" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "hook provider mismatch"})
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body"})
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	// URL verification challenge
	if t, _ := payload["type"].(string); t == "url_verification" {
		challenge, _ := payload["challenge"].(string)
		writeJSON(w, http.StatusOK, map[string]string{"challenge": challenge})
		return
	}
	evType := ""
	text := ""
	channel := ""
	user := ""
	if t, _ := payload["type"].(string); t == "event_callback" {
		if ev, ok := payload["event"].(map[string]any); ok {
			evType, _ = ev["type"].(string)
			text, _ = ev["text"].(string)
			channel, _ = ev["channel"].(string)
			user, _ = ev["user"].(string)
			// ignore bot messages to avoid loops
			if _, hasBot := ev["bot_id"]; hasBot {
				writeJSON(w, http.StatusOK, map[string]any{"ok": true, "skipped": "bot_message"})
				return
			}
		}
	} else {
		evType, _ = payload["type"].(string)
		text, _ = payload["text"].(string)
	}
	matchType := evType
	switch matchType {
	case "app_mention":
		matchType = "app_mention"
	case "message":
		matchType = "message"
	}
	ev := db.EventMatch{
		Source: "slack",
		Type:   matchType,
		Text:   text,
	}
	ctx := fmt.Sprintf("source=slack type=%s channel=%s user=%s\ntext=%s", evType, channel, user, text)
	fired := s.dispatchEventWakes(hook.UserID, ev, ctx)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "fired": fired})
}

func (s *Server) handleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	hook, err := s.db.GetInboundHookByToken(token)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown hook"})
		return
	}
	if hook.Provider != "any" && hook.Provider != "github" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "hook provider mismatch"})
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body"})
		return
	}
	if sec := strings.TrimSpace(hook.Secret); sec != "" {
		sig := r.Header.Get("X-Hub-Signature-256")
		if !validGitHubSignature(sec, raw, sig) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "bad signature"})
			return
		}
	}
	eventName := strings.ToLower(strings.TrimSpace(r.Header.Get("X-GitHub-Event")))
	if eventName == "" {
		eventName = "ping"
	}
	var payload map[string]any
	_ = json.Unmarshal(raw, &payload)
	action, _ := payload["action"].(string)
	repo := ""
	if rm, ok := payload["repository"].(map[string]any); ok {
		repo, _ = rm["full_name"].(string)
	}
	summary := fmt.Sprintf("source=github event=%s action=%s repo=%s", eventName, action, repo)
	if pr, ok := payload["pull_request"].(map[string]any); ok {
		title, _ := pr["title"].(string)
		num := pr["number"]
		url, _ := pr["html_url"].(string)
		summary += fmt.Sprintf("\npr=#%v title=%s url=%s", num, title, url)
	}
	if issue, ok := payload["issue"].(map[string]any); ok {
		title, _ := issue["title"].(string)
		num := issue["number"]
		url, _ := issue["html_url"].(string)
		summary += fmt.Sprintf("\nissue=#%v title=%s url=%s", num, title, url)
	}
	if cs, ok := payload["check_suite"].(map[string]any); ok {
		conclusion, _ := cs["conclusion"].(string)
		status, _ := cs["status"].(string)
		summary += fmt.Sprintf("\ncheck_suite status=%s conclusion=%s", status, conclusion)
	}
	if wr, ok := payload["workflow_run"].(map[string]any); ok {
		name, _ := wr["name"].(string)
		conclusion, _ := wr["conclusion"].(string)
		status, _ := wr["status"].(string)
		url, _ := wr["html_url"].(string)
		summary += fmt.Sprintf("\nworkflow=%s status=%s conclusion=%s url=%s", name, status, conclusion, url)
	}
	ev := db.EventMatch{
		Source: "github",
		Type:   eventName,
		Action: action,
		Repo:   repo,
	}
	fired := s.dispatchEventWakes(hook.UserID, ev, summary)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "fired": fired})
}

func validGitHubSignature(secret string, body []byte, header string) bool {
	header = strings.TrimSpace(header)
	if !strings.HasPrefix(header, "sha256=") {
		return false
	}
	want, err := hex.DecodeString(strings.TrimPrefix(header, "sha256="))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), want)
}

func (s *Server) dispatchEventWakes(userID string, ev db.EventMatch, eventContext string) int {
	list, err := s.db.ListEnabledRoutinesForUser(userID)
	if err != nil {
		log.Printf("event wake list: %v", err)
		return 0
	}
	fired := 0
	for _, rt := range list {
		if !db.RoutineMatchesEvent(rt, ev) {
			continue
		}
		rt := rt
		ctx := eventContext
		go func() {
			cctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
			defer cancel()
			if _, err := s.executeRoutine(cctx, rt, ctx); err != nil {
				log.Printf("event wake routine %s failed: %v", rt.ID, err)
			} else {
				log.Printf("event wake routine %s (%s) ok", rt.ID, rt.Name)
			}
		}()
		fired++
	}
	return fired
}
