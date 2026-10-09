package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Internal endpoints used by agent-runtime tools (X-Internal-Token).

func (s *Server) handleInternalEnqueueTask(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string `json:"user_id"`
		ConversationID string `json:"conversation_id"`
		AgentID        string `json:"agent_id"`
		Goal           string `json:"goal"`
		SourceMessageID string `json:"source_message_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	cid := strings.TrimSpace(body.ConversationID)
	goal := strings.TrimSpace(body.Goal)
	if uid == "" || cid == "" || goal == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id, conversation_id, goal required"})
		return
	}
	agentID := strings.TrimSpace(body.AgentID)
	if agentID == "" {
		if conv, err := s.db.GetConversation(uid, cid); err == nil && conv != nil {
			agentID = conv.AgentID
		}
	}
	task, err := s.db.EnqueueConversationTask(uid, cid, agentID, goal, body.SourceMessageID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.wakeTasks()
	channelID := ""
	if conv, err := s.db.GetConversation(uid, cid); err == nil && conv != nil {
		channelID = conv.ChannelID
	}
	s.publishTaskStatus(uid, cid, agentID, channelID, "running", "正在做…")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"task_id": task.ID,
		"status":  task.Status,
		"message": statusWaitText,
	})
}

func (s *Server) handleInternalListRoutines(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	list, err := s.db.ListRoutines(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []*db.Routine{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"routines": list})
}

func (s *Server) handleInternalCreateRoutine(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string              `json:"user_id"`
		Name           string              `json:"name"`
		Prompt         string              `json:"prompt"`
		ScheduleCron   string              `json:"schedule_cron"`
		Enabled        *bool               `json:"enabled"`
		AgentID        string              `json:"agent_id"`
		Timezone       string              `json:"timezone"`
		ConversationID string              `json:"conversation_id"`
		Triggers       []db.RoutineTrigger `json:"triggers"`
		TriggersJSON   string              `json:"triggers_json"`
		MaxRetries     *int                `json:"max_retries"`
		QuietUnchanged *bool               `json:"quiet_unchanged"`
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
	triggersJSON := strings.TrimSpace(body.TriggersJSON)
	if triggersJSON == "" && body.Triggers != nil {
		encoded, err := db.EncodeTriggersJSON(body.Triggers)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid triggers"})
			return
		}
		triggersJSON = encoded
	}
	if err := validateCronOptional(body.ScheduleCron); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	enabled := true
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	maxRetries := 2
	if body.MaxRetries != nil {
		maxRetries = *body.MaxRetries
	}
	quiet := false
	if body.QuietUnchanged != nil {
		quiet = *body.QuietUnchanged
	}
	// Pin to current conversation when provided so cron/event fires reuse it.
	rt, err := s.db.CreateRoutine(
		uid, body.Name, body.Prompt, body.ScheduleCron, enabled, body.AgentID,
		body.Timezone, body.ConversationID, triggersJSON, maxRetries, quiet,
	)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, rt)
}

func (s *Server) handleInternalUpdateRoutine(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string              `json:"user_id"`
		ID             string              `json:"id"`
		Name           *string             `json:"name"`
		Prompt         *string             `json:"prompt"`
		ScheduleCron   *string             `json:"schedule_cron"`
		Enabled        *bool               `json:"enabled"`
		AgentID        *string             `json:"agent_id"`
		Timezone       *string             `json:"timezone"`
		ConversationID *string             `json:"conversation_id"`
		Triggers       []db.RoutineTrigger `json:"triggers"`
		TriggersJSON   *string             `json:"triggers_json"`
		MaxRetries     *int                `json:"max_retries"`
		QuietUnchanged *bool               `json:"quiet_unchanged"`
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
	upd := db.RoutineUpdate{
		Name: body.Name, Prompt: body.Prompt, ScheduleCron: body.ScheduleCron,
		Enabled: body.Enabled, AgentID: body.AgentID, Timezone: body.Timezone,
		ConversationID: body.ConversationID, MaxRetries: body.MaxRetries,
		QuietUnchanged: body.QuietUnchanged, TriggersJSON: body.TriggersJSON,
	}
	if body.Triggers != nil && body.TriggersJSON == nil {
		encoded, err := db.EncodeTriggersJSON(body.Triggers)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid triggers"})
			return
		}
		upd.TriggersJSON = &encoded
	}
	if upd.ScheduleCron != nil {
		if err := validateCronOptional(*upd.ScheduleCron); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
	}
	rt, err := s.db.UpdateRoutine(uid, id, upd)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rt)
}

func (s *Server) handleInternalDeleteRoutine(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id"`
		ID     string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.db.DeleteRoutine(strings.TrimSpace(body.UserID), strings.TrimSpace(body.ID)); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
