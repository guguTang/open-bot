package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

type machineRegisterBody struct {
	MachineKey string `json:"machine_key"`
	Label      string `json:"label"`
	Platform   string `json:"platform"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	App        string `json:"app"`
	AppVersion string `json:"app_version"`
	DeviceType string `json:"device_type"` // optional: desktop | mobile; inferred if empty
}

type internalListMachinesBody struct {
	UserID string `json:"user_id"`
}

func (s *Server) handleListMachines(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	list, err := s.db.ListMachines(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []db.Machine{}
	}
	s.markConnected(uid, list)
	writeJSON(w, http.StatusOK, map[string]any{"machines": list})
}

func (s *Server) handleRegisterMachine(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	var body machineRegisterBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(body.MachineKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "machine_key required"})
		return
	}
	m, err := s.db.RegisterMachine(uid, db.MachineRegisterInput{
		MachineKey: body.MachineKey,
		Label:      body.Label,
		Platform:   body.Platform,
		OS:         body.OS,
		Arch:       body.Arch,
		App:        body.App,
		AppVersion: body.AppVersion,
		DeviceType: body.DeviceType,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.publishAgentsOnlineForMachine(uid, m.ID)
	writeJSON(w, http.StatusOK, map[string]any{"machine": m})
}

func (s *Server) handleHeartbeatMachine(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	m, err := s.db.HeartbeatMachine(uid, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "machine not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.publishAgentsOnlineForMachine(uid, m.ID)
	writeJSON(w, http.StatusOK, map[string]any{"machine": m})
}

func (s *Server) handleDeleteMachine(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	// Capture bindings before DeleteMachine clears machine_id.
	bound, _ := s.db.ListAgentsByMachineID(uid, id)
	if err := s.db.DeleteMachine(uid, id); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "machine not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for _, a := range bound {
		if a == nil {
			continue
		}
		a.MachineID = ""
		s.publishAgentOnlineIfChanged(uid, a)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePatchMachine(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	id := r.PathValue("id")
	var body struct {
		Label      *string `json:"label"`
		ExecPolicy *string `json:"exec_policy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if body.Label == nil && body.ExecPolicy == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "label or exec_policy required"})
		return
	}
	m, err := s.db.UpdateMachine(uid, id, body.Label, body.ExecPolicy)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "machine not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"machine": m})
}

func (s *Server) handleInternalListMachines(w http.ResponseWriter, r *http.Request) {
	var body internalListMachinesBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id required"})
		return
	}
	list, err := s.db.ListMachines(uid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []db.Machine{}
	}
	s.markConnected(uid, list)
	slim := make([]map[string]any, 0, len(list))
	for _, m := range list {
		slim = append(slim, map[string]any{
			"id":            m.ID,
			"label":         m.Label,
			"platform":      m.Platform,
			"os":            m.OS,
			"arch":          m.Arch,
			"app":           m.App,
			"status":        m.Status,
			"last_seen":     db.FormatTime(m.LastSeen),
			"online":        m.Connected,
			"connected":     m.Connected,
			"file_op_count": m.FileOpCount,
			"exec_policy":   db.NormalizeMachineExecPolicy(m.ExecPolicy),
			"device_type":   m.DeviceType,
			"host_eligible": m.HostEligible,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"machines": slim, "count": len(slim)})
}

func (s *Server) markConnected(userID string, list []db.Machine) {
	if s.hosts == nil {
		return
	}
	for i := range list {
		list[i].Connected = s.hosts.Connected(userID, list[i].ID)
	}
}

func (s *Server) handleHostExecWS(w http.ResponseWriter, r *http.Request) {
	tok := jwtFromRequest(r)
	claims, err := auth.ParseToken(tok)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	id := r.PathValue("id")
	m, err := s.db.GetMachine(claims.UserID, id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "machine not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !db.IsHostEligible(*m) {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "mobile devices cannot host exec; phones are login-only",
		})
		return
	}
	conn, err := busUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("host exec ws upgrade: %v", err)
		return
	}
	if _, err := s.db.HeartbeatMachine(claims.UserID, m.ID); err != nil {
		log.Printf("host exec heartbeat: %v", err)
	}
	s.hosts.serve(claims.UserID, m.ID, conn)
	// serve returns on disconnect; onChange already fired, but refresh last_seen window seed.
	s.publishAgentsOnlineForMachine(claims.UserID, m.ID)
}

func supportedHostOp(op string) bool {
	switch op {
	case "ls", "read", "write", "delete", "move", "open", "shell", "screenshot",
		"ssh_ls", "ssh_read", "ssh_write", "ssh_delete", "ssh_exec":
		return true
	default:
		return false
	}
}

func hostExecAllowsEmptyPath(op string) bool {
	switch op {
	case "ls", "ssh_ls", "screenshot":
		return true
	default:
		return false
	}
}

func hostActivityLabel(label, op, path, dest string) string {
	action := "处理文件"
	switch op {
	case "ls":
		action = "列出目录"
	case "read":
		action = "读取文件"
	case "write":
		action = "写入文件"
	case "delete":
		action = "删除文件"
	case "move":
		action = "移动文件"
	case "open":
		action = "打开软件"
	case "screenshot":
		action = "截取屏幕"
	case "shell":
		action = "运行命令"
	case "ssh_ls":
		action = "列出远程目录"
	case "ssh_read":
		action = "读取远程文件"
	case "ssh_write":
		action = "写入远程文件"
	case "ssh_delete":
		action = "删除远程文件"
	case "ssh_exec":
		action = "在远程主机上运行命令"
	}
	msg := "正在" + label + "上" + action
	if op == "screenshot" {
		what := "主屏幕"
		switch strings.TrimSpace(path) {
		case "all":
			what = "全部屏幕"
		case "", "main":
			what = "主屏幕"
		default:
			what = path
		}
		if strings.TrimSpace(dest) != "" {
			what = "显示器 " + strings.TrimSpace(dest)
		}
		return msg + "：" + what
	}
	if path == "" {
		return msg
	}
	if op == "move" && dest != "" {
		return msg + "：" + path + " → " + dest
	}
	return msg + "：" + path
}

func hostActivityText(label, op, path, dest string, needsConfirm bool) string {
	msg := hostActivityLabel(label, op, path, dest)
	if needsConfirm {
		msg += "。若需要确认，在对话里点允许或拒绝"
	}
	return msg
}

func (s *Server) handleInternalHostExec(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string `json:"user_id"`
		MachineID      string `json:"machine_id"`
		ConversationID string `json:"conversation_id"`
		Op             string `json:"op"`
		Path           string `json:"path"`
		Dest           string `json:"dest"`
		Content        string `json:"content"`
		SSHHost        string `json:"ssh_host"`
		SSHUser        string `json:"ssh_user"`
		SSHPort        int    `json:"ssh_port"`
		Limit          int    `json:"limit"`
		Sort           string `json:"sort"`
		Glob           string `json:"glob"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	uid := strings.TrimSpace(body.UserID)
	mid := strings.TrimSpace(body.MachineID)
	op := strings.TrimSpace(body.Op)
	if uid == "" || mid == "" || op == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id, machine_id and op required"})
		return
	}
	if !supportedHostOp(op) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported op"})
		return
	}
	sshHost := strings.TrimSpace(body.SSHHost)
	sshUser := strings.TrimSpace(body.SSHUser)
	if strings.HasPrefix(op, "ssh_") {
		if sshHost == "" || len(sshHost) > 253 || len(sshUser) > 64 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ssh host required"})
			return
		}
		if body.SSHPort < 0 || body.SSHPort > 65535 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ssh port invalid"})
			return
		}
	}
	if !hostExecAllowsEmptyPath(op) && strings.TrimSpace(body.Path) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path required"})
		return
	}
	if (op == "shell" || op == "ssh_exec") && len(body.Path) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "command too long"})
		return
	}
	if op == "open" && len(strings.TrimSpace(body.Path)) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "app name too long"})
		return
	}
	if len(body.Content) > 1<<20 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "content too large"})
		return
	}
	m, err := s.db.GetMachine(uid, mid)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "没有这台已登记的电脑"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !db.IsHostEligible(*m) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "mobile devices cannot run host exec",
			"machine_id": mid, "device_type": m.DeviceType,
		})
		return
	}
	if !s.hosts.Connected(uid, mid) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         false,
			"connected":  false,
			"machine_id": mid,
			"label":      m.Label,
			"error":      "「" + m.Label + "」的应用没开着，请先在那台电脑上打开",
		})
		return
	}

	conversationID := strings.TrimSpace(body.ConversationID)
	preconfirmed := false
	confirmReqID := ""
	policy := db.NormalizeMachineExecPolicy(m.ExecPolicy)
	if policy == db.MachineExecDeny {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "denied": true, "exec_policy": "deny",
			"error":      "「" + m.Label + "」已设置为不允许在这台电脑上执行",
			"machine_id": mid, "label": m.Label,
		})
		return
	}
	settings := s.userSettingsOrDefault(uid)
	// allow + Auto-review on: no confirm card (hard deny still deny; 先询问 still confirms).
	// ask forces confirm. deny already returned above.
	rev := classifyHostExecReviewForMachine(op, body.Path, body.Dest, settings, policy)
	// Always-allow list: auto-skip confirm when matched (hard deny + exec_policy=ask still win).
	rev = applyUserToolAllowlist(rev, s.toolAllowlistOrEmpty(uid), op, policy, "")
	if rev.Tier == hostExecReviewDeny {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": false, "denied": true, "auto_review": "deny",
			"error": rev.Reason, "review_code": rev.Code,
			"machine_id": mid, "label": m.Label,
		})
		return
	}
	if rev.Tier == hostExecReviewConfirm && conversationID != "" {
		preview := ""
		if op == "shell" || op == "ssh_exec" || op == "write" || op == "ssh_write" {
			preview = body.Content
			if preview == "" && (op == "shell" || op == "ssh_exec") {
				preview = body.Path
			}
		}
		allowed, reqID, cerr := s.requestChatHostConfirm(
			r.Context(), uid, conversationID, op, body.Path, body.Dest, preview, rev,
		)
		confirmReqID = reqID
		if cerr != nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": false, "denied": true, "error": cerr.Error(),
				"req_id": reqID, "machine_id": mid, "label": m.Label,
			})
			return
		}
		if !allowed {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": false, "denied": true, "error": "用户拒绝了这次操作",
				"req_id": reqID, "machine_id": mid, "label": m.Label,
			})
			return
		}
		preconfirmed = true
	}

	if s.events != nil {
		s.events.Publish(uid, map[string]any{
			"type":       "host_activity",
			"active":     true,
			"machine_id": mid,
			"label":      hostActivityText(m.Label, op, body.Path, body.Dest, rev.Tier == hostExecReviewConfirm),
		})
	}
	result, err := s.hosts.Call(r.Context(), uid, mid, hostExecRequest{
		Op: op, Path: body.Path, Dest: body.Dest, Content: body.Content,
		ConversationID: conversationID,
		SSHHost:        sshHost,
		SSHUser:        sshUser,
		SSHPort:        body.SSHPort,
		Limit:          body.Limit,
		Sort:           strings.TrimSpace(body.Sort),
		Glob:           strings.TrimSpace(body.Glob),
		Preconfirmed:   preconfirmed,
	})
	if s.events != nil {
		s.events.Publish(uid, map[string]any{
			"type":       "host_activity",
			"active":     false,
			"machine_id": mid,
		})
	}
	if result == nil {
		result = map[string]any{}
	}
	if confirmReqID != "" {
		result["req_id"] = confirmReqID
		if preconfirmed {
			result["confirmed"] = true
		}
	}
	s.finishHostConfirm(uid, conversationID, result)
	if err != nil {
		if errors.Is(err, errHostNotConnected) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok": false, "connected": false, "machine_id": mid, "label": m.Label,
				"error": "「" + m.Label + "」的应用没开着，请先在那台电脑上打开",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "machine_id": mid})
		return
	}
	if ok, _ := result["ok"].(bool); ok {
		if _, incErr := s.db.IncrementMachineFileOps(uid, mid); incErr != nil {
			log.Printf("increment file ops: %v", incErr)
		}
		if usual, uErr := s.db.UsualWorkMachine(uid); uErr == nil && usual != nil {
			result["usual"] = map[string]any{
				"id":            usual.ID,
				"label":         usual.Label,
				"platform":      usual.Platform,
				"file_op_count": usual.FileOpCount,
			}
		}
	}
	result["machine_id"] = mid
	result["label"] = m.Label
	writeJSON(w, http.StatusOK, result)
}

type hostConfirmPayload struct {
	ReqID      string `json:"req_id"`
	Op         string `json:"op"`
	Path       string `json:"path"`
	Dest       string `json:"dest,omitempty"`
	Preview    string `json:"preview,omitempty"`
	Status     string `json:"status"`
	Reason     string `json:"reason,omitempty"`      // Auto-review why confirm
	ReviewTier string `json:"review_tier,omitempty"` // always "confirm" when card shown
}

// hostConfirmGate parks dangerous host ops until the chat UI allows/denies.
// Multiple waiters may share one reqID when parallel deletes are coalesced.
type hostConfirmGate struct {
	mu   sync.Mutex
	wait map[string][]chan bool
}

func newHostConfirmGate() *hostConfirmGate {
	return &hostConfirmGate{wait: map[string][]chan bool{}}
}

func hostConfirmKey(conversationID, reqID string) string {
	return conversationID + "\n" + reqID
}

func isDeleteConfirmOp(op string) bool {
	return op == "delete" || op == "ssh_delete"
}

func mergeHostPaths(existing, add string) string {
	seen := map[string]struct{}{}
	var out []string
	for _, chunk := range []string{existing, add} {
		for _, line := range strings.Split(chunk, "\n") {
			p := strings.TrimSpace(line)
			if p == "" {
				continue
			}
			if _, ok := seen[p]; ok {
				continue
			}
			seen[p] = struct{}{}
			out = append(out, p)
		}
	}
	return strings.Join(out, "\n")
}

func (g *hostConfirmGate) register(conversationID, reqID string) chan bool {
	ch := make(chan bool, 1)
	g.mu.Lock()
	if g.wait == nil {
		g.wait = map[string][]chan bool{}
	}
	key := hostConfirmKey(conversationID, reqID)
	g.wait[key] = append(g.wait[key], ch)
	g.mu.Unlock()
	return ch
}

func (g *hostConfirmGate) resolve(conversationID, reqID string, allowed bool) {
	if g == nil {
		return
	}
	key := hostConfirmKey(conversationID, reqID)
	g.mu.Lock()
	list := g.wait[key]
	delete(g.wait, key)
	g.mu.Unlock()
	for _, ch := range list {
		select {
		case ch <- allowed:
		default:
		}
	}
}

func (g *hostConfirmGate) cancel(conversationID, reqID string) {
	g.resolve(conversationID, reqID, false)
}

func (s *Server) waitHostConfirm(
	ctx context.Context,
	userID, conversationID, reqID string,
	ch <-chan bool,
) (allowed bool, err error) {
	timer := time.NewTimer(hostConfirmTimeout)
	defer timer.Stop()
	select {
	case allowed = <-ch:
		return allowed, nil
	case <-ctx.Done():
		s.confirms.cancel(conversationID, reqID)
		_ = s.markHostConfirmStatus(userID, conversationID, reqID, "denied")
		return false, ctx.Err()
	case <-timer.C:
		s.confirms.cancel(conversationID, reqID)
		_ = s.markHostConfirmStatus(userID, conversationID, reqID, "denied")
		return false, errors.New("等待确认超时")
	}
}

func (s *Server) requestChatHostConfirm(
	ctx context.Context,
	userID, conversationID, op, path, dest, preview string,
	rev hostExecReview,
) (allowed bool, reqID string, err error) {
	coalesce := isDeleteConfirmOp(op)
	if coalesce {
		s.deleteConfirmMu.Lock()
	}

	if coalesce {
		if msgs, mErr := s.db.RecentHostConfirms(conversationID); mErr == nil {
			for i := range msgs {
				var existing hostConfirmPayload
				if json.Unmarshal([]byte(msgs[i].Content), &existing) != nil {
					continue
				}
				if existing.Status != "pending" || existing.Op != op {
					continue
				}
				if op == "ssh_delete" && strings.TrimSpace(existing.Dest) != strings.TrimSpace(dest) {
					continue
				}
				merged := mergeHostPaths(existing.Path, path)
				if merged != existing.Path {
					existing.Path = merged
					if raw, mErr := json.Marshal(existing); mErr == nil {
						if updated, uErr := s.db.UpdateMessageContent(conversationID, msgs[i].ID, string(raw)); uErr == nil {
							s.publishConversationMessage(userID, updated)
						}
					}
				}
				reqID = existing.ReqID
				ch := s.confirms.register(conversationID, reqID)
				s.deleteConfirmMu.Unlock()
				allowed, err = s.waitHostConfirm(ctx, userID, conversationID, reqID, ch)
				return allowed, reqID, err
			}
		}
	}

	reqID = uuid.NewString()
	previewLimit := 180
	if op == "email_send" {
		previewLimit = 1200
	}
	payload := hostConfirmPayload{
		ReqID:      reqID,
		Op:         op,
		Path:       path,
		Dest:       dest,
		Preview:    clipRunes(preview, previewLimit),
		Status:     "pending",
		Reason:     rev.Reason,
		ReviewTier: string(rev.Tier),
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		if coalesce {
			s.deleteConfirmMu.Unlock()
		}
		return false, reqID, err
	}
	msg, err := s.db.AddMessage(conversationID, "host_confirm", string(raw))
	if err != nil {
		if coalesce {
			s.deleteConfirmMu.Unlock()
		}
		return false, reqID, err
	}
	s.publishConversationMessage(userID, msg)
	ch := s.confirms.register(conversationID, reqID)
	if coalesce {
		s.deleteConfirmMu.Unlock()
	}
	allowed, err = s.waitHostConfirm(ctx, userID, conversationID, reqID, ch)
	return allowed, reqID, err
}

func (s *Server) markHostConfirmStatus(userID, conversationID, reqID, status string) error {
	msg, err := s.db.RecentHostConfirms(conversationID)
	if err != nil {
		return err
	}
	for i := range msg {
		var payload hostConfirmPayload
		if json.Unmarshal([]byte(msg[i].Content), &payload) != nil || payload.ReqID != reqID {
			continue
		}
		if payload.Status == status {
			return nil
		}
		payload.Status = status
		raw, mErr := json.Marshal(payload)
		if mErr != nil {
			return mErr
		}
		updated, uErr := s.db.UpdateMessageContent(conversationID, msg[i].ID, string(raw))
		if uErr != nil {
			return uErr
		}
		s.publishConversationMessage(userID, updated)
		return nil
	}
	return nil
}

func hostConfirmStatus(result map[string]any) string {
	if result == nil {
		return "denied"
	}
	if denied, _ := result["denied"].(bool); denied {
		return "denied"
	}
	if ok, _ := result["ok"].(bool); ok {
		return "allowed"
	}
	if confirmed, _ := result["confirmed"].(bool); confirmed {
		return "allowed"
	}
	return "denied"
}

func clipRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func (s *Server) finishHostConfirm(userID, conversationID string, result map[string]any) {
	if s == nil || conversationID == "" || result == nil {
		return
	}
	reqID, _ := result["req_id"].(string)
	reqID = strings.TrimSpace(reqID)
	if reqID == "" {
		return
	}
	msg, err := s.db.RecentHostConfirms(conversationID)
	if err != nil {
		log.Printf("host confirm lookup: %v", err)
		return
	}
	status := hostConfirmStatus(result)
	for i := range msg {
		var payload hostConfirmPayload
		if json.Unmarshal([]byte(msg[i].Content), &payload) != nil || payload.ReqID != reqID {
			continue
		}
		if payload.Status == status {
			return
		}
		payload.Status = status
		raw, mErr := json.Marshal(payload)
		if mErr != nil {
			return
		}
		updated, uErr := s.db.UpdateMessageContent(conversationID, msg[i].ID, string(raw))
		if uErr != nil {
			log.Printf("host confirm update: %v", uErr)
			return
		}
		s.publishConversationMessage(userID, updated)
		return
	}
}

func (s *Server) handleCreateHostConfirm(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	conversationID := r.PathValue("id")
	if _, err := s.db.GetConversation(uid, conversationID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body hostConfirmPayload
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	body.ReqID = strings.TrimSpace(body.ReqID)
	body.Op = strings.TrimSpace(body.Op)
	body.Path = strings.TrimSpace(body.Path)
	body.Dest = strings.TrimSpace(body.Dest)
	body.Preview = clipRunes(body.Preview, 180)
	body.Status = "pending"
	if body.Reason == "" || body.ReviewTier == "" {
		rev := classifyHostExecReview(body.Op, body.Path, body.Dest)
		if body.Reason == "" {
			body.Reason = rev.Reason
		}
		if body.ReviewTier == "" {
			body.ReviewTier = string(rev.Tier)
		}
	}
	if body.ReqID == "" || body.Path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "req_id and path required"})
		return
	}
	if !hostOpNeedsConfirm(body.Op) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported op"})
		return
	}
	existing, err := s.db.RecentHostConfirms(conversationID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for i := range existing {
		var payload hostConfirmPayload
		if json.Unmarshal([]byte(existing[i].Content), &payload) == nil && payload.ReqID == body.ReqID {
			writeJSON(w, http.StatusOK, existing[i])
			return
		}
	}
	raw, err := json.Marshal(body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	msg, err := s.db.AddMessage(conversationID, "host_confirm", string(raw))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.publishConversationMessage(uid, msg)
	writeJSON(w, http.StatusOK, msg)
}

func (s *Server) handleDecideHostConfirm(w http.ResponseWriter, r *http.Request) {
	uid := userIDFrom(r.Context())
	conversationID := r.PathValue("id")
	messageID := r.PathValue("msgId")
	if _, err := s.db.GetConversation(uid, conversationID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "conversation not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var body struct {
		Status   string       `json:"status"`   // legacy: allowed | denied
		Decision string       `json:"decision"` // allow_once | always_allow | deny
		Approve  *bool        `json:"approve"`  // legacy bool (maps like /approve)
		Scope    ApproveScope `json:"scope"`
		Reason   string       `json:"reason"`
		AgentID  string       `json:"agent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	decision, status, derr := ResolveHostConfirmDecision(body.Status, body.Decision, body.Approve)
	if derr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": derr.Error()})
		return
	}
	found, err := s.db.RecentHostConfirms(conversationID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for i := range found {
		if found[i].ID != messageID {
			continue
		}
		var payload hostConfirmPayload
		if err := json.Unmarshal([]byte(found[i].Content), &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid confirm payload"})
			return
		}
		if payload.Status == status || (payload.Status != "" && payload.Status != "pending") {
			writeJSON(w, http.StatusOK, found[i])
			return
		}
		var allowEntry any
		if decision == DecisionAlwaysAllow {
			if strings.EqualFold(payload.Op, "email_send") {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "email_send 不支持始终允许（不擅自代发）",
				})
				return
			}
			scope := InferScopeFromHostConfirm(payload.Op, body.Scope)
			if scope.ToolGroup == "" && scope.Tool == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "scope.tool or scope.tool_group required for always_allow (or host-confirm op to infer)",
				})
				return
			}
			entry, uerr := s.db.UpsertUserToolAllowlist(uid, scope.ToolGroup, scope.Tool, strings.TrimSpace(body.AgentID))
			if uerr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": uerr.Error()})
				return
			}
			allowEntry = entry
		}
		if strings.TrimSpace(body.Reason) != "" && strings.TrimSpace(payload.Reason) == "" {
			payload.Reason = strings.TrimSpace(body.Reason)
		}
		payload.Status = status
		raw, mErr := json.Marshal(payload)
		if mErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": mErr.Error()})
			return
		}
		updated, uErr := s.db.UpdateMessageContent(conversationID, messageID, string(raw))
		if uErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": uErr.Error()})
			return
		}
		s.publishConversationMessage(uid, updated)
		if s.confirms != nil {
			s.confirms.resolve(conversationID, payload.ReqID, status == "allowed")
		}
		// Keep Message JSON shape; add decision / allowlist for three-state clients.
		rawMsg, _ := json.Marshal(updated)
		out := map[string]any{}
		_ = json.Unmarshal(rawMsg, &out)
		out["decision"] = decision
		out["status"] = status
		if allowEntry != nil {
			out["allowlist_entry"] = allowEntry
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "confirm not found"})
}
