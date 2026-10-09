package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// runtimeDurableEnabled mirrors agent-runtime RUNTIME_DURABLE (default on).
func runtimeDurableEnabled() bool {
	v := strings.TrimSpace(os.Getenv("RUNTIME_DURABLE"))
	if v == "" {
		return true
	}
	switch strings.ToLower(v) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func (s *Server) postRuntimeJSON(ctx context.Context, path string, body any) (map[string]any, int, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, 0, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.runtimeURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	if out == nil {
		out = map[string]any{"raw": string(raw)}
	}
	return out, res.StatusCode, nil
}

type durableSteerBody struct {
	RequestID string `json:"request_id"`
	Text      string `json:"text"`
	Mode      string `json:"mode"` // follow_up | steer | reject (when_busy)
	WhenBusy  string `json:"when_busy"`
}

type durableApproveBody struct {
	RequestID string `json:"request_id"`
	Approve   *bool  `json:"approve"`
	Reason    string `json:"reason"`
}

// POST /v1/conversations/{id}/steer — queue follow-up/steer on a durable run.
func (s *Server) handleConversationSteer(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if _, err := s.db.EnsureConversation(uid, id, "", "会话 "+id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body durableSteerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	body.RequestID = strings.TrimSpace(body.RequestID)
	body.Text = strings.TrimSpace(body.Text)
	if body.RequestID == "" || body.Text == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request_id and text required"})
		return
	}
	mode := strings.TrimSpace(body.Mode)
	if mode == "" {
		mode = strings.TrimSpace(body.WhenBusy)
	}
	if mode == "" {
		mode = "follow_up"
	}
	out, code, err := s.postRuntimeJSON(r.Context(), "/v1/runs/steer", map[string]any{
		"conversation_id": id,
		"request_id":      body.RequestID,
		"text":            body.Text,
		"mode":            mode,
		"when_busy":       mode,
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if code < 200 || code >= 300 {
		writeJSON(w, code, out)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /v1/conversations/{id}/approve — resume tool approval interrupt.
func (s *Server) handleConversationApprove(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	if _, err := s.db.EnsureConversation(uid, id, "", "会话 "+id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body durableApproveBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	body.RequestID = strings.TrimSpace(body.RequestID)
	if body.RequestID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request_id required"})
		return
	}
	approve := true
	if body.Approve != nil {
		approve = *body.Approve
	}
	out, code, err := s.postRuntimeJSON(r.Context(), "/v1/runs/approve", map[string]any{
		"conversation_id": id,
		"request_id":      body.RequestID,
		"approve":         approve,
		"reason":          body.Reason,
	})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if code < 200 || code >= 300 {
		writeJSON(w, code, out)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// shouldSteerBusyHarness reports whether a new user message should be injected
// into an already-busy durable harness thread.
//
// Same agent (DM, or @same member in a group) → steer/inbox.
// Different @-target while another member is busy → false (start a new run).
// Empty activeAgentID keeps legacy/DM busy-steer working when agent was not stamped.
func shouldSteerBusyHarness(activeAgentID, targetAgentID string) bool {
	active := strings.TrimSpace(activeAgentID)
	target := strings.TrimSpace(targetAgentID)
	if active == "" || target == "" {
		return true
	}
	return active == target
}
