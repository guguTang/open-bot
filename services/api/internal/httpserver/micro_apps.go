package httpserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Micro-apps API under /v1/micro-apps.
// Pin/draft require explicit user confirm intent — never silent.
// Phase 1: MinIO bundle + runtime pack; iframe SDK lives in apps/web.

func (s *Server) publishMicroAppsChanged(userID, reason, appID string, extra map[string]any) {
	if s.events == nil || strings.TrimSpace(userID) == "" {
		return
	}
	payload := map[string]any{
		"type":   "micro_apps_changed",
		"reason": reason,
	}
	if id := strings.TrimSpace(appID); id != "" {
		payload["micro_app_id"] = id
	}
	for k, v := range extra {
		if strings.TrimSpace(k) == "" || v == nil {
			continue
		}
		payload[k] = v
	}
	s.events.Publish(userID, payload)
}

func requireMicroAppUserIntent(intent string) error {
	intent = strings.ToLower(strings.TrimSpace(intent))
	switch intent {
	case "save", "pin_agree", "user_save", "user_pin", "confirm":
		return nil
	default:
		return errors.New("user_intent required (save|pin_agree); draft/pin must not be silent")
	}
}

func (s *Server) handleListMicroApps(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	surface := strings.TrimSpace(r.URL.Query().Get("surface"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	list, err := s.db.ListMicroApps(uid, surface, status)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"micro_apps": list})
}

func (s *Server) handleGetMicroApp(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if app.BundleKey != "" {
		app.BundleURL = "/v1/micro-apps/" + app.ID + "/bundle"
	}
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) handleCreateMicroApp(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		Title        string   `json:"title"`
		Description  string   `json:"description"`
		Icon         string   `json:"icon"`
		Kind         string   `json:"kind"`
		AgentID      string   `json:"agent_id"`
		Capabilities []string `json:"capabilities"`
		BundleKey    string   `json:"bundle_key"`
		BundleHash   string   `json:"bundle_hash"`
		Entrypoint   string   `json:"entrypoint"`
		SkillSlug    string   `json:"skill_slug"`
		RoutineID    string   `json:"routine_id"`
		// RoutineConfig (Phase 3, kind=routine): fixed schedule/trigger recipe.
		RoutineConfig        *db.MicroAppRoutineConfig `json:"routine_config"`
		SourceConversationID string                    `json:"source_conversation_id"`
		SourceMessageID      string                    `json:"source_message_id"`
		// UserIntent gates draft creation: save | pin_agree (bot asked + user agreed).
		UserIntent string `json:"user_intent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
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

func (s *Server) handlePinMicroApp(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		UserIntent string `json:"user_intent"`
		// ChatPin explicitly mounts surface=chat_pin (hub always written).
		ChatPin   bool   `json:"chat_pin"`
		ContextID string `json:"context_id"`
		// Surfaces (Phase 3): extra in-app entries, e.g. desktop_shortcut / mobile_shortcut.
		Surfaces []string `json:"surfaces"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	if err := requireMicroAppUserIntent(body.UserIntent); err != nil {
		// Also accept bare POST with user_intent query for simple clients.
		if qerr := requireMicroAppUserIntent(r.URL.Query().Get("user_intent")); qerr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	app, err := s.db.PinMicroApp(uid, id, uid, &db.PinMicroAppOptions{
		ChatPin:   body.ChatPin || r.URL.Query().Get("chat_pin") == "1",
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

func (s *Server) handlePatchMicroApp(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		Title         *string                   `json:"title"`
		Description   *string                   `json:"description"`
		Icon          *string                   `json:"icon"`
		Entrypoint    *string                   `json:"entrypoint"`
		SkillSlug     *string                   `json:"skill_slug"`
		RoutineID     *string                   `json:"routine_id"`
		Capabilities  *[]string                 `json:"capabilities"`
		RoutineConfig *db.MicroAppRoutineConfig `json:"routine_config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	app, err := s.db.PatchMicroApp(uid, id, db.MicroAppPatchInput{
		Title:         body.Title,
		Description:   body.Description,
		Icon:          body.Icon,
		Entrypoint:    body.Entrypoint,
		SkillSlug:     body.SkillSlug,
		RoutineID:     body.RoutineID,
		Capabilities:  body.Capabilities,
		RoutineConfig: body.RoutineConfig,
	})
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.publishMicroAppsChanged(uid, "updated", app.ID, nil)
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) handleArchiveMicroApp(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	app, err := s.db.ArchiveMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.publishMicroAppsChanged(uid, "archived", app.ID, map[string]any{"status": app.Status})
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) handlePutMicroAppPlacements(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		Placements []db.MicroAppPlacement `json:"placements"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	list, err := s.db.ReplaceMicroAppPlacements(uid, id, body.Placements)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.publishMicroAppsChanged(uid, "placements", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"placements": list})
}

func (s *Server) handleListMicroAppGrants(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	machineID := strings.TrimSpace(r.URL.Query().Get("machine_id"))
	list, err := s.db.ListMicroAppGrants(uid, id, machineID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"grants": list,
		// Hint for clients: high-sens defaults (no row = prompt, suggested allow_once).
		"defaults": map[string]string{
			"host.shell.run":      db.MicroAppGrantAllowOnce,
			"host.clipboard.read": db.MicroAppGrantAllowOnce,
		},
		// Phase 3: host.shell.run always_allow honours command_allowlist (prefix match,
		// compound commands always re-prompt; host Auto-review hard-deny still wins).
		"shell_allowlist_semantics": "prefix_word_boundary; empty=any; compound=prompt",
	})
}

func (s *Server) handlePutMicroAppGrant(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	capability := r.PathValue("capability")
	var body struct {
		Decision  string     `json:"decision"`
		MachineID string     `json:"machine_id"`
		ExpiresAt *time.Time `json:"expires_at"`
		// CommandAllowlist (host.shell.run): omit to keep, [] to clear.
		CommandAllowlist *[]string `json:"command_allowlist"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	g, err := s.db.UpsertMicroAppGrant(uid, id, capability, body.MachineID, body.Decision, body.ExpiresAt, body.CommandAllowlist)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		if strings.HasPrefix(err.Error(), "capability_not_declared") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.publishMicroAppsChanged(uid, "grants", id, map[string]any{"capability": capability})
	writeJSON(w, http.StatusOK, g)
}

// DELETE /v1/micro-apps/{id}/grants/{capability}?machine_id= — reset to "ask every time".
func (s *Server) handleDeleteMicroAppGrant(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	capability := r.PathValue("capability")
	machineID := strings.TrimSpace(r.URL.Query().Get("machine_id"))
	if err := s.db.DeleteMicroAppGrant(uid, id, capability, machineID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.publishMicroAppsChanged(uid, "grants", id, map[string]any{"capability": capability})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleMicroAppSession(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if app.Status != db.MicroAppStatusPinned && app.Status != db.MicroAppStatusDraft {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "micro-app not openable"})
		return
	}
	// Phase 0 stub: opaque short-lived token placeholder. Phase 1 binds to micro_app_id scope
	// and Host Bridge RPC; do not treat as a full user JWT.
	var b [16]byte
	_, _ = rand.Read(b[:])
	token := "ma_" + hex.EncodeToString(b[:])
	expires := time.Now().UTC().Add(15 * time.Minute)
	writeJSON(w, http.StatusOK, map[string]any{
		"micro_app_id": app.ID,
		"token":        token,
		"expires_at":   expires.Format(time.RFC3339Nano),
		"note":         "Scoped micro-app session token (not a full user JWT); host RPC stays in parent shell",
	})
}

// handleGetMicroAppBundle / handlePutMicroAppBundle live in micro_app_bundle.go
