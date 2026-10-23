package httpserver

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

const busWSSendBuffer = 16

var busUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		return isLocalDevOrigin(origin)
	},
}

type busHub struct {
	mu      sync.RWMutex
	clients map[string]map[*busClient]struct{}
}

type busClient struct {
	userID string
	hub    *busHub
	conn   *websocket.Conn
	send   chan []byte
}

func newBusHub() *busHub {
	return &busHub{clients: make(map[string]map[*busClient]struct{})}
}

func (h *busHub) register(c *busClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.clients[c.userID]
	if set == nil {
		set = make(map[*busClient]struct{})
		h.clients[c.userID] = set
	}
	set[c] = struct{}{}
}

func (h *busHub) unregister(c *busClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set, ok := h.clients[c.userID]
	if !ok {
		return
	}
	if _, exists := set[c]; !exists {
		return
	}
	delete(set, c)
	if len(set) == 0 {
		delete(h.clients, c.userID)
	}
	close(c.send)
}

func (h *busHub) Publish(userID string, msg *db.AgentBusMessage) {
	if h == nil || msg == nil || strings.TrimSpace(userID) == "" {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"type":    "agent_message",
		"message": msg,
	})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[userID] {
		select {
		case c.send <- payload:
		default:
			// slow client: drop rather than block deliver path
			log.Printf("agent-bus ws drop slow client user=%s", userID)
		}
	}
}

func (c *busClient) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *busClient) readPump() {
	defer func() {
		c.hub.unregister(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(4096)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func jwtFromRequest(r *http.Request) string {
	if t := auth.BearerToken(r.Header.Get("Authorization")); t != "" {
		return t
	}
	if t := strings.TrimSpace(r.URL.Query().Get("token")); t != "" {
		return t
	}
	return ""
}

func internalToken() string {
	if v := strings.TrimSpace(os.Getenv("INTERNAL_TOKEN")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("OPENBOT_INTERNAL_TOKEN")); v != "" {
		return v
	}
	return "open-bot-dev-internal"
}

func (s *Server) handleAgentBusWS(w http.ResponseWriter, r *http.Request) {
	tok := jwtFromRequest(r)
	claims, err := auth.ParseToken(tok)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	conn, err := busUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("agent-bus ws upgrade: %v", err)
		return
	}
	client := &busClient{
		userID: claims.UserID,
		hub:    s.hub,
		conn:   conn,
		send:   make(chan []byte, busWSSendBuffer),
	}
	s.hub.register(client)
	go client.writePump()
	go client.readPump()
}

// deliverAgentMessage inserts a bus message, pushes WS, and optionally wakes targets.
// conversationID pins the HandoffCard to the sender's live session when known.
func (s *Server) deliverAgentMessage(
	userID, fromAgentID string,
	toAgentID, channelID *string,
	priority bool,
	body string,
	replyToID *string,
	conversationID string,
) (*db.AgentBusMessage, error) {
	m, err := s.db.PostAgentMessage(userID, fromAgentID, toAgentID, channelID, priority, body, replyToID)
	if err != nil {
		return nil, err
	}
	if s.hub != nil {
		s.hub.Publish(userID, m)
	}
	if priority {
		s.schedulePriorityWake(userID, m)
	}
	// P1 projection: visible Bot↔Bot handoff → current session timeline (not model history).
	s.projectHandoffAfterBusWriteAt(userID, m, conversationID)
	return m, nil
}

func (s *Server) requireInternal(next http.HandlerFunc) http.HandlerFunc {
	want := internalToken()
	return func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimSpace(r.Header.Get("X-Internal-Token"))
		if got == "" {
			got = strings.TrimSpace(r.Header.Get("Authorization"))
			got = strings.TrimPrefix(got, "Bearer ")
			got = strings.TrimPrefix(got, "bearer ")
			got = strings.TrimSpace(got)
		}
		if want == "" || got != want {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (s *Server) handleInternalPostAgentBusMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID         string `json:"user_id"`
		FromAgentID    string `json:"from_agent_id"`
		ToAgentID      string `json:"to_agent_id"`
		ChannelID      string `json:"channel_id"`
		ConversationID string `json:"conversation_id"`
		Priority       bool   `json:"priority"`
		Body           string `json:"body"`
		ReplyToID      string `json:"reply_to_id"`
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
	var toPtr, chPtr, replyPtr *string
	if strings.TrimSpace(body.ToAgentID) != "" {
		v := strings.TrimSpace(body.ToAgentID)
		toPtr = &v
	}
	if strings.TrimSpace(body.ChannelID) != "" {
		v := strings.TrimSpace(body.ChannelID)
		chPtr = &v
	}
	if strings.TrimSpace(body.ReplyToID) != "" {
		v := strings.TrimSpace(body.ReplyToID)
		replyPtr = &v
	}
	from := strings.TrimSpace(body.FromAgentID)
	if from == "" {
		var ferr error
		from, ferr = s.db.FirstAgentID(uid)
		if ferr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": ferr.Error()})
			return
		}
	}
	m, err := s.deliverAgentMessage(uid, from, toPtr, chPtr, body.Priority, body.Body, replyPtr, body.ConversationID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, m)
}
