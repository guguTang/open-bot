package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Internal micro-apps endpoints for agent-runtime tools (X-Internal-Token).
// Same create/pin semantics as /v1/micro-apps (including user_intent gate).

func (s *Server) handleInternalCreateMicroApp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID               string                    `json:"user_id"`
		Title                string                    `json:"title"`
		Description          string                    `json:"description"`
		Icon                 string                    `json:"icon"`
		Kind                 string                    `json:"kind"`
		AgentID              string                    `json:"agent_id"`
		Capabilities         []string                  `json:"capabilities"`
		BundleKey            string                    `json:"bundle_key"`
		BundleHash           string                    `json:"bundle_hash"`
		Entrypoint           string                    `json:"entrypoint"`
		SkillSlug            string                    `json:"skill_slug"`
		RoutineID            string                    `json:"routine_id"`
		RoutineConfig        *db.MicroAppRoutineConfig `json:"routine_config"`
		SourceConversationID string                    `json:"source_conversation_id"`
		SourceMessageID      string                    `json:"source_message_id"`
		UserIntent           string                    `json:"user_intent"`
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
	if err := requireMicroAppUserIntent(body.UserIntent); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	app, err := s.db.CreateMicroApp(uid, db.MicroAppCreateInput{
		Title:                body.Title,
		Description:          body.Description,
		Icon:                 body.Icon,
		Kind:                 body.Kind,
		AgentID:              body.AgentID,
		Capabilities:         body.Capabilities,
		BundleKey:            body.BundleKey,
		BundleHash:           body.BundleHash,
		Entrypoint:           body.Entrypoint,
		SkillSlug:            body.SkillSlug,
		RoutineID:            body.RoutineID,
		RoutineConfig:        body.RoutineConfig,
		SourceConversationID: body.SourceConversationID,
		SourceMessageID:      body.SourceMessageID,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.publishMicroAppsChanged(uid, "created", app.ID, map[string]any{"status": app.Status})
	writeJSON(w, http.StatusCreated, app)
}

func (s *Server) handleInternalPinMicroApp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID     string   `json:"user_id"`
		ID         string   `json:"id"`
		UserIntent string   `json:"user_intent"`
		ChatPin    bool     `json:"chat_pin"`
		ContextID  string   `json:"context_id"`
		Surfaces   []string `json:"surfaces"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	id := strings.TrimSpace(body.ID)
	if uid == "" || id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and id required"})
		return
	}
	if err := requireMicroAppUserIntent(body.UserIntent); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	app, err := s.db.PinMicroApp(uid, id, uid, &db.PinMicroAppOptions{
		ChatPin:   body.ChatPin,
		ContextID: body.ContextID,
		Surfaces:  body.Surfaces,
	})
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	extra := map[string]any{"status": app.Status, "kind": app.Kind}
	if app.SkillSlug != "" {
		extra["skill_slug"] = app.SkillSlug
	}
	if app.RoutineID != "" {
		extra["routine_id"] = app.RoutineID
	}
	s.publishMicroAppsChanged(uid, "pinned", app.ID, extra)
	writeJSON(w, http.StatusOK, app)
}
