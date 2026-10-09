package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"
)

type harnessProjectBody struct {
	EntryID        string `json:"entry_id"`
	ConversationID string `json:"conversation_id"`
	UserID         string `json:"user_id"`
	OrgID          string `json:"org_id"`
	AgentID        string `json:"agent_id"`
	ThreadID       string `json:"thread_id"`
	RequestID      string `json:"request_id"`
	Role           string `json:"role"`
	Content        string `json:"content"`
	Kind           string `json:"kind"`
	Seq            int64  `json:"seq"`
	Payload        any    `json:"payload"`
	Project        bool   `json:"project"` // if true, also write messages
}

type harnessThreadBody struct {
	ThreadID         string `json:"thread_id"`
	ConversationID   string `json:"conversation_id"`
	UserID           string `json:"user_id"`
	OrgID            string `json:"org_id"`
	AgentID          string `json:"agent_id"`
	RequestID        string `json:"request_id"`
	Status           string `json:"status"`
	LangfuseTraceID  string `json:"langfuse_trace_id"`
	OwnerThreadID    string `json:"owner_thread_id"`
	Background       bool   `json:"background"`
}

type harnessDocBody struct {
	ThreadID string `json:"thread_id"`
	Kind     string `json:"kind"`
	Data     any    `json:"data"`
}

// POST /internal/harness/entries — append journal entry; optionally project to messages.
func (s *Server) handleInternalHarnessEntry(w http.ResponseWriter, r *http.Request) {
	var body harnessProjectBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	body.ThreadID = strings.TrimSpace(body.ThreadID)
	body.Kind = strings.TrimSpace(body.Kind)
	if body.ThreadID == "" || body.Kind == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "thread_id and kind required"})
		return
	}
	payload := body.Payload
	if payload == nil {
		payload = map[string]any{
			"role":    body.Role,
			"content": body.Content,
			"kind":    body.Kind,
		}
	}
	entry, err := s.db.AppendHarnessEntry(
		body.EntryID, body.OrgID, body.UserID, body.ConversationID, body.ThreadID,
		body.Kind, body.Seq, payload,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	msgID := ""
	if body.Project {
		role := strings.TrimSpace(body.Role)
		if role == "" {
			role = "assistant"
		}
		content := body.Content
		if content == "" {
			if m, ok := payload.(map[string]any); ok {
				content, _ = m["content"].(string)
			}
		}
		if strings.TrimSpace(content) != "" && strings.TrimSpace(body.ConversationID) != "" {
			// Journal entry is kept; do not project PASS/silence into the chat timeline.
			if !(strings.EqualFold(role, "assistant") && isGroupPassReply(content)) {
				msgID, err = s.db.ProjectHarnessEntryToMessage(
					entry.ID, body.ConversationID, role, content, body.AgentID, body.RequestID,
				)
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				// Live-notify so early projected acks (assistant_partial) appear soon.
				if msgID != "" && strings.TrimSpace(body.UserID) != "" {
					if msg, gerr := s.db.GetMessage(body.UserID, body.ConversationID, msgID); gerr == nil && msg != nil {
						s.publishConversationMessage(body.UserID, msg)
					}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"entry_id":   entry.ID,
		"seq":        entry.Seq,
		"message_id": msgID,
	})
}

// POST /internal/harness/threads — upsert thread status for resume worker.
func (s *Server) handleInternalHarnessThread(w http.ResponseWriter, r *http.Request) {
	var body harnessThreadBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	status := strings.TrimSpace(body.Status)
	if status == "" {
		status = "running"
	}
	if err := s.db.UpsertHarnessThread(
		body.ThreadID, body.ConversationID, body.UserID, body.OrgID, body.AgentID,
		body.RequestID, status, body.LangfuseTraceID, body.OwnerThreadID, body.Background,
	); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "thread_id": body.ThreadID, "status": status})
}

// POST /internal/harness/docs — put live/inbox/usage/agent doc.
func (s *Server) handleInternalHarnessDoc(w http.ResponseWriter, r *http.Request) {
	var body harnessDocBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.ThreadID) == "" || strings.TrimSpace(body.Kind) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "thread_id and kind required"})
		return
	}
	if err := s.db.PutHarnessDoc(body.ThreadID, body.Kind, body.Data); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// GET /internal/harness/resumable — list thread ids for resume worker.
func (s *Server) handleInternalHarnessResumable(w http.ResponseWriter, r *http.Request) {
	ids, err := s.db.ListResumableHarnessThreads(100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if ids == nil {
		ids = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"thread_ids": ids})
}
