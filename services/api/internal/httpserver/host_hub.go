package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Desktop host_shell kills the process group at 120s (HOST_SHELL_TIMEOUT_SECS).
// This wait must stay strictly above that so the desktop can return its own
// timeout error. Runtime HOST_EXEC_TIMEOUT_SEC (180s) must stay above this.
// Confirm cards use hostConfirmTimeout and are not stretched with the shell.
const hostExecTimeout = 150 * time.Second

// A person clicking Allow should not inherit the long shell budget.
const hostConfirmTimeout = 90 * time.Second

var errHostNotConnected = errors.New("machine exec socket is not connected")

type hostExecRequest struct {
	Op             string `json:"op"`
	Path           string `json:"path"`
	Dest           string `json:"dest,omitempty"`
	Content        string `json:"content,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
	SSHHost        string `json:"ssh_host,omitempty"`
	SSHUser        string `json:"ssh_user,omitempty"`
	SSHPort        int    `json:"ssh_port,omitempty"`
	// Optional ls filters (host_ls / ssh_ls shallow browse).
	Limit int    `json:"limit,omitempty"`
	Sort  string `json:"sort,omitempty"`
	Glob  string `json:"glob,omitempty"`
	// Structured desktop-control arguments (click/type/key/scroll/ax/…).
	Args json.RawMessage `json:"args,omitempty"`
	// Preconfirmed: chat UI already allowed this op; host client must execute without asking again.
	Preconfirmed bool `json:"preconfirmed,omitempty"`
}

type hostHub struct {
	mu       sync.Mutex
	sessions map[string]*hostSession
	// onChange fires after register/unregister (userID, machineID, connected).
	onChange func(userID, machineID string, connected bool)
}

type hostSession struct {
	userID    string
	machineID string
	conn      *websocket.Conn
	send      chan []byte
	mu        sync.Mutex
	pending   map[string]chan map[string]any
}

func newHostHub() *hostHub {
	return &hostHub{sessions: make(map[string]*hostSession)}
}

func hostKey(userID, machineID string) string {
	return userID + "\n" + machineID
}

func (h *hostHub) Connected(userID, machineID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.sessions[hostKey(userID, machineID)]
	return ok
}

type hostConnKey struct{ userID, machineID string }

// connectedKeys snapshots (userID, machineID) for every live exec socket.
func (h *hostHub) connectedKeys() []hostConnKey {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]hostConnKey, 0, len(h.sessions))
	for _, sess := range h.sessions {
		if sess == nil {
			continue
		}
		out = append(out, hostConnKey{userID: sess.userID, machineID: sess.machineID})
	}
	return out
}

func (h *hostHub) register(s *hostSession) {
	key := hostKey(s.userID, s.machineID)
	h.mu.Lock()
	old := h.sessions[key]
	h.sessions[key] = s
	cb := h.onChange
	h.mu.Unlock()
	if old != nil && old != s {
		_ = old.conn.Close()
	}
	if cb != nil {
		cb(s.userID, s.machineID, true)
	}
}

func (h *hostHub) unregister(s *hostSession) {
	key := hostKey(s.userID, s.machineID)
	h.mu.Lock()
	removed := false
	if cur := h.sessions[key]; cur == s {
		delete(h.sessions, key)
		removed = true
	}
	cb := h.onChange
	h.mu.Unlock()
	s.failPending("执行连接已断开")
	if removed && cb != nil {
		cb(s.userID, s.machineID, false)
	}
}

func (s *hostSession) failPending(msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, ch := range s.pending {
		select {
		case ch <- map[string]any{"ok": false, "error": msg, "req_id": id}:
		default:
		}
		delete(s.pending, id)
	}
}

func (h *hostHub) deliver(s *hostSession, reqID string, result map[string]any) {
	s.mu.Lock()
	ch := s.pending[reqID]
	delete(s.pending, reqID)
	s.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- result:
	default:
	}
}

func (h *hostHub) Call(ctx context.Context, userID, machineID string, req hostExecRequest) (map[string]any, error) {
	h.mu.Lock()
	s := h.sessions[hostKey(userID, machineID)]
	h.mu.Unlock()
	if s == nil {
		return nil, errHostNotConnected
	}
	reqID := uuid.NewString()
	ch := make(chan map[string]any, 1)
	s.mu.Lock()
	if s.pending == nil {
		s.pending = make(map[string]chan map[string]any)
	}
	s.pending[reqID] = ch
	s.mu.Unlock()
	wire := map[string]any{
		"type":            "exec",
		"req_id":          reqID,
		"op":              req.Op,
		"path":            req.Path,
		"dest":            req.Dest,
		"content":         req.Content,
		"conversation_id": req.ConversationID,
		"ssh_host":        req.SSHHost,
		"ssh_user":        req.SSHUser,
		"ssh_port":        req.SSHPort,
		"preconfirmed":    req.Preconfirmed,
	}
	if len(req.Args) > 0 && string(req.Args) != "null" {
		var parsed any
		if err := json.Unmarshal(req.Args, &parsed); err == nil {
			wire["args"] = parsed
		}
	}
	payload, err := json.Marshal(wire)
	if err != nil {
		s.mu.Lock()
		delete(s.pending, reqID)
		s.mu.Unlock()
		return nil, err
	}
	fail := func(cause error) (map[string]any, error) {
		return map[string]any{"req_id": reqID, "ok": false, "error": cause.Error()}, cause
	}
	select {
	case s.send <- payload:
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, reqID)
		s.mu.Unlock()
		return fail(ctx.Err())
	default:
		s.mu.Lock()
		delete(s.pending, reqID)
		s.mu.Unlock()
		return fail(errors.New("machine exec socket is busy"))
	}
	timer := time.NewTimer(hostExecTimeout)
	defer timer.Stop()
	select {
	case result := <-ch:
		if result == nil {
			result = map[string]any{}
		}
		result["req_id"] = reqID
		return result, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, reqID)
		s.mu.Unlock()
		return fail(ctx.Err())
	case <-timer.C:
		s.mu.Lock()
		delete(s.pending, reqID)
		s.mu.Unlock()
		return map[string]any{
			"req_id": reqID,
			"ok":     false,
			"error":  "目标电脑没有在时限内完成或确认这次操作",
		}, nil
	}
}

func (s *hostSession) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		_ = s.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-s.send:
			_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = s.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := s.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := s.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (s *hostSession) readPump(h *hostHub) {
	defer func() {
		h.unregister(s)
		_ = s.conn.Close()
	}()
	s.conn.SetReadLimit(8 << 20)
	_ = s.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	s.conn.SetPongHandler(func(string) error {
		_ = s.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		_, data, err := s.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = s.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg["type"] != "exec_result" {
			continue
		}
		reqID, _ := msg["req_id"].(string)
		if reqID == "" {
			continue
		}
		h.deliver(s, reqID, msg)
	}
}

func (h *hostHub) serve(userID, machineID string, conn *websocket.Conn) {
	s := &hostSession{
		userID:    userID,
		machineID: machineID,
		conn:      conn,
		send:      make(chan []byte, 8),
		pending:   make(map[string]chan map[string]any),
	}
	h.register(s)
	go s.writePump()
	s.readPump(h)
	log.Printf("host exec disconnected user=%s machine=%s", userID, machineID)
}
