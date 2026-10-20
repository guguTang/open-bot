package httpserver

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Internal micro-apps endpoints for agent-runtime tools (X-Internal-Token).
// Same create/pin/list/patch semantics as /v1/micro-apps (including user_intent gate
// on create/pin). Bundle upload reuses PUT /v1/micro-apps/{id}/bundle unpack + MinIO
// store logic. List/update support the modify path (no new draft).

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

// POST /internal/micro-apps/bundle — runtime auto-upload after generating UI files.
// Accepts zip_base64 and/or files map (utf-8 string or {encoding,content}); same
// validation as user JWT PUT /v1/micro-apps/{id}/bundle.
func (s *Server) handleInternalUploadMicroAppBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID     string                     `json:"user_id"`
		ID         string                     `json:"id"`
		MicroAppID string                     `json:"micro_app_id"`
		ZipBase64  string                     `json:"zip_base64"`
		Files      map[string]json.RawMessage `json:"files"`
		Entrypoint string                     `json:"entrypoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	id := strings.TrimSpace(body.ID)
	if id == "" {
		id = strings.TrimSpace(body.MicroAppID)
	}
	if uid == "" || id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and id required"})
		return
	}
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if app.Status == db.MicroAppStatusArchived {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "archived"})
		return
	}

	var zipBytes []byte
	zipB64 := strings.TrimSpace(body.ZipBase64)
	if zipB64 != "" {
		raw, err := base64.StdEncoding.DecodeString(zipB64)
		if err != nil {
			raw, err = base64.RawStdEncoding.DecodeString(zipB64)
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid zip_base64"})
			return
		}
		zipBytes = raw
	} else if len(body.Files) > 0 {
		files, err := decodeMicroAppFilesMap(body.Files)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		zipBytes, err = packMicroAppZip(files)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	} else {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "zip_base64 or files required"})
		return
	}

	result, err := s.applyMicroAppBundleZip(r.Context(), uid, app, zipBytes, body.Entrypoint)
	if err != nil {
		writeMicroAppBundleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleInternalListMicroApps(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID  string `json:"user_id"`
		Status  string `json:"status"`
		Surface string `json:"surface"`
		Limit   int    `json:"limit"`
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
	list, err := s.db.ListMicroApps(uid, body.Surface, body.Status)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	limit := body.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	if len(list) > limit {
		list = list[:limit]
	}
	// Light projection for model discovery (id / title / status / kind / placements).
	out := make([]map[string]any, 0, len(list))
	for _, a := range list {
		if a == nil {
			continue
		}
		surfaces := make([]string, 0, len(a.Placements))
		for _, p := range a.Placements {
			if p.Enabled {
				surfaces = append(surfaces, p.Surface)
			}
		}
		item := map[string]any{
			"id":     a.ID,
			"title":  a.Title,
			"status": a.Status,
			"kind":   a.Kind,
			"icon":   a.Icon,
		}
		if a.Description != "" {
			item["description"] = a.Description
		}
		if len(surfaces) > 0 {
			item["surfaces"] = surfaces
		}
		if !a.UpdatedAt.IsZero() {
			item["updated_at"] = a.UpdatedAt
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"micro_apps": out})
}

func (s *Server) handleInternalUpdateMicroApp(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID        string                    `json:"user_id"`
		ID            string                    `json:"id"`
		MicroAppID    string                    `json:"micro_app_id"`
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
	uid := strings.TrimSpace(body.UserID)
	id := strings.TrimSpace(body.ID)
	if id == "" {
		id = strings.TrimSpace(body.MicroAppID)
	}
	if uid == "" || id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and id required"})
		return
	}
	if body.Title == nil && body.Description == nil && body.Icon == nil &&
		body.Entrypoint == nil && body.SkillSlug == nil && body.RoutineID == nil &&
		body.Capabilities == nil && body.RoutineConfig == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "at least one patch field required"})
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

// POST /internal/micro-apps/runtime — agent modify path: return entrypoint + files
// (same shape as GET /v1/micro-apps/{id}/runtime) so the model can read existing
// HTML/JS before upload_micro_app_bundle overwrite.
func (s *Server) handleInternalGetMicroAppRuntime(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID     string `json:"user_id"`
		ID         string `json:"id"`
		MicroAppID string `json:"micro_app_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	id := strings.TrimSpace(body.ID)
	if id == "" {
		id = strings.TrimSpace(body.MicroAppID)
	}
	if uid == "" || id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and id required"})
		return
	}
	app, err := s.db.GetMicroApp(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	payload, status, errMsg := s.microAppRuntimePayload(r.Context(), uid, app)
	if errMsg != "" {
		writeJSON(w, status, map[string]string{"error": errMsg})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}
