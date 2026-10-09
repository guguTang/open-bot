package httpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	members, err := s.db.ListOrgMembers(admin.OrgID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	users := make([]map[string]any, 0, len(members))
	for _, m := range members {
		users = append(users, map[string]any{
			"id":         m.ID,
			"username":   m.Username,
			"email":      m.Email,
			"role":       m.Role,
			"org_id":     m.OrgID,
			"created_at": m.CreatedAt.UTC().Format("2006-01-02T15:04:05.000000000Z07:00"),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

type adminCreateUserBody struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body adminCreateUserBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	username := strings.TrimSpace(body.Username)
	password := body.Password
	if username == "" || password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username 与 password 必填"})
		return
	}
	if strings.EqualFold(username, db.A2ASystemUsername) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "保留用户名不可用"})
		return
	}
	role := db.NormalizeRole(body.Role)
	if role == db.RolePlatformAdmin && !db.RoleAtLeast(admin.Role, db.RolePlatformAdmin) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "仅平台管理员可授予 platform_admin"})
		return
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "password hash failed"})
		return
	}
	u, err := s.db.CreateUserFull(username, hash, body.Email, "", db.RoleMember)
	if err != nil {
		if errors.Is(err, db.ErrUserExists) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "用户名已存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := s.db.SetUserOrgRole(u.ID, admin.OrgID, role); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	u, err = s.db.GetUserByID(u.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.provisionUserSandbox(u.ID)
	s.writeAudit(admin.OrgID, admin.ID, "user.create", "user", u.ID, map[string]any{
		"username": u.Username,
		"role":     u.Role,
		"email":    u.Email,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"user": u.PublicMap()})
}

type adminPatchUserBody struct {
	Email    *string `json:"email"`
	Role     *string `json:"role"`
	Password *string `json:"password"`
}

func (s *Server) handleAdminPatchUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("id")
	var body adminPatchUserBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	target, err := s.db.GetUserByID(userID)
	if err != nil || target.OrgID != admin.OrgID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
		return
	}
	if strings.EqualFold(target.Username, db.A2ASystemUsername) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "不可修改系统用户"})
		return
	}

	meta := map[string]any{"username": target.Username}

	if body.Role != nil {
		role := db.NormalizeRole(*body.Role)
		if role == db.RolePlatformAdmin && !db.RoleAtLeast(admin.Role, db.RolePlatformAdmin) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "仅平台管理员可授予 platform_admin"})
			return
		}
		// Refuse demoting yourself out of admin.
		if target.ID == admin.ID && !db.IsAdminRole(role) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不能将自己降为非管理员"})
			return
		}
		// Refuse demoting/removing the last platform_admin.
		if target.Role == db.RolePlatformAdmin && role != db.RolePlatformAdmin {
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
		prev := target.Role
		if err := s.db.SetUserOrgRole(target.ID, admin.OrgID, role); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		meta["from_role"] = prev
		meta["to_role"] = role
	}

	if body.Email != nil {
		if err := s.db.UpdateUserEmail(target.ID, *body.Email); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		meta["email"] = strings.TrimSpace(*body.Email)
	}

	if body.Password != nil {
		pw := *body.Password
		if strings.TrimSpace(pw) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password 不能为空"})
			return
		}
		hash, err := auth.HashPassword(pw)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "password hash failed"})
			return
		}
		if err := s.db.SetUserPasswordHash(target.ID, hash); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		meta["password_reset"] = true
	}

	refreshed, err := s.db.GetUserByID(target.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "user.update", "user", refreshed.ID, meta)
	writeJSON(w, http.StatusOK, map[string]any{"user": refreshed.PublicMap()})
}

// rejectDeleteUser reports why an org admin may not soft-delete target.
// Platform-admin last-one protection is applied by the caller, because batch
// delete must count the whole set.
func rejectDeleteUser(admin, target *db.User) (int, string) {
	if target == nil || target.OrgID != admin.OrgID {
		return http.StatusNotFound, "用户不存在"
	}
	if target.ID == admin.ID {
		return http.StatusBadRequest, "不能删除自己"
	}
	if strings.EqualFold(target.Username, db.A2ASystemUsername) {
		return http.StatusForbidden, "不可删除系统用户"
	}
	return 0, ""
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	target, err := s.db.GetUserByID(r.PathValue("id"))
	if err != nil || target.OrgID != admin.OrgID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
		return
	}
	if code, msg := rejectDeleteUser(admin, target); code != 0 {
		writeJSON(w, code, map[string]string{"error": msg})
		return
	}
	if target.Role == db.RolePlatformAdmin {
		n, err := s.db.CountPlatformAdmins()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n <= 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "不能删除唯一的平台管理员"})
			return
		}
	}
	agentIDs, purge, side, err := s.purgeThenSoftDeleteUser(r, target.ID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	audit := map[string]any{
		"username":  target.Username,
		"role":      target.Role,
		"agent_ids": agentIDs,
		"soft":      true,
		"purged":    true,
	}
	if purge != nil {
		audit["counts"] = purge.Counts
	}
	if side != nil {
		audit["side_effects"] = side
	}
	s.writeAudit(admin.OrgID, admin.ID, "user.delete", "user", target.ID, audit)
	w.WriteHeader(http.StatusNoContent)
}

type adminBatchDeleteUsersBody struct {
	IDs []string `json:"ids"`
}

type adminDeleteFailure struct {
	ID    string `json:"id"`
	Error string `json:"error"`
}

func (s *Server) handleAdminBatchDeleteUsers(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body adminBatchDeleteUsersBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	seen := map[string]struct{}{}
	ids := make([]string, 0, len(body.IDs))
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ids 必填"})
		return
	}
	if len(ids) > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "一次最多删除 100 个用户"})
		return
	}

	failed := make([]adminDeleteFailure, 0)
	eligible := make([]*db.User, 0, len(ids))
	for _, id := range ids {
		target, err := s.db.GetUserByID(id)
		if err != nil || target.OrgID != admin.OrgID {
			failed = append(failed, adminDeleteFailure{ID: id, Error: "用户不存在"})
			continue
		}
		if _, msg := rejectDeleteUser(admin, target); msg != "" {
			failed = append(failed, adminDeleteFailure{ID: id, Error: msg})
			continue
		}
		eligible = append(eligible, target)
	}

	deletingAdmins := 0
	for _, t := range eligible {
		if t.Role == db.RolePlatformAdmin {
			deletingAdmins++
		}
	}
	if deletingAdmins > 0 {
		n, err := s.db.CountPlatformAdmins()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n-deletingAdmins < 1 {
			// Keep at least one live platform_admin. Extra ones in this batch are skipped.
			allowed := n - 1
			if allowed < 0 {
				allowed = 0
			}
			queued := 0
			kept := make([]*db.User, 0, len(eligible))
			for _, t := range eligible {
				if t.Role == db.RolePlatformAdmin {
					if queued >= allowed {
						failed = append(failed, adminDeleteFailure{ID: t.ID, Error: "不能删除唯一的平台管理员"})
						continue
					}
					queued++
				}
				kept = append(kept, t)
			}
			eligible = kept
		}
	}

	deleted := make([]map[string]any, 0, len(eligible))
	for _, target := range eligible {
		agentIDs, purge, side, err := s.purgeThenSoftDeleteUser(r, target.ID)
		if err != nil {
			msg := err.Error()
			if errors.Is(err, db.ErrNotFound) {
				msg = "用户不存在"
			}
			failed = append(failed, adminDeleteFailure{ID: target.ID, Error: msg})
			continue
		}
		audit := map[string]any{
			"username":  target.Username,
			"role":      target.Role,
			"agent_ids": agentIDs,
			"soft":      true,
			"purged":    true,
			"batch":     true,
		}
		if purge != nil {
			audit["counts"] = purge.Counts
		}
		if side != nil {
			audit["side_effects"] = side
		}
		s.writeAudit(admin.OrgID, admin.ID, "user.delete", "user", target.ID, audit)
		deleted = append(deleted, map[string]any{
			"id":        target.ID,
			"username":  target.Username,
			"agent_ids": agentIDs,
			"purged":    true,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"deleted": deleted,
		"failed":  failed,
	})
}

func (s *Server) handleAdminListUserMachines(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("id")
	target, err := s.db.GetUserByID(userID)
	if err != nil || target.OrgID != admin.OrgID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
		return
	}
	list, err := s.db.ListMachines(userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []db.Machine{}
	}
	s.markConnected(userID, list)
	writeJSON(w, http.StatusOK, map[string]any{
		"machines": list,
		"user_id":  userID,
		"username": target.Username,
	})
}

func (s *Server) handleAdminDeleteUserMachine(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	userID := r.PathValue("id")
	machineID := r.PathValue("machineId")
	target, err := s.db.GetUserByID(userID)
	if err != nil || target.OrgID != admin.OrgID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
		return
	}
	if err := s.db.DeleteMachine(userID, machineID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "设备不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeAudit(admin.OrgID, admin.ID, "user.machine_delete", "user", userID, map[string]any{
		"machine_id": machineID,
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// purgeThenSoftDeleteUser clears business data the same way as purge-data while
// the account is still live, then soft-deletes the users row (and any remaining
// agents). Fail closed: if PurgeUserData fails, SoftDeleteUser is not called.
// Side effects (runtime home, uploads, mem0, Langfuse) are best-effort and share
// purgeUserSideEffects with the purge-data handler.
func (s *Server) purgeThenSoftDeleteUser(r *http.Request, userID string) (agentIDs []string, purge *db.UserDataPurgeResult, side map[string]any, err error) {
	s.abortUserTasks(userID)

	purge, err = s.db.PurgeUserData(userID)
	if err != nil {
		return nil, nil, nil, err
	}

	side = s.purgeUserSideEffects(r, userID)

	_, err = s.db.SoftDeleteUser(userID)
	if err != nil {
		// Business data already wiped; surface soft-delete failure so caller can retry.
		return purge.AgentIDs, purge, side, err
	}
	// SoftDeleteUser soft-deletes agents if any remain; after hard purge the list is empty.
	return purge.AgentIDs, purge, side, nil
}

const purgeDataConfirmToken = "purge-data"

type adminPurgeUserDataBody struct {
	Confirm string `json:"confirm"`
}

func (s *Server) handleAdminPurgeUserData(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.loadAuthUser(w, r)
	if !ok {
		return
	}
	var body adminPurgeUserDataBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.Confirm) != purgeDataConfirmToken {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": `请在 body 中传 {"confirm":"purge-data"} 确认危险操作`,
		})
		return
	}

	userID := r.PathValue("id")
	target, err := s.db.GetUserByID(userID)
	if err != nil || target.OrgID != admin.OrgID {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
		return
	}
	if strings.EqualFold(target.Username, db.A2ASystemUsername) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "不可清理系统用户"})
		return
	}

	s.abortUserTasks(target.ID)

	result, err := s.db.PurgeUserData(target.ID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "用户不存在"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	side := s.purgeUserSideEffects(r, target.ID)

	s.writeAudit(admin.OrgID, admin.ID, "user.purge_data", "user", target.ID, map[string]any{
		"username":     target.Username,
		"role":         target.Role,
		"agent_ids":    result.AgentIDs,
		"counts":       result.Counts,
		"side_effects": side,
		"kept":         []string{"users.row", "password_hash", "role", "org_id", "email", "casdoor_sub", "audit_logs"},
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"user_id":      target.ID,
		"username":     target.Username,
		"agent_ids":    result.AgentIDs,
		"counts":       result.Counts,
		"side_effects": side,
		"purged": []string{
			"conversations/messages", "conversation_tasks", "agents/bots", "agent_skills",
			"memories", "memory_recalls", "usage_runs", "routines/routine_runs",
			"channels/channel_members", "agent_messages", "user_machines", "user_settings",
			"bot_secrets", "bot_secret_requests", "mcp_servers", "sandboxes(row)",
			"inbound_hooks", "llm_connections", "user_skills", "user_skill_files",
			"user_skill_package_files", "a2a_tasks", "a2a_push_configs", "org_invites(created)",
			"attachments(uploads)", "运行环境(host data)", "mem0(best-effort)",
			"langfuse traces(best-effort)",
		},
		"kept": []string{
			"users 账号行", "password_hash", "role", "org_id", "email", "casdoor_sub", "created_at",
			"audit_logs（含本次 user.purge_data）",
		},
	})
}

func (s *Server) purgeUserSideEffects(r *http.Request, userID string) map[string]any {
	out := map[string]any{}

	// 运行环境：停掉容器并删除本机用户数据目录（含 checkpoints）。
	mgr := s.sandboxMgr()
	if err := mgr.PurgeUserHome(r.Context(), userID); err != nil {
		out["runtime_env"] = err.Error()
	} else {
		out["runtime_env"] = "purged"
	}

	uploadDir := filepath.Join(uploadsRoot(), db.SanitizeUserSegment(userID))
	if err := os.RemoveAll(uploadDir); err != nil {
		out["uploads"] = err.Error()
	} else {
		out["uploads"] = "purged"
	}

	skillsDir := db.UserSkillsDir(userID)
	if err := os.RemoveAll(skillsDir); err != nil {
		out["legacy_skills"] = err.Error()
	} else {
		out["legacy_skills"] = "purged"
	}

	out["mem0"] = s.purgeRuntimeMem0(r, userID)
	out["langfuse"] = s.purgeLangfuseUserTraces(r.Context(), userID)
	return out
}

func (s *Server) purgeRuntimeMem0(r *http.Request, userID string) string {
	if strings.TrimSpace(s.runtimeURL) == "" {
		return "skipped: no runtime"
	}
	payload, _ := json.Marshal(map[string]string{"user_id": userID})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, s.runtimeURL+"/v1/memories/purge", bytes.NewReader(payload))
	if err != nil {
		return err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "runtime unreachable: " + err.Error()
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 300 {
		return fmt.Sprintf("status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return "purged"
}
