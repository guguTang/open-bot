package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func onboardingPresetAdminPublic(p *db.OnboardingPreset) map[string]any {
	if p == nil {
		return nil
	}
	return map[string]any{
		"id":                 p.ID,
		"title":              p.Title,
		"card_desc":          p.CardDesc,
		"user_prompt":        p.UserPrompt,
		"description":        p.Description,
		"system_prompt":      p.SystemPrompt,
		"skills_json":        p.SkillsJSON,
		"sort_order":         p.SortOrder,
		"enabled":            p.Enabled,
		"is_custom_fallback": p.IsCustomFallback,
		"created_at":         p.CreatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
		"updated_at":         p.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00"),
	}
}

func (s *Server) handleListOnboardingPresets(w http.ResponseWriter, r *http.Request) {
	list, err := s.db.ListOnboardingPresets(false)
	if err != nil || len(list) == 0 {
		list = db.HardcodedOnboardingFallback()
	}
	pubs := make([]db.OnboardingPresetPublic, 0, len(list))
	customID := "E"
	for _, p := range list {
		if !p.Enabled {
			continue
		}
		pubs = append(pubs, p.Public())
		if p.IsCustomFallback {
			customID = p.ID
		}
	}
	if len(pubs) == 0 {
		for _, p := range db.HardcodedOnboardingFallback() {
			pubs = append(pubs, p.Public())
			if p.IsCustomFallback {
				customID = p.ID
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"presets":             pubs,
		"custom_fallback_id":  customID,
	})
}

func (s *Server) handleAdminListOnboardingPresets(w http.ResponseWriter, r *http.Request) {
	list, err := s.db.ListOnboardingPresets(true)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, onboardingPresetAdminPublic(&list[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": out})
}

type adminOnboardingPresetBody struct {
	ID               string          `json:"id"`
	Title            string          `json:"title"`
	CardDesc         string          `json:"card_desc"`
	UserPrompt       string          `json:"user_prompt"`
	Description      string          `json:"description"`
	SystemPrompt     string          `json:"system_prompt"`
	SkillsJSON       string          `json:"skills_json"`
	Skills           json.RawMessage `json:"skills"` // optional array; wins over skills_json when set
	SortOrder        *int            `json:"sort_order"`
	Enabled          *bool           `json:"enabled"`
	IsCustomFallback *bool           `json:"is_custom_fallback"`
}

func (b *adminOnboardingPresetBody) toInput(requireID bool) (db.OnboardingPresetInput, error) {
	in := db.OnboardingPresetInput{
		ID:               b.ID,
		Title:            b.Title,
		CardDesc:         b.CardDesc,
		UserPrompt:       b.UserPrompt,
		Description:      b.Description,
		SystemPrompt:     b.SystemPrompt,
		Enabled:          b.Enabled,
		IsCustomFallback: b.IsCustomFallback,
	}
	if requireID && strings.TrimSpace(b.ID) == "" {
		return in, errors.New("id 必填")
	}
	if b.SortOrder != nil {
		in.SortOrder = *b.SortOrder
	}
	if len(b.Skills) > 0 && string(b.Skills) != "null" {
		in.SkillsJSON = string(b.Skills)
	} else if strings.TrimSpace(b.SkillsJSON) != "" {
		in.SkillsJSON = b.SkillsJSON
	} else {
		in.SkillsJSON = db.SkillsUnsetMarker
	}
	return in, nil
}

func (s *Server) handleAdminCreateOnboardingPreset(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body adminOnboardingPresetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	in, err := body.toInput(true)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.SortOrder == nil {
		list, _ := s.db.ListOnboardingPresets(true)
		max := 0
		for _, p := range list {
			if p.SortOrder > max {
				max = p.SortOrder
			}
		}
		in.SortOrder = max + 10
	}
	p, err := s.db.CreateOnboardingPreset(in)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "onboarding_preset.create", "onboarding_preset", p.ID, map[string]any{
		"title": p.Title,
	})
	writeJSON(w, http.StatusOK, map[string]any{"preset": onboardingPresetAdminPublic(p)})
}

func (s *Server) handleAdminPatchOnboardingPreset(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	var body adminOnboardingPresetBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	in, err := body.toInput(false)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	// Preserve skills when neither skills nor skills_json sent.
	if len(body.Skills) == 0 && strings.TrimSpace(body.SkillsJSON) == "" {
		in.SkillsJSON = ""
	}
	if body.SortOrder == nil {
		if cur, err := s.db.GetOnboardingPreset(id); err == nil {
			in.SortOrder = cur.SortOrder
		}
	}
	p, err := s.db.UpdateOnboardingPreset(id, in)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "preset not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "onboarding_preset.update", "onboarding_preset", p.ID, map[string]any{
		"title": p.Title,
	})
	writeJSON(w, http.StatusOK, map[string]any{"preset": onboardingPresetAdminPublic(p)})
}

func (s *Server) handleAdminDeleteOnboardingPreset(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if err := s.db.DeleteOnboardingPreset(id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "preset not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "onboarding_preset.delete", "onboarding_preset", id, nil)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleAdminReorderOnboardingPresets(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if err := s.db.ReorderOnboardingPresets(body.IDs); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "onboarding_preset.reorder", "onboarding_preset", "", map[string]any{
		"ids": body.IDs,
	})
	list, err := s.db.ListOnboardingPresets(true)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	out := make([]map[string]any, 0, len(list))
	for i := range list {
		out = append(out, onboardingPresetAdminPublic(&list[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": out})
}
