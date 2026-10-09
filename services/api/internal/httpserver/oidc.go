package httpserver

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func (s *Server) handleOIDCConfig(w http.ResponseWriter, r *http.Request) {
	cfg := auth.LoadOIDCConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":      cfg.Enabled,
		"endpoint":     cfg.Endpoint,
		"client_id":    cfg.ClientID,
		"redirect_uri": cfg.RedirectURI,
		"organization": cfg.OrgName,
		"application":  cfg.AppName,
	})
}

func (s *Server) handleOIDCStart(w http.ResponseWriter, r *http.Request) {
	cfg := auth.LoadOIDCConfig()
	if !cfg.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "casdoor/oidc not configured"})
		return
	}
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name:     "openbot_oidc_state",
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	})
	authURL := cfg.AuthorizeURL(state)
	if r.URL.Query().Get("redirect") == "0" || strings.Contains(r.Header.Get("Accept"), "application/json") {
		writeJSON(w, http.StatusOK, map[string]string{"authorize_url": authURL, "state": state})
		return
	}
	http.Redirect(w, r, authURL, http.StatusFound)
}

type oidcExchangeBody struct {
	Code  string `json:"code"`
	State string `json:"state"`
}

func (s *Server) handleOIDCExchange(w http.ResponseWriter, r *http.Request) {
	cfg := auth.LoadOIDCConfig()
	if !cfg.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "casdoor/oidc not configured"})
		return
	}
	var body oidcExchangeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.Code) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "code required"})
		return
	}
	if c, err := r.Cookie("openbot_oidc_state"); err == nil && c.Value != "" && body.State != "" && c.Value != body.State {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid state"})
		return
	}

	tok, err := cfg.ExchangeCode(r.Context(), body.Code)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	info, err := cfg.FetchUserInfo(r.Context(), tok.AccessToken)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}

	u, err := s.upsertOIDCUser(info)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "openbot_oidc_state", Value: "", Path: "/", MaxAge: -1})
	if wantsAdminAudience(r) && !db.IsAdminRole(u.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "此账号无管理端权限"})
		return
	}
	token, err := auth.IssueToken(u.ID, u.Username, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token failed"})
		return
	}
	action := "auth.oidc_login"
	if wantsAdminAudience(r) {
		action = "auth.admin_oidc_login"
	}
	s.writeAudit(u.OrgID, u.ID, action, "user", u.ID, map[string]any{"method": "oidc"})
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  u.PublicMap(),
	})
}

// handleAdminOIDCExchange is the admin-console OIDC code exchange.
// Same token flow as /v1/auth/oidc/exchange, but requires org_admin or platform_admin.
func (s *Server) handleAdminOIDCExchange(w http.ResponseWriter, r *http.Request) {
	// Force admin audience so shared exchange enforces role.
	r.Header.Set("X-Client", "admin")
	q := r.URL.Query()
	q.Set("audience", "admin")
	r.URL.RawQuery = q.Encode()
	s.handleOIDCExchange(w, r)
}

func wantsAdminAudience(r *http.Request) bool {
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Client")), "admin") {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("audience")), "admin")
}

func (s *Server) upsertOIDCUser(info *auth.OIDCUserInfo) (*db.User, error) {
	if info == nil {
		return nil, errors.New("nil userinfo")
	}
	var u *db.User
	var err error
	if u, err = s.db.GetUserByCasdoorSub(info.Sub); err == nil {
		_ = s.db.LinkCasdoorSub(u.ID, info.Sub, info.Email)
		_ = s.db.ApplyPendingInviteIfAny(u)
		u, err = s.db.GetUserByID(u.ID)
		if err != nil {
			return nil, err
		}
		return s.syncOIDCRole(u, info)
	} else if !errors.Is(err, db.ErrNotFound) {
		return nil, err
	}
	if u, err = s.db.GetUserByUsername(info.Username); err == nil {
		_ = s.db.LinkCasdoorSub(u.ID, info.Sub, info.Email)
		_ = s.db.ApplyPendingInviteIfAny(u)
		u, err = s.db.GetUserByID(u.ID)
		if err != nil {
			return nil, err
		}
		return s.syncOIDCRole(u, info)
	} else if !errors.Is(err, db.ErrNotFound) {
		return nil, err
	}

	randPw := randomState() + randomState()
	hash, err := auth.HashPassword(randPw)
	if err != nil {
		return nil, err
	}
	// New OIDC users: map Casdoor roles when present, else member.
	role := db.RoleMember
	if mapped, ok := auth.MapOIDCRolesToLocal(info.Roles, info.Groups); ok {
		role = mapped
	}
	u, err = s.db.CreateUserFull(info.Username, hash, info.Email, info.Sub, role)
	if err != nil {
		if errors.Is(err, db.ErrUserExists) {
			alt := info.Username + "_" + strings.ReplaceAll(info.Sub, "/", "_")
			if len(alt) > 64 {
				alt = alt[:64]
			}
			u, err = s.db.CreateUserFull(alt, hash, info.Email, info.Sub, role)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}
	s.seedDefaultLLM(u.ID)
	s.provisionUserSandbox(u.ID)
	if role != db.RoleMember {
		s.writeAudit(u.OrgID, u.ID, "auth.oidc_role_sync", "user", u.ID, map[string]any{
			"from": "", "to": role, "roles": info.Roles, "groups": info.Groups, "new_user": true,
		})
	}
	return u, nil
}

// syncOIDCRole maps Casdoor roles/groups → users.role when env mapping matches.
// Never demotes the last remaining platform_admin.
func (s *Server) syncOIDCRole(u *db.User, info *auth.OIDCUserInfo) (*db.User, error) {
	if u == nil || info == nil {
		return u, nil
	}
	mapped, matched := auth.MapOIDCRolesToLocal(info.Roles, info.Groups)
	if !matched {
		return u, nil
	}
	mapped = db.NormalizeRole(mapped)
	cur := db.NormalizeRole(u.Role)
	if mapped == cur {
		return u, nil
	}
	// Guard: do not demote the last platform_admin.
	if cur == db.RolePlatformAdmin && mapped != db.RolePlatformAdmin {
		n, err := s.db.CountPlatformAdmins()
		if err != nil {
			return u, nil
		}
		if n <= 1 {
			s.writeAudit(u.OrgID, u.ID, "auth.oidc_role_sync_blocked", "user", u.ID, map[string]any{
				"from": cur, "to": mapped, "reason": "last_platform_admin",
				"roles": info.Roles, "groups": info.Groups,
			})
			return u, nil
		}
	}
	orgID := u.OrgID
	if orgID == "" {
		if org, err := s.db.EnsureDefaultOrg(); err == nil {
			orgID = org.ID
		}
	}
	if err := s.db.SetUserOrgRole(u.ID, orgID, mapped); err != nil {
		return u, nil
	}
	s.writeAudit(orgID, u.ID, "auth.oidc_role_sync", "user", u.ID, map[string]any{
		"from": cur, "to": mapped, "roles": info.Roles, "groups": info.Groups,
	})
	return s.db.GetUserByID(u.ID)
}

func (s *Server) seedDefaultLLM(userID string) {
	base := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	model := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	enableTools := false
	switch strings.ToLower(strings.TrimSpace(os.Getenv("OPENAI_ENABLE_TOOLS"))) {
	case "1", "true", "yes", "on":
		enableTools = true
	}
	_, _ = s.db.CreateLLMConnection(userID, "默认连接", base, key, model, enableTools, true, nil)
}

func randomState() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
