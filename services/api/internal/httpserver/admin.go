package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func (s *Server) loadAuthUser(w http.ResponseWriter, r *http.Request) (*db.User, bool) {
	uid := userIDFrom(r.Context())
	u, err := s.db.GetUserByID(uid)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return nil, false
	}
	return u, true
}

func (s *Server) requireOrgAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.loadAuthUser(w, r)
		if !ok {
			return
		}
		if u.OrgID == "" || !db.RoleAtLeast(u.Role, db.RoleOrgAdmin) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "需要组织管理员权限"})
			return
		}
		next(w, r)
	})
}

func (s *Server) requirePlatformAdmin(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAuth(func(w http.ResponseWriter, r *http.Request) {
		u, ok := s.loadAuthUser(w, r)
		if !ok {
			return
		}
		if db.NormalizeRole(u.Role) != db.RolePlatformAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "需要平台管理员权限"})
			return
		}
		next(w, r)
	})
}

// adminScopeOrgID returns the org to operate on. platform_admin may pass
// X-Admin-Org-Id / ?org_id= to view another tenant; org_admin stays own-org.
func (s *Server) adminScopeOrgID(r *http.Request, u *db.User) string {
	if db.NormalizeRole(u.Role) == db.RolePlatformAdmin {
		if v := strings.TrimSpace(r.Header.Get("X-Admin-Org-Id")); v != "" {
			return v
		}
		if v := strings.TrimSpace(r.URL.Query().Get("org_id")); v != "" {
			return v
		}
	}
	return u.OrgID
}

func (s *Server) writeAudit(orgID, actorID, action, targetType, targetID string, meta map[string]any) {
	if strings.TrimSpace(orgID) == "" || strings.TrimSpace(action) == "" {
		return
	}
	metaJSON := "{}"
	if meta != nil {
		if b, err := json.Marshal(meta); err == nil {
			metaJSON = string(b)
		}
	}
	_ = s.db.InsertAuditLog(orgID, actorID, action, targetType, targetID, metaJSON)
}

func (s *Server) handleAdminOrg(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	if u.OrgID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "用户未加入组织"})
		return
	}
	org, err := s.db.GetOrgByID(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"org": map[string]any{
			"id":         org.ID,
			"slug":       org.Slug,
			"name":       org.Name,
			"created_at": org.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
		},
		"me": u.PublicMap(),
	})
}

func (s *Server) handleAdminMembers(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	members, err := s.db.ListOrgMembers(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	invites, err := s.db.ListOrgInvites(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	pubMembers := make([]map[string]any, 0, len(members))
	for _, m := range members {
		pubMembers = append(pubMembers, map[string]any{
			"id":         m.ID,
			"username":   m.Username,
			"email":      m.Email,
			"role":       m.Role,
			"org_id":     m.OrgID,
			"created_at": m.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
		})
	}
	pubInvites := make([]map[string]any, 0, len(invites))
	for _, inv := range invites {
		pubInvites = append(pubInvites, map[string]any{
			"id":                inv.ID,
			"org_id":            inv.OrgID,
			"username_or_email": inv.UsernameOrEmail,
			"role":              inv.Role,
			"status":            inv.Status,
			"created_at":        inv.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": pubMembers, "invites": pubInvites})
}

type inviteBody struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

func (s *Server) handleAdminInvite(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body inviteBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	target := strings.TrimSpace(body.Username)
	if target == "" {
		target = strings.TrimSpace(body.Email)
	}
	if target == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username 或 email 必填"})
		return
	}
	role := db.NormalizeRole(body.Role)
	if role == db.RolePlatformAdmin && !db.RoleAtLeast(admin.Role, db.RolePlatformAdmin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "仅平台管理员可授予 platform_admin"})
		return
	}

	// If user already exists, assign immediately.
	if existing, err := s.db.GetUserByUsername(target); err == nil {
		if err := s.db.SetUserOrgRole(existing.ID, admin.OrgID, role); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if refreshed, err := s.db.GetUserByID(existing.ID); err == nil {
			existing = refreshed
		}
		s.writeAudit(admin.OrgID, admin.ID, "member.invite_join", "user", existing.ID, map[string]any{
			"username": existing.Username,
			"role":     role,
			"joined":   true,
		})
		writeJSON(w, http.StatusOK, map[string]any{
			"joined": true,
			"user":   existing.PublicMap(),
			"role":   role,
		})
		return
	} else if !errors.Is(err, db.ErrNotFound) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	inv, err := s.db.CreateOrgInvite(admin.OrgID, target, role, admin.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "member.invite", "invite", inv.ID, map[string]any{
		"username_or_email": inv.UsernameOrEmail,
		"role":              inv.Role,
		"joined":            false,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"joined": false,
		"invite": map[string]any{
			"id":                inv.ID,
			"username_or_email": inv.UsernameOrEmail,
			"role":              inv.Role,
			"status":            inv.Status,
		},
	})
}

type patchMemberBody struct {
	Role string `json:"role"`
}

func (s *Server) handleAdminPatchMember(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	memberID := r.PathValue("id")
	var body patchMemberBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	role := db.NormalizeRole(body.Role)
	if role == db.RolePlatformAdmin && !db.RoleAtLeast(admin.Role, db.RolePlatformAdmin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "仅平台管理员可授予 platform_admin"})
		return
	}
	member, err := s.db.GetUserByID(memberID)
	if err != nil || member.OrgID != admin.OrgID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "成员不存在"})
		return
	}
	if strings.EqualFold(member.Username, db.A2ASystemUsername) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "不可修改系统用户"})
		return
	}
	if member.ID == admin.ID && !db.IsAdminRole(role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不能将自己降为非管理员"})
		return
	}
	if member.Role == db.RolePlatformAdmin && role != db.RolePlatformAdmin {
		n, err := s.db.CountPlatformAdmins()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n <= 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不能降级唯一的平台管理员"})
			return
		}
	}
	prevRole := member.Role
	if err := s.db.SetUserOrgRole(member.ID, admin.OrgID, role); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	member.Role = role
	s.writeAudit(admin.OrgID, admin.ID, "member.role_change", "user", member.ID, map[string]any{
		"username":  member.Username,
		"from_role": prevRole,
		"to_role":   role,
	})
	writeJSON(w, http.StatusOK, map[string]any{"user": member.PublicMap()})
}

func (s *Server) handleAdminGetLLM(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, settings.Public())
}

type orgLLMBody struct {
	Name           string `json:"name"`
	BaseURL        string `json:"base_url"`
	APIKey         string `json:"api_key"`
	Model          string `json:"model"`
	EnableTools    bool   `json:"enable_tools"`
	ContextWindow  *int   `json:"context_window"`
	MaxToolRounds  *int   `json:"max_tool_rounds"`
}

func (s *Server) handleAdminPutLLM(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body orgLLMBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	apiKey := body.APIKey
	if body.APIKey == "" {
		if cur, err := s.db.GetOrgSettings(u.OrgID); err == nil {
			apiKey = cur.LLMAPIKey
		}
	}
	if s.rejectIfToolsUnsupported(w, r, body.BaseURL, apiKey, body.Model, body.EnableTools) {
		return
	}
	settings, err := s.db.UpsertOrgLLM(u.OrgID, body.Name, body.BaseURL, body.APIKey, body.Model, body.EnableTools, body.ContextWindow, body.MaxToolRounds, body.APIKey == "")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(u.OrgID, u.ID, "org.llm_update", "org_settings", u.OrgID, map[string]any{
		"llm_name":            settings.LLMName,
		"llm_base_url":        settings.LLMBaseURL,
		"llm_model":           settings.LLMModel,
		"llm_enable_tools":    settings.LLMEnableTools,
		"llm_max_tool_rounds": settings.LLMMaxToolRounds,
		"api_key_updated":     body.APIKey != "",
	})
	writeJSON(w, http.StatusOK, settings.Public())
}

func (s *Server) handleAdminUsage(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	orgID := s.adminScopeOrgID(r, u)
	days := 30
	if q := strings.TrimSpace(r.URL.Query().Get("days")); q != "" {
		if n, err := strconv.Atoi(q); err == nil {
			days = n
		}
	}
	usage, err := s.db.GetOrgUsageDetailed(orgID, days)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, usage)
}

func (s *Server) handleAdminFeatureFlags(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if r.Method == http.MethodPut {
		var body struct {
			FeatureFlagsJSON string `json:"feature_flags_json"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		settings, err = s.db.SetOrgFeatureFlags(u.OrgID, body.FeatureFlagsJSON)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		s.writeAudit(u.OrgID, u.ID, "org.feature_flags_update", "org_settings", u.OrgID, map[string]any{
			"feature_flags_json": settings.FeatureFlagsJSON,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"feature_flags_json": settings.FeatureFlagsJSON,
		"updated_at":         settings.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
	})
}

func (s *Server) handleAdminAuditLogs(w http.ResponseWriter, r *http.Request) {
	u, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	limit := 100
	if q := strings.TrimSpace(r.URL.Query().Get("limit")); q != "" {
		if n, err := strconv.Atoi(q); err == nil {
			limit = n
		}
	}
	logs, err := s.db.ListAuditLogs(u.OrgID, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"logs": logs})
}

// handleAdminLogin authenticates for the business admin console only.
// Members and other non-admin roles receive 403 (use /v1/auth/login for chat).
func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	var body authBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	u, err := s.db.GetUserByUsername(body.Username)
	if err != nil || !auth.CheckPassword(u.PasswordHash, body.Password) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}
	_ = s.db.ApplyPendingInviteIfAny(u)
	if refreshed, err := s.db.GetUserByID(u.ID); err == nil {
		u = refreshed
	}
	if !db.IsAdminRole(u.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "此账号无管理端权限"})
		return
	}
	token, err := auth.IssueToken(u.ID, u.Username, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token failed"})
		return
	}
	s.writeAudit(u.OrgID, u.ID, "auth.admin_login", "user", u.ID, map[string]any{"method": "password"})
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  u.PublicMap(),
	})
}
