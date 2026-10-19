package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

// microAppGrantPromptPayload is stored as messages.role = micro_app_grant.
// Model-path dual-gate surfaces this as a chat approval card (minimal UX).
type microAppGrantPromptPayload struct {
	ReqID             string `json:"req_id"`
	MicroAppID        string `json:"micro_app_id"`
	Capability        string `json:"capability"`
	Tool              string `json:"tool,omitempty"`
	Command           string `json:"command,omitempty"`
	MachineID         string `json:"machine_id,omitempty"`
	Reason            string `json:"reason,omitempty"`
	SuggestedDecision string `json:"suggested_decision,omitempty"`
	HighSensitivity   bool   `json:"high_sensitivity,omitempty"`
	SuggestedPrefix   string `json:"suggested_prefix,omitempty"`
	// PendingArgs / RunRequestID preserve the blocked tool call so allow can auto-retry.
	PendingArgs    string `json:"pending_args,omitempty"`
	RunRequestID   string `json:"run_request_id,omitempty"`
	AutoRetry      bool   `json:"auto_retry,omitempty"` // set true after allow when client/API will resume
	Status         string `json:"status"`               // pending | allowed | denied
	Decision       string `json:"decision,omitempty"`
	AllowlistEntry string `json:"allowlist_entry,omitempty"`
}

// POST /internal/micro-apps/grant-prompt — runtime surfaces a client approval card.
// Body: user_id, conversation_id, micro_app_id, capability, tool?, command?, machine_id?,
// reason?, suggested_decision?, high_sensitivity?
func (s *Server) handleInternalMicroAppGrantPrompt(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID            string `json:"user_id"`
		ConversationID    string `json:"conversation_id"`
		MicroAppID        string `json:"micro_app_id"`
		Capability        string `json:"capability"`
		Tool              string `json:"tool"`
		Command           string `json:"command"`
		MachineID         string `json:"machine_id"`
		Reason            string `json:"reason"`
		SuggestedDecision string `json:"suggested_decision"`
		HighSensitivity   bool   `json:"high_sensitivity"`
		ReqID             string `json:"req_id"`
		PendingArgs       string `json:"pending_args"`
		RequestID         string `json:"request_id"` // durable run / turn request_id
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	convID := strings.TrimSpace(body.ConversationID)
	appID := strings.TrimSpace(body.MicroAppID)
	cap := strings.TrimSpace(body.Capability)
	if uid == "" || convID == "" || appID == "" || cap == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id, conversation_id, micro_app_id, capability required"})
		return
	}
	if _, err := s.db.GetConversation(uid, convID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if _, err := s.db.GetMicroApp(uid, appID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "micro_app not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	cmd := strings.TrimSpace(body.Command)
	reqID := strings.TrimSpace(body.ReqID)
	if reqID == "" {
		reqID = "mag-" + uuid.NewString()
	}
	suggested := strings.TrimSpace(body.SuggestedDecision)
	if suggested == "" {
		suggested = db.DefaultGrantDecisionForCapability(cap)
	}
	_, highSens := db.MicroAppHighSensitivityCapabilities[cap]
	if body.HighSensitivity {
		highSens = true
	}
	reason := strings.TrimSpace(body.Reason)
	if reason == "" {
		reason = "模型路径需要微应用授权后才能继续（允许后将自动重试）"
	}
	prefix := ""
	if cap == db.MicroAppShellCapability && cmd != "" {
		prefix = suggestMicroAppShellPrefix(cmd)
	}

	// Dedupe: reuse pending card for same app+capability+command within recent window.
	existing, err := s.db.RecentMicroAppGrantPrompts(convID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for i := range existing {
		var p microAppGrantPromptPayload
		if json.Unmarshal([]byte(existing[i].Content), &p) != nil {
			continue
		}
		if p.Status != "pending" {
			continue
		}
		if p.MicroAppID == appID && p.Capability == cap && strings.TrimSpace(p.Command) == cmd {
			writeJSON(w, http.StatusOK, existing[i])
			return
		}
		if p.ReqID == reqID {
			writeJSON(w, http.StatusOK, existing[i])
			return
		}
	}

	runReqID := strings.TrimSpace(body.RequestID)
	pendingArgs := strings.TrimSpace(body.PendingArgs)
	if len(pendingArgs) > 4000 {
		pendingArgs = pendingArgs[:4000] + "…"
	}
	payload := microAppGrantPromptPayload{
		ReqID:             reqID,
		MicroAppID:        appID,
		Capability:        cap,
		Tool:              strings.TrimSpace(body.Tool),
		Command:           cmd,
		MachineID:         strings.TrimSpace(body.MachineID),
		Reason:            reason,
		SuggestedDecision: suggested,
		HighSensitivity:   highSens,
		SuggestedPrefix:   prefix,
		PendingArgs:       pendingArgs,
		RunRequestID:      runReqID,
		Status:            "pending",
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	msg, err := s.db.AddMessageWithOpts(convID, "micro_app_grant", string(raw), db.AddMessageOpts{
		RequestID: runReqID,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.publishConversationMessage(uid, msg)
	meta, _ := json.Marshal(map[string]any{
		"req_id": reqID, "tool": body.Tool, "command": cmd, "source": "grant_prompt",
	})
	_ = s.db.InsertMicroAppGateAudit(uid, appID, convID, strings.TrimSpace(body.Tool), cap, false, "grant_required", "", strings.TrimSpace(body.MachineID), string(meta))
	writeJSON(w, http.StatusOK, msg)
}

// POST /v1/conversations/{id}/micro-app-grants/{msgId}/decide
func (s *Server) handleDecideMicroAppGrantPrompt(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	conversationID := r.PathValue("id")
	messageID := r.PathValue("msgId")
	if _, err := s.db.GetConversation(uid, conversationID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body struct {
		Decision       string `json:"decision"` // allow_once | always_allow | deny
		AllowlistEntry string `json:"allowlist_entry"`
		MachineID      string `json:"machine_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	decision := strings.TrimSpace(body.Decision)
	switch decision {
	case db.MicroAppGrantAllowOnce, db.MicroAppGrantAlwaysAllow, db.MicroAppGrantDeny:
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "decision must be allow_once|always_allow|deny"})
		return
	}
	msg, err := s.db.GetMessage(uid, conversationID, messageID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "message not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if msg.Role != "micro_app_grant" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "not a micro_app_grant message"})
		return
	}
	var payload microAppGrantPromptPayload
	if err := json.Unmarshal([]byte(msg.Content), &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payload"})
		return
	}
	if payload.Status == "allowed" || payload.Status == "denied" {
		writeJSON(w, http.StatusOK, msg)
		return
	}
	machineID := strings.TrimSpace(body.MachineID)
	if machineID == "" {
		machineID = strings.TrimSpace(payload.MachineID)
	}
	entry := strings.TrimSpace(body.AllowlistEntry)
	var allowlist *[]string
	if payload.Capability == db.MicroAppShellCapability && decision == db.MicroAppGrantAlwaysAllow {
		if entry != "" {
			// Merge with existing always_allow allowlist when present (command_not_in_allowlist case).
			cur := []string{}
			if existing, gerr := s.db.GetMicroAppGrant(uid, payload.MicroAppID, payload.Capability, machineID); gerr == nil && existing != nil {
				if existing.Decision == db.MicroAppGrantAlwaysAllow {
					cur = append(cur, existing.CommandAllowlist...)
				}
			}
			seen := map[string]struct{}{}
			merged := make([]string, 0, len(cur)+1)
			for _, e := range append(cur, entry) {
				e = strings.TrimSpace(e)
				if e == "" {
					continue
				}
				if _, ok := seen[e]; ok {
					continue
				}
				seen[e] = struct{}{}
				merged = append(merged, e)
			}
			allowlist = &merged
		} else {
			empty := []string{}
			allowlist = &empty
		}
	}
	g, err := s.db.UpsertMicroAppGrant(uid, payload.MicroAppID, payload.Capability, machineID, decision, nil, allowlist)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	status := "allowed"
	if decision == db.MicroAppGrantDeny {
		status = "denied"
	}
	payload.Status = status
	payload.Decision = decision
	payload.AllowlistEntry = entry
	// Signal clients/history that allow should auto-retry the pending host_* call.
	payload.AutoRetry = decision != db.MicroAppGrantDeny && (strings.TrimSpace(payload.Tool) != "" || strings.TrimSpace(payload.Command) != "")
	raw, err := json.Marshal(payload)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	updated, err := s.db.UpdateMessageContent(conversationID, messageID, string(raw))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.publishConversationMessage(uid, updated)
	meta, _ := json.Marshal(map[string]any{
		"req_id": payload.ReqID, "grant_id": g.ID, "source": "grant_prompt_decide",
		"allowlist_entry": entry,
	})
	_ = s.db.InsertMicroAppGateAudit(uid, payload.MicroAppID, conversationID, payload.Tool, payload.Capability,
		decision != db.MicroAppGrantDeny, "", decision, machineID, string(meta))
	writeJSON(w, http.StatusOK, updated)
}

func suggestMicroAppShellPrefix(command string) string {
	cmd := strings.Join(strings.Fields(strings.TrimSpace(command)), " ")
	if cmd == "" {
		return ""
	}
	parts := strings.Fields(cmd)
	if len(parts) >= 2 {
		return parts[0] + " " + parts[1]
	}
	return parts[0]
}

// recordMicroAppGateAudit is best-effort from tool-gate.
func (s *Server) recordMicroAppGateAudit(userID, microAppID, conversationID, tool, capability string, allowed bool, errorCode, decision, machineID string, extra map[string]any) {
	meta := "{}"
	if extra != nil {
		if b, err := json.Marshal(extra); err == nil {
			meta = string(b)
		}
	}
	_ = s.db.InsertMicroAppGateAudit(userID, microAppID, conversationID, tool, capability, allowed, errorCode, decision, machineID, meta)
}
