package httpserver

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/tangxin/open-bot/services/api/internal/auth"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

// chatHub fans events out to every connected client of one user (web, macOS, Android).
type chatHub struct {
	mu      sync.RWMutex
	clients map[string]map[*chatClient]struct{}
}

type chatClient struct {
	userID string
	hub    *chatHub
	conn   *websocket.Conn
	send   chan []byte
}

func newChatHub() *chatHub {
	return &chatHub{clients: make(map[string]map[*chatClient]struct{})}
}

func (h *chatHub) register(c *chatClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.clients[c.userID]
	if set == nil {
		set = make(map[*chatClient]struct{})
		h.clients[c.userID] = set
	}
	set[c] = struct{}{}
}

func (h *chatHub) unregister(c *chatClient) {
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

func (h *chatHub) Publish(userID string, payload any) {
	if h == nil || strings.TrimSpace(userID) == "" || payload == nil {
		return
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[userID] {
		select {
		case c.send <- raw:
		default:
			log.Printf("chat ws drop slow client user=%s", userID)
		}
	}
}

func (c *chatClient) writePump() {
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

func (c *chatClient) readPump() {
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

func (s *Server) handleChatEventsWS(w http.ResponseWriter, r *http.Request) {
	tok := jwtFromRequest(r)
	claims, err := auth.ParseToken(tok)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	conn, err := busUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("chat ws upgrade: %v", err)
		return
	}
	client := &chatClient{
		userID: claims.UserID,
		hub:    s.events,
		conn:   conn,
		send:   make(chan []byte, busWSSendBuffer),
	}
	s.events.register(client)
	go client.writePump()
	go client.readPump()
}

func (s *Server) publishMessageDeleted(userID, conversationID, messageID string) {
	if s.events == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(messageID) == "" {
		return
	}
	s.events.Publish(userID, map[string]any{
		"type":            "message_deleted",
		"conversation_id": conversationID,
		"message_id":      messageID,
	})
}

func (s *Server) publishConversationMessage(userID string, msg *db.Message) {
	if s.events == nil || msg == nil || strings.TrimSpace(userID) == "" {
		return
	}
	s.events.Publish(userID, map[string]any{
		"type":    "conversation_message",
		"message": msg,
	})
}

func (s *Server) publishTaskStatus(userID, conversationID, agentID, channelID, status, label string) {
	if s.events == nil || strings.TrimSpace(userID) == "" {
		return
	}
	s.events.Publish(userID, map[string]any{
		"type":            "task_status",
		"conversation_id": conversationID,
		"agent_id":        agentID,
		"channel_id":      channelID,
		"status":          status,
		"label":           label,
	})
}

func (s *Server) publishAgentsChanged(userID, reason, agentID string, extra map[string]any) {
	if s.events == nil || strings.TrimSpace(userID) == "" {
		return
	}
	payload := map[string]any{
		"type":   "agents_changed",
		"reason": reason,
	}
	if id := strings.TrimSpace(agentID); id != "" {
		payload["agent_id"] = id
	}
	for k, v := range extra {
		if strings.TrimSpace(k) == "" || v == nil {
			continue
		}
		payload[k] = v
	}
	s.events.Publish(userID, payload)
}

func (s *Server) publishChannelsChanged(userID, reason, channelID string) {
	if s.events == nil || strings.TrimSpace(userID) == "" {
		return
	}
	payload := map[string]any{
		"type":   "channels_changed",
		"reason": reason,
	}
	if id := strings.TrimSpace(channelID); id != "" {
		payload["channel_id"] = id
	}
	s.events.Publish(userID, payload)
}
