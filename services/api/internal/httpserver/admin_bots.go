package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func agentAdminPublic(a *db.Agent, ownerUsername string) map[string]any {
	if a == nil {
		return nil
	}
	return map[string]any{
		"id":             a.ID,
		"user_id":        a.UserID,
		"owner_username": ownerUsername,
		"name":           a.Name,
		"description":    a.Description,
		"system_prompt":  a.SystemPrompt,
		"is_builtin":     a.IsBuiltin,
		"computer_mode":  a.ComputerMode,
		"created_at":     a.CreatedAt.UTC().Format(time.RFC3339Nano),
		"updated_at":     a.UpdatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func (s *Server) handleAdminListBots(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	list, err := s.db.ListAgentsByOrg(admin.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, item := range list {
		a := item.Agent
		out = append(out, agentAdminPublic(&a, item.OwnerUsername))
	}
	writeJSON(w, http.StatusOK, map[string]any{"bots": out})
}

type adminBotBody struct {
	UserID       string `json:"user_id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	SystemPrompt string `json:"system_prompt"`
	ComputerMode string `json:"computer_mode"`
}

func (s *Server) handleAdminCreateBot(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body adminBotBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	ownerID := strings.TrimSpace(body.UserID)
	if ownerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id 必填"})
		return
	}
	owner, err := s.db.GetUserByID(ownerID)
	if err != nil || owner.OrgID != admin.OrgID {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "目标用户不在本组织"})
		return
	}
	if strings.EqualFold(owner.Username, db.A2ASystemUsername) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不可为系统用户创建 Bot"})
		return
	}
	a, err := s.db.CreateAgentFull(owner.ID, body.Name, body.Description, body.SystemPrompt, body.ComputerMode)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	_ = s.db.SeedNewAgentDefaultSkills(owner.ID, a.ID)
	s.writeAudit(admin.OrgID, admin.ID, "bot.create", "agent", a.ID, map[string]any{
		"name":     a.Name,
		"user_id":  a.UserID,
		"username": owner.Username,
	})
	s.publishAgentsChanged(owner.ID, "created", a.ID, nil)
	writeJSON(w, http.StatusCreated, map[string]any{"bot": agentAdminPublic(a, owner.Username)})
}

func (s *Server) handleAdminPatchBot(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	existing, err := s.db.GetAgentInOrg(id, admin.OrgID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Bot 不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body adminBotBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	var modePtr *string
	if strings.TrimSpace(body.ComputerMode) != "" {
		m := body.ComputerMode
		modePtr = &m
	}
	name := body.Name
	if strings.TrimSpace(name) == "" {
		name = existing.Name
	}
	a, err := s.db.UpdateAgentAdmin(id, name, body.Description, body.SystemPrompt, modePtr)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Bot 不存在"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "bot.update", "agent", a.ID, map[string]any{
		"name":    a.Name,
		"user_id": a.UserID,
	})
	s.publishAgentsChanged(a.UserID, "updated", a.ID, nil)
	writeJSON(w, http.StatusOK, map[string]any{"bot": agentAdminPublic(a, existing.OwnerUsername)})
}

func (s *Server) handleAdminDeleteBot(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	existing, err := s.db.GetAgentInOrg(id, admin.OrgID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Bot 不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if existing.IsBuiltin {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "内置 Bot 不可删除"})
		return
	}
	if err := s.db.DeleteAgentByID(id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Bot 不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "bot.delete", "agent", id, map[string]any{
		"name":    existing.Name,
		"user_id": existing.UserID,
	})
	s.publishAgentsChanged(existing.UserID, "deleted", id, nil)
	w.WriteHeader(http.StatusNoContent)
}

// POST /v1/admin/bots/{id}/clone — org admin copies a bot within the org; the copy keeps the
// same owner (never moves across users/orgs). Same copy rules as the user「复制助手」.
func (s *Server) handleAdminCloneBot(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	existing, err := s.db.GetAgentInOrg(id, admin.OrgID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Bot 不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body cloneAgentBody
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	body.FollowUp = "" // admins don't start work in a member's chat
	out, code, err := s.cloneAgentFor(existing.UserID, id, body)
	if err != nil {
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}
	if a, ok := out["agent"].(*db.Agent); ok && a != nil {
		s.writeAudit(admin.OrgID, admin.ID, "bot.clone", "agent", a.ID, map[string]any{
			"name":            a.Name,
			"user_id":         a.UserID,
			"source_agent_id": id,
			"copy_memory":     body.CopyMemory,
			"copy_routines":   body.CopyRoutines,
		})
		out["bot"] = agentAdminPublic(a, existing.OwnerUsername)
	}
	writeJSON(w, code, out)
}
