package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
	"github.com/tangxin/open-bot/services/api/internal/sandbox"
)

func (s *Server) sandboxMgr() *sandbox.Manager {
	if s.sbx == nil {
		s.sbx = sandbox.NewManager(sandbox.LoadConfig())
	}
	return s.sbx
}

func sandboxPublic(row *db.Sandbox) map[string]any {
	if row == nil {
		return nil
	}
	return map[string]any{
		"id":              row.ID,
		"user_id":         row.UserID,
		"container_id":    row.ContainerID,
		"status":          row.Status,
		"image":           row.Image,
		"workdir_host":    row.WorkdirHost,
		"computer_mode":   row.ComputerMode,
		"desktop_port":    row.DesktopPort,
		"desktop_token":   row.DesktopToken,
		"checkpoint_path": row.CheckpointPath,
		"created_at":      row.CreatedAt,
		"updated_at":      row.UpdatedAt,
		"last_error":      row.LastError,
	}
}

func writeSandboxDockerErr(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sandbox.ErrDockerUnavailable) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return true
	}
	if errors.Is(err, sandbox.ErrNotRunning) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "sandbox not running; call POST /v1/sandbox/ensure first"})
		return true
	}
	if errors.Is(err, sandbox.ErrEmptyCmd) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cmd required"})
		return true
	}
	if errors.Is(err, sandbox.ErrPathEscape) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path must stay under /workspace (no ..)"})
		return true
	}
	return false
}

func (s *Server) resolveComputerMode(uid, agentID, override string) sandbox.ComputerMode {
	if o := strings.TrimSpace(override); o != "" {
		return sandbox.NormalizeMode(o)
	}
	if agentID != "" {
		if a, err := s.db.GetAgent(uid, agentID); err == nil && a.ComputerMode != "" {
			return sandbox.NormalizeMode(a.ComputerMode)
		}
	}
	if row, err := s.db.GetOrCreateSandbox(uid, s.sandboxMgr().Cfg.Image); err == nil && row.ComputerMode != "" {
		return sandbox.NormalizeMode(row.ComputerMode)
	}
	return sandbox.ModeTeam
}

func (s *Server) handleGetSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	mgr := s.sandboxMgr()
	row, err := s.db.GetOrCreateSandbox(uid, mgr.Cfg.Image)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	ensure := r.URL.Query().Get("ensure") == "1" || strings.EqualFold(r.URL.Query().Get("ensure"), "true")
	if ensure {
		s.doEnsureSandbox(w, r, uid, r.URL.Query().Get("agent_id"), r.URL.Query().Get("mode"),
			r.URL.Query().Get("desktop") == "1")
		return
	}
	writeJSON(w, http.StatusOK, sandboxPublic(row))
}

func (s *Server) handleEnsureSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
		Desktop bool   `json:"desktop"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	desktop := body.Desktop || r.URL.Query().Get("desktop") == "1"
	agentID := body.AgentID
	if agentID == "" {
		agentID = r.URL.Query().Get("agent_id")
	}
	mode := body.Mode
	if mode == "" {
		mode = r.URL.Query().Get("mode")
	}
	s.doEnsureSandbox(w, r, uid, agentID, mode, desktop)
}

func (s *Server) doEnsureSandbox(w http.ResponseWriter, r *http.Request, uid, agentID, modeOverride string, desktop bool) {
	row, inst, err := s.ensureSandboxInstance(r.Context(), uid, agentID, modeOverride, desktop)
	if err != nil {
		if desktop {
			msg := err.Error()
			hint := "请确认 Docker 已启动，并执行 make sandbox-image-desktop；或在 .env 配置可用的 SANDBOX_DESKTOP_IMAGE / SANDBOX_DESKTOP_PORT"
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": msg, "hint": hint})
			return
		}
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	out := sandboxPublic(row)
	out["agent_id"] = agentID
	if inst != nil {
		out["restored_from"] = inst.RestoredFrom
	}
	writeJSON(w, http.StatusOK, out)
}

// ensureSandboxInstance creates/starts the per-user runtime env and persists DB status.
func (s *Server) ensureSandboxInstance(ctx context.Context, uid, agentID, modeOverride string, desktop bool) (*db.Sandbox, *sandbox.Instance, error) {
	mgr := s.sandboxMgr()
	row, err := s.db.GetOrCreateSandbox(uid, mgr.Cfg.Image)
	if err != nil {
		return nil, nil, err
	}
	mode := s.resolveComputerMode(uid, agentID, modeOverride)
	row.Status = db.SandboxStatusCreating
	row.LastError = ""
	row.ComputerMode = string(mode)
	_ = s.db.UpdateSandbox(row)

	inst, err := mgr.Ensure(ctx, sandbox.EnsureRequest{
		UserID:  uid,
		AgentID: agentID,
		Mode:    mode,
		Desktop: desktop,
	})
	if err != nil {
		// Soft-fail docker: still persist layout paths when Instance partially returned
		if inst != nil {
			row.WorkdirHost = inst.WorkdirHost
			row.Image = inst.Image
			if inst.RestoredFrom != "" {
				row.CheckpointPath = inst.RestoredFrom
			}
			row.DesktopPort = inst.DesktopPort
			row.DesktopToken = inst.DesktopToken
		}
		row.Status = db.SandboxStatusError
		row.LastError = err.Error()
		_ = s.db.UpdateSandbox(row)
		return row, inst, err
	}
	row.ContainerID = inst.ContainerID
	row.WorkdirHost = inst.WorkdirHost
	row.Image = inst.Image
	row.ComputerMode = string(inst.Mode)
	row.DesktopPort = inst.DesktopPort
	row.DesktopToken = inst.DesktopToken
	if inst.RestoredFrom != "" {
		row.CheckpointPath = inst.RestoredFrom
	}
	row.Status = db.SandboxStatusRunning
	row.LastError = ""
	if err := s.db.UpdateSandbox(row); err != nil {
		return row, inst, err
	}
	return row, inst, nil
}

// provisionUserSandbox creates the default per-user runtime env after account creation.
// Runs in the background and never blocks signup; Docker failures are soft-failed into sandboxes.last_error.
func (s *Server) provisionUserSandbox(userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		_, _, _ = s.ensureSandboxInstance(ctx, userID, "", "", false)
	}()
}

func (s *Server) handleStopSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	mgr := s.sandboxMgr()
	row, err := s.db.GetOrCreateSandbox(uid, mgr.Cfg.Image)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if cp, e := mgr.Checkpoint(r.Context(), uid); e == nil && cp != "" {
		row.CheckpointPath = cp
	}
	if err := mgr.Stop(r.Context(), uid); err != nil {
		row.Status = db.SandboxStatusError
		row.LastError = err.Error()
		_ = s.db.UpdateSandbox(row)
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	row.Status = db.SandboxStatusStopped
	row.LastError = ""
	_ = s.db.UpdateSandbox(row)
	writeJSON(w, http.StatusOK, sandboxPublic(row))
}

func (s *Server) handleResetSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	mgr := s.sandboxMgr()
	row, err := s.db.GetOrCreateSandbox(uid, mgr.Cfg.Image)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body struct {
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	mode := s.resolveComputerMode(uid, body.AgentID, body.Mode)
	row.Status = db.SandboxStatusCreating
	row.LastError = ""
	_ = s.db.UpdateSandbox(row)

	inst, err := mgr.Reset(r.Context(), uid, body.AgentID, mode)
	if err != nil {
		if inst != nil {
			row.WorkdirHost = inst.WorkdirHost
		}
		row.Status = db.SandboxStatusError
		row.LastError = err.Error()
		_ = s.db.UpdateSandbox(row)
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	row.ContainerID = inst.ContainerID
	row.WorkdirHost = inst.WorkdirHost
	row.Image = inst.Image
	row.ComputerMode = string(inst.Mode)
	row.Status = db.SandboxStatusRunning
	row.LastError = ""
	_ = s.db.UpdateSandbox(row)
	writeJSON(w, http.StatusOK, map[string]any{
		"sandbox": sandboxPublic(row),
		"warning": "live workspace wiped (checkpoint kept) and container recreated",
	})
}

func (s *Server) handleCheckpointSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	mgr := s.sandboxMgr()
	row, err := s.db.GetOrCreateSandbox(uid, mgr.Cfg.Image)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	cp, err := mgr.Checkpoint(r.Context(), uid)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	row.CheckpointPath = cp
	_ = s.db.UpdateSandbox(row)
	writeJSON(w, http.StatusOK, map[string]any{"checkpoint_path": cp, "sandbox": sandboxPublic(row)})
}

func (s *Server) handleExecSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		Cmd        string `json:"cmd"`
		Workdir    string `json:"workdir"`
		TimeoutSec int    `json:"timeout_sec"`
		AgentID    string `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	res, err := s.sandboxMgr().Exec(r.Context(), uid, body.Cmd, body.Workdir, body.TimeoutSec)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) fileOpFrom(uid, agentID, mode, path string) sandbox.FileOp {
	return sandbox.FileOp{
		UserID:  uid,
		AgentID: agentID,
		Mode:    s.resolveComputerMode(uid, agentID, mode),
		Path:    path,
	}
}

func (s *Server) handleReadSandboxFile(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	path := r.URL.Query().Get("path")
	op := s.fileOpFrom(uid, r.URL.Query().Get("agent_id"), r.URL.Query().Get("mode"), path)
	content, err := s.sandboxMgr().ReadFile(op, sandbox.MaxExecOutputBytes)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "content": content})
}

func (s *Server) handleDownloadSandboxFile(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	path := r.URL.Query().Get("path")
	op := s.fileOpFrom(uid, r.URL.Query().Get("agent_id"), r.URL.Query().Get("mode"), path)
	f, st, err := s.sandboxMgr().OpenWorkspaceFile(op)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		msg := err.Error()
		if strings.Contains(msg, "file too large") {
			msg = "文件过大，无法下载"
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
		return
	}
	defer f.Close()

	name := downloadFileName(path)
	ctype := mime.TypeByExtension(filepath.Ext(name))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.Header().Set("Content-Disposition", contentDispositionAttachment(name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := io.Copy(w, f); err != nil {
		return
	}
}

func downloadFileName(path string) string {
	base := filepath.Base(strings.ReplaceAll(strings.TrimSpace(path), "\\", "/"))
	base = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' || r == '/' {
			return -1
		}
		return r
	}, base)
	if base == "" || base == "." || base == ".." {
		return "download"
	}
	return base
}

func contentDispositionAttachment(name string) string {
	ascii := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 126 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	if strings.Trim(ascii, "._ ") == "" {
		ascii = "download"
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, ascii, url.PathEscape(name))
}

func (s *Server) handleWriteSandboxFile(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.Path) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path required"})
		return
	}
	op := s.fileOpFrom(uid, body.AgentID, body.Mode, body.Path)
	if err := s.sandboxMgr().WriteFile(op, body.Content); err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	actualPath := body.Path
	if remapped, err := sandbox.RemapWritePath(body.Path, body.AgentID, op.Mode); err == nil {
		actualPath = remapped
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": actualPath, "agent_id": body.AgentID})
}

func (s *Server) handleListSandbox(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/workspace"
	}
	op := s.fileOpFrom(uid, r.URL.Query().Get("agent_id"), r.URL.Query().Get("mode"), path)
	entries, err := s.sandboxMgr().ListDir(op)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "entries": entries})
}

// handleSandboxDesktop JWT-proxies to the container noVNC (localhost only).
// Browser never sees the raw Docker-mapped port. Auth: Bearer or ?access_token=.
func (s *Server) handleSandboxDesktop(w http.ResponseWriter, r *http.Request) {
	mgr := s.sandboxMgr()
	uid := userIDFrom(r.Context())
	row, err := s.db.GetOrCreateSandbox(uid, mgr.Cfg.Image)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if row == nil || row.Status != db.SandboxStatusRunning || row.DesktopPort <= 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "沙箱桌面未就绪",
			"hint":  "请先在设置→沙箱电脑点击「打开桌面」，或 POST /v1/sandbox/ensure 且 desktop=1；并确保已 make sandbox-image-desktop",
		})
		return
	}
	// Optional extra gate: desktop_token query must match when provided by UI.
	if want := strings.TrimSpace(row.DesktopToken); want != "" {
		got := strings.TrimSpace(r.URL.Query().Get("desktop_token"))
		// Allow JWT-only access (iframe with access_token); desktop_token is optional hardening.
		if got != "" && got != want {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "桌面令牌无效"})
			return
		}
	}
	// Persist JWT into cookie so noVNC subresource / websocket requests stay authenticated
	// without needing Authorization on every asset fetch.
	if at := strings.TrimSpace(r.URL.Query().Get("access_token")); at != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "openbot_token",
			Value:    at,
			Path:     "/v1/sandbox/desktop",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   86400,
		})
	}

	prefix := "/v1/sandbox/desktop"
	path := r.URL.Path
	if path == prefix {
		q := r.URL.Query()
		q.Del("token") // keep access_token for subsequent relative asset loads? strip secrets from redirect target
		// Landing: noVNC vnc.html with autoconnect
		target := prefix + "/vnc.html?autoconnect=1&resize=remote&path=" + url.QueryEscape("v1/sandbox/desktop/websockify")
		if at := strings.TrimSpace(r.URL.Query().Get("access_token")); at != "" {
			target += "&access_token=" + url.QueryEscape(at)
		}
		if dt := strings.TrimSpace(row.DesktopToken); dt != "" {
			target += "&desktop_token=" + url.QueryEscape(dt)
		}
		http.Redirect(w, r, target, http.StatusFound)
		return
	}
	if !strings.HasPrefix(path, prefix+"/") && path != prefix+"/" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	suffix := strings.TrimPrefix(path, prefix)
	if suffix == "" || suffix == "/" {
		http.Redirect(w, r, prefix+"/vnc.html?autoconnect=1&resize=remote&path="+url.QueryEscape("v1/sandbox/desktop/websockify"), http.StatusFound)
		return
	}

	targetURL, err := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", row.DesktopPort))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid desktop upstream"})
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(targetURL)
	proxy.FlushInterval = 100 * time.Millisecond
	proxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, e error) {
		writeJSON(rw, http.StatusBadGateway, map[string]string{
			"error": "桌面代理失败: " + e.Error(),
			"hint":  "容器可能已退出，请重新「打开桌面」",
		})
	}
	origDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		origDirector(req)
		req.URL.Path = suffix
		req.URL.RawPath = ""
		req.Host = targetURL.Host
		// Drop hop auth headers toward noVNC
		req.Header.Del("Authorization")
	}
	// Rewrite Location etc. if needed — relative URLs under /v1/sandbox/desktop/ work for noVNC assets.
	proxy.ServeHTTP(w, r)
}

// --- Internal (runtime tools; X-Internal-Token + user_id in body/query) ---

func (s *Server) handleInternalSandboxEnsure(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID  string `json:"user_id"`
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
		Desktop bool   `json:"desktop"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	s.doEnsureSandbox(w, r, uid, body.AgentID, body.Mode, body.Desktop)
}

func (s *Server) handleInternalSandboxExec(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID     string `json:"user_id"`
		Cmd        string `json:"cmd"`
		Workdir    string `json:"workdir"`
		TimeoutSec int    `json:"timeout_sec"`
		AgentID    string `json:"agent_id"`
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
	res, err := s.sandboxMgr().Exec(r.Context(), uid, body.Cmd, body.Workdir, body.TimeoutSec)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleInternalSandboxRead(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID  string `json:"user_id"`
		Path    string `json:"path"`
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
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
	op := s.fileOpFrom(uid, body.AgentID, body.Mode, body.Path)
	content, err := s.sandboxMgr().ReadFile(op, sandbox.MaxExecOutputBytes)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": body.Path, "content": content})
}

func (s *Server) handleInternalSandboxWrite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID  string `json:"user_id"`
		Path    string `json:"path"`
		Content string `json:"content"`
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	if uid == "" || strings.TrimSpace(body.Path) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and path required"})
		return
	}
	op := s.fileOpFrom(uid, body.AgentID, body.Mode, body.Path)
	if err := s.sandboxMgr().WriteFile(op, body.Content); err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	actualPath := body.Path
	if remapped, err := sandbox.RemapWritePath(body.Path, body.AgentID, op.Mode); err == nil {
		actualPath = remapped
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "path": actualPath, "agent_id": body.AgentID})
}

func (s *Server) handleInternalSandboxLS(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID  string `json:"user_id"`
		Path    string `json:"path"`
		AgentID string `json:"agent_id"`
		Mode    string `json:"mode"`
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
	path := body.Path
	if path == "" {
		path = "/workspace"
	}
	op := s.fileOpFrom(uid, body.AgentID, body.Mode, path)
	entries, err := s.sandboxMgr().ListDir(op)
	if err != nil {
		if writeSandboxDockerErr(w, err) {
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "entries": entries})
}
