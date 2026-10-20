package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// POST /internal/micro-apps/parks — upsert a durable park (runtime create_park).
func (s *Server) handleInternalMicroAppParkUpsert(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ReqID          string `json:"req_id"`
		UserID         string `json:"user_id"`
		MicroAppID     string `json:"micro_app_id"`
		ConversationID string `json:"conversation_id"`
		RequestID      string `json:"request_id"`
		Tool           string `json:"tool"`
		Capability     string `json:"capability"`
		ArgsJSON       string `json:"args_json"`
		Args           any    `json:"args"`
		TimeoutSec     int    `json:"timeout_sec"`
		AliasOf        string `json:"alias_of"` // optional: also link alias → this req_id's metadata
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	reqID := strings.TrimSpace(body.ReqID)
	if reqID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "req_id required"})
		return
	}
	_, _ = s.db.ExpireStaleMicroAppParks()

	argsJSON := strings.TrimSpace(body.ArgsJSON)
	if argsJSON == "" && body.Args != nil {
		if b, err := json.Marshal(body.Args); err == nil {
			argsJSON = string(b)
		}
	}
	timeout := body.TimeoutSec
	if timeout <= 0 {
		timeout = 900
	}
	p := db.MicroAppPark{
		ReqID:          reqID,
		UserID:         strings.TrimSpace(body.UserID),
		MicroAppID:     strings.TrimSpace(body.MicroAppID),
		ConversationID: strings.TrimSpace(body.ConversationID),
		RequestID:      strings.TrimSpace(body.RequestID),
		Tool:           strings.TrimSpace(body.Tool),
		Capability:     strings.TrimSpace(body.Capability),
		ArgsJSON:       argsJSON,
		ExpiresAt:      db.Now().Add(time.Duration(timeout) * time.Second),
	}
	out, err := s.db.UpsertMicroAppPark(p)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if alias := strings.TrimSpace(body.AliasOf); alias != "" && alias != reqID {
		_ = s.db.AliasMicroAppPark(alias, reqID)
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /internal/micro-apps/parks/resolve — mark durable park resolved (runtime or decide path).
func (s *Server) handleInternalMicroAppParkResolve(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ReqID    string `json:"req_id"`
		Decision string `json:"decision"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	reqID := strings.TrimSpace(body.ReqID)
	if reqID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "req_id required"})
		return
	}
	_, _ = s.db.ExpireStaleMicroAppParks()

	existing, err := s.db.GetMicroAppPark(reqID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": true, "park_found": false, "reason": "not_parked", "req_id": reqID,
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if existing.Status == db.MicroAppParkExpired {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "park_found": true, "was_pending": false,
			"reason": "expired", "req_id": reqID, "park": existing,
		})
		return
	}
	if existing.Status != db.MicroAppParkPending {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "park_found": true, "was_pending": false,
			"reason": "already_resolved", "req_id": reqID, "park": existing,
			"decision": existing.Decision,
		})
		return
	}
	// Pending but past expiry → expire then report.
	if !existing.ExpiresAt.After(db.Now()) {
		_, _ = s.db.ExpireStaleMicroAppParks()
		existing, _ = s.db.GetMicroAppPark(reqID)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "park_found": true, "was_pending": false,
			"reason": "expired", "req_id": reqID, "park": existing,
		})
		return
	}
	p, wasPending, err := s.db.ResolveMicroAppPark(reqID, body.Decision)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": true, "park_found": false, "reason": "not_parked", "req_id": reqID,
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "park_found": true, "was_pending": wasPending,
		"reason": "resolved", "req_id": reqID, "park": p, "decision": strings.TrimSpace(body.Decision),
	})
}

// POST /internal/micro-apps/parks/expire — cleanup stale pending parks.
func (s *Server) handleInternalMicroAppParkExpire(w http.ResponseWriter, r *http.Request) {
	n, err := s.db.ExpireStaleMicroAppParks()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "expired": n})
}

// GET-like via POST /internal/micro-apps/parks/get — peek one park.
func (s *Server) handleInternalMicroAppParkGet(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ReqID string `json:"req_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	_, _ = s.db.ExpireStaleMicroAppParks()
	p, err := s.db.GetMicroAppPark(body.ReqID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "park": nil})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "park": p})
}
