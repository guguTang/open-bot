package httpserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// cloneAgentBody is shared by the user endpoint (Web「复制助手」) and the internal
// endpoint used by the runtime clone_agent tool.
type cloneAgentBody struct {
	Name         string  `json:"name"`
	Description  *string `json:"description"`
	SystemPrompt *string `json:"system_prompt"`
	// SystemPromptAppend is added after the (copied or overridden) persona — "copy then specialise".
	SystemPromptAppend string `json:"system_prompt_append"`
	ComputerMode       string `json:"computer_mode"`
	CopyMemory         bool   `json:"copy_memory"`
	CopyRoutines       bool   `json:"copy_routines"`
	// Skill tweaks applied to the copy after the allowlist is cloned.
	EnableSkills  []string `json:"enable_skills"`
	DisableSkills []string `json:"disable_skills"`
	// FollowUp: task handed to the new bot right after the copy (queued as a background task
	// in the new bot's own thread, so the copy does it with its own persona/skills).
	FollowUp string `json:"follow_up"`
}

// cloneAgentFor runs the full clone (DB copy + skill tweaks + optional follow-up task).
func (s *Server) cloneAgentFor(uid, sourceID string, body cloneAgentBody) (map[string]any, int, error) {
	opts := db.CloneAgentOptions{
		Name:         body.Name,
		Description:  body.Description,
		SystemPrompt: body.SystemPrompt,
		ComputerMode: body.ComputerMode,
		CopyMemory:   body.CopyMemory,
		CopyRoutines: body.CopyRoutines,
	}
	// Follow-up / handoff tasks always get bot-scoped memories so the copy can continue related past work.
	if strings.TrimSpace(body.FollowUp) != "" {
		opts.CopyMemory = true
	}
	if extra := strings.TrimSpace(body.SystemPromptAppend); extra != "" {
		base := ""
		if body.SystemPrompt != nil {
			base = strings.TrimSpace(*body.SystemPrompt)
		} else if src, err := s.db.GetAgent(uid, sourceID); err == nil {
			base = strings.TrimSpace(src.SystemPrompt)
		}
		merged := extra
		if base != "" {
			merged = base + "\n\n" + extra
		}
		opts.SystemPrompt = &merged
	}
	res, err := s.db.CloneAgent(uid, sourceID, opts)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, http.StatusNotFound, errors.New("agent not found")
		}
		if res == nil {
			return nil, http.StatusBadRequest, err
		}
	}
	s.stampAgentOnline(uid, res.Agent)
	out := map[string]any{
		"ok":                     true,
		"agent":                  res.Agent,
		"source_agent_id":        res.SourceID,
		"conversation_id":        res.ConversationID,
		"skills_copied":          res.SkillsCopied,
		"skills_inherit_account": res.SkillsInherit,
		"memories_copied":        res.MemoriesCopied,
		"routines_copied":        res.RoutinesCopied,
		"routine_names":          res.RoutineNames,
		"not_copied":             []string{"聊天记录与线程", "群聊成员身份", "Bot 密钥（需重新授权）", "private 模式的私有文件", "后台任务与用量统计"},
		"shared":                 []string{"用户级记忆", "账号技能库", "模型连接", "MCP", "已登记电脑", "team 模式工作区"},
	}
	if err != nil {
		out["warning"] = err.Error()
	}
	newID := res.Agent.ID

	var skillErrs []string
	for _, n := range body.EnableSkills {
		if n = strings.TrimSpace(n); n != "" {
			if _, e := s.db.SetAgentSkillEnabled(uid, newID, n, true); e != nil {
				skillErrs = append(skillErrs, fmt.Sprintf("启用 %s 失败：%v", n, e))
			}
		}
	}
	for _, n := range body.DisableSkills {
		if n = strings.TrimSpace(n); n != "" {
			if _, e := s.db.SetAgentSkillEnabled(uid, newID, n, false); e != nil {
				skillErrs = append(skillErrs, fmt.Sprintf("关闭 %s 失败：%v", n, e))
			}
		}
	}
	if len(skillErrs) > 0 {
		out["skill_errors"] = skillErrs
	}
	if enabled, e := s.db.ListEnabledSkillNamesForAgent(uid, newID); e == nil {
		if enabled == nil {
			enabled = []string{}
		}
		out["enabled_skills"] = enabled
	}

	if goal := strings.TrimSpace(body.FollowUp); goal != "" && res.ConversationID != "" {
		srcName := ""
		if src, e := s.db.GetAgent(uid, sourceID); e == nil {
			srcName = src.Name
		}
		note := goal
		if srcName != "" {
			note = fmt.Sprintf("（复制自「%s」后交代的任务）\n%s", srcName, goal)
		}
		msg, merr := s.db.AddMessage(res.ConversationID, "user", note)
		if merr == nil {
			s.publishConversationMessage(uid, msg)
			task, terr := s.db.EnqueueConversationTask(uid, res.ConversationID, newID, goal, msg.ID)
			if terr == nil {
				s.wakeTasks()
				s.publishTaskStatus(uid, res.ConversationID, newID, "", "running", "正在做…")
				out["follow_up_task_id"] = task.ID
				out["follow_up_status"] = "queued"
			} else {
				out["follow_up_error"] = terr.Error()
			}
		} else {
			out["follow_up_error"] = merr.Error()
		}
	}

	if s.events != nil {
		s.events.Publish(uid, map[string]any{
			"type":            "agents_changed",
			"reason":          "cloned",
			"agent_id":        newID,
			"source_agent_id": sourceID,
		})
	}
	return out, http.StatusCreated, nil
}

// POST /v1/agents/{id}/clone — Web「复制助手」.
func (s *Server) handleCloneAgent(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body cloneAgentBody
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
	}
	out, code, err := s.cloneAgentFor(uid, r.PathValue("id"), body)
	if err != nil {
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, code, out)
}

// POST /internal/agents/clone — runtime clone_agent tool (the bot copies itself).
// The source must belong to user_id, so org/tenant boundaries hold (agents are user-owned).
func (s *Server) handleInternalCloneAgent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID        string `json:"user_id"`
		SourceAgentID string `json:"source_agent_id"`
		cloneAgentBody
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	src := strings.TrimSpace(body.SourceAgentID)
	if uid == "" || src == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and source_agent_id required"})
		return
	}
	out, code, err := s.cloneAgentFor(uid, src, body.cloneAgentBody)
	if err != nil {
		writeJSON(w, code, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, code, out)
}
