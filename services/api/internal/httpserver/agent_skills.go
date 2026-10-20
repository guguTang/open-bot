package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func (s *Server) handleListAgentSkills(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	agentID := r.PathValue("id")
	list, err := s.db.ListAgentSkills(uid, agentID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"skills": list, "agent_id": agentID})
}

func (s *Server) handleSetAgentSkill(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	agentID := r.PathValue("id")
	name := r.PathValue("name")
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	sk, err := s.db.SetAgentSkillEnabled(uid, agentID, name, body.Enabled)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		if errors.Is(err, db.ErrSkillDisableBlocked) {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": err.Error(),
				"code":  "skill_disable_blocked",
			})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, sk)
}

func (s *Server) handleReplaceAgentSkills(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	agentID := r.PathValue("id")
	var body struct {
		Enabled []string `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.db.ReplaceAgentSkills(uid, agentID, body.Enabled); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	list, _ := s.db.ListAgentSkills(uid, agentID)
	writeJSON(w, http.StatusOK, map[string]any{"skills": list, "agent_id": agentID})
}

// resolveOnboardingPreset loads a configured preset by focus id (DB first, then hardcoded A–F).
func (s *Server) resolveOnboardingPreset(focus string) *db.OnboardingPreset {
	focus = strings.TrimSpace(focus)
	if focus == "" {
		return nil
	}
	if p, err := s.db.GetOnboardingPreset(focus); err == nil && p != nil {
		return p
	}
	// Single-letter keys were historically uppercased (A–F).
	if len(focus) == 1 {
		up := strings.ToUpper(focus)
		if p, err := s.db.GetOnboardingPreset(up); err == nil && p != nil {
			return p
		}
		focus = up
	}
	for _, p := range db.HardcodedOnboardingFallback() {
		if p.ID == focus || strings.EqualFold(p.ID, focus) {
			cp := p
			return &cp
		}
	}
	return nil
}

func (s *Server) handleAgentOnboarding(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	agentID := r.PathValue("id")
	var body struct {
		Focus        string   `json:"focus"` // preset id (A–F or admin-defined slug)
		Description  string   `json:"description"`
		SystemPrompt string   `json:"system_prompt"`
		Skills       []string `json:"skills"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	focus := strings.TrimSpace(body.Focus)
	if len(focus) == 1 {
		focus = strings.ToUpper(focus)
	}
	desc := strings.TrimSpace(body.Description)
	sp := strings.TrimSpace(body.SystemPrompt)
	var skills []string
	skillsSet := false
	if body.Skills != nil {
		skills = body.Skills
		skillsSet = true
	}
	if preset := s.resolveOnboardingPreset(focus); preset != nil {
		if desc == "" {
			desc = preset.Description
		}
		if sp == "" {
			sp = preset.SystemPrompt
		}
		if !skillsSet {
			if sk, set := preset.ResolveSkills(); set {
				skills = sk
				skillsSet = true
			}
		}
	}
	var skillArg []string
	if skillsSet {
		skillArg = skills
		if skillArg == nil {
			skillArg = []string{}
		}
		skillArg = db.EnsureAlwaysOnSkills(skillArg)
		// Platform public/common (generative-ui): keep default-on across presets A/B/D/F.
		skillArg = db.EnsurePublicCommonSkills(skillArg)
	} else {
		skillArg = nil // leave agent_skills unset → all user-enabled
	}
	a, err := s.db.ApplyAgentOnboarding(uid, agentID, desc, sp, skillArg)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "agent not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"agent": a, "focus": focus})
}
