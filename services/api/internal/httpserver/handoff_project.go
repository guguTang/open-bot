package httpserver

import (
	"log"
	"strings"
	"unicode/utf8"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const handoffPurposeMaxRunes = 120

// shouldProjectHandoff: visible Bot↔Bot handoffs only (direct to_agent).
// Channel-only / no-target chatter stays on the bus (default invisible).
func shouldProjectHandoff(msg *db.AgentBusMessage) bool {
	if msg == nil {
		return false
	}
	if msg.ToAgentID == nil || strings.TrimSpace(*msg.ToAgentID) == "" {
		return false
	}
	// Reply on the bus (priority wake echo) is not a new user-facing handoff.
	if msg.ReplyToID != nil && strings.TrimSpace(*msg.ReplyToID) != "" {
		return false
	}
	return true
}

func purposeFromBody(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return "协作交接"
	}
	if utf8.RuneCountInString(body) <= handoffPurposeMaxRunes {
		return body
	}
	runes := []rune(body)
	return string(runes[:handoffPurposeMaxRunes]) + "…"
}

func agentDisplayName(d *db.DB, userID, agentID string) string {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" || d == nil {
		return agentID
	}
	a, err := d.GetAgent(userID, agentID)
	if err != nil || a == nil {
		return agentID
	}
	if n := strings.TrimSpace(a.Name); n != "" {
		return n
	}
	return agentID
}

// resolveHandoffConversation picks where the HandoffCard is visible.
// Order: explicit conversationID → channel conversation → stable primary DM
// (never a「协作唤醒」side thread; create primary if missing).
func (s *Server) resolveHandoffConversation(userID, conversationID, channelID, viewerAgentID string) (*db.Conversation, error) {
	if s == nil || s.db == nil {
		return nil, db.ErrNotFound
	}
	userID = strings.TrimSpace(userID)
	if cid := strings.TrimSpace(conversationID); cid != "" {
		return s.db.GetConversation(userID, cid)
	}
	if ch := strings.TrimSpace(channelID); ch != "" {
		if conv, err := s.db.GetConversationByChannel(userID, ch); err == nil && conv != nil {
			return conv, nil
		}
	}
	viewer := strings.TrimSpace(viewerAgentID)
	if viewer == "" {
		viewer = "open-bot"
	}
	return s.db.GetOrCreatePrimaryConversation(userID, viewer)
}

// projectHandoffAfterBusWrite inserts a timeline handoff note after agent-bus success.
// Idempotent on agent_message_id; skips if that id already appears on the user timeline (@ dedup).
func (s *Server) projectHandoffAfterBusWrite(userID string, msg *db.AgentBusMessage) {
	if !shouldProjectHandoff(msg) {
		return
	}
	to := strings.TrimSpace(*msg.ToAgentID)
	status := "running"
	if !msg.Priority {
		// Non-priority direct handoff: still user-visible when it changes task routing;
		// mark done immediately (no wake lifecycle).
		status = "done"
	}
	s.writeHandoffProjection(userID, msg, to, status, true, "", "")
}

// projectHandoffStatus updates / inserts projection after priority wake completes or fails.
func (s *Server) projectHandoffStatus(userID string, msg *db.AgentBusMessage, status string) {
	if msg == nil || msg.ToAgentID == nil {
		return
	}
	to := strings.TrimSpace(*msg.ToAgentID)
	if to == "" {
		return
	}
	s.writeHandoffProjection(userID, msg, to, status, false, "", "")
}

// projectHandoffReply inserts the woken bot's answer into the same timeline as the HandoffCard.
func (s *Server) projectHandoffReply(userID string, msg *db.AgentBusMessage, reply string) {
	if s == nil || s.db == nil || msg == nil || msg.ToAgentID == nil {
		return
	}
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return
	}
	to := strings.TrimSpace(*msg.ToAgentID)
	agentMsgID := strings.TrimSpace(msg.ID)
	if to == "" || agentMsgID == "" {
		return
	}
	chID := ""
	if msg.ChannelID != nil {
		chID = strings.TrimSpace(*msg.ChannelID)
	}
	viewer := strings.TrimSpace(msg.FromAgentID)
	conv, err := s.resolveHandoffConversation(userID, "", chID, viewer)
	if err != nil || conv == nil {
		// Prefer conversation already holding the handoff note.
		if noteConv, nerr := s.db.ConversationIDForHandoff(agentMsgID); nerr == nil && noteConv != "" {
			if c2, gerr := s.db.GetConversation(userID, noteConv); gerr == nil {
				conv = c2
			}
		}
	}
	if conv == nil {
		log.Printf("handoff reply project find conv user=%s msg=%s: %v", userID, agentMsgID, err)
		return
	}
	if _, err := s.db.AddMessageWithAgent(conv.ID, "assistant", reply, to); err != nil {
		log.Printf("handoff reply project insert msg=%s: %v", agentMsgID, err)
	}
}

func (s *Server) writeHandoffProjection(userID string, msg *db.AgentBusMessage, toBot, status string, skipIfProjected bool, conversationID, channelID string) {
	if s == nil || s.db == nil || msg == nil {
		return
	}
	agentMsgID := strings.TrimSpace(msg.ID)
	if agentMsgID == "" {
		return
	}
	if skipIfProjected {
		exists, err := s.db.HasHandoffForAgentMessage(agentMsgID)
		if err != nil {
			log.Printf("handoff project exists check msg=%s: %v", agentMsgID, err)
			return
		}
		if exists {
			// Already on timeline (e.g. @ path) — do not double-project.
			return
		}
	}

	if channelID == "" && msg.ChannelID != nil {
		channelID = strings.TrimSpace(*msg.ChannelID)
	}
	viewer := strings.TrimSpace(msg.FromAgentID)
	if viewer == "" {
		viewer = "open-bot"
	}
	conv, err := s.resolveHandoffConversation(userID, conversationID, channelID, viewer)
	if err != nil {
		log.Printf("handoff project find conv user=%s viewer=%s: %v", userID, viewer, err)
		return
	}

	hp := db.HandoffPayload{
		FromBot:        agentDisplayName(s.db, userID, viewer),
		ToBot:          agentDisplayName(s.db, userID, toBot),
		Purpose:        purposeFromBody(msg.Body),
		Status:         status,
		AgentMessageID: agentMsgID,
	}
	note, created, err := s.db.AddHandoffNote(conv.ID, "", hp)
	if err != nil {
		log.Printf("handoff project insert msg=%s: %v", agentMsgID, err)
		return
	}
	if !created && note != nil && note.Handoff != nil && note.Handoff.Status != status {
		if _, uerr := s.db.UpdateHandoffStatus(agentMsgID, status); uerr != nil {
			log.Printf("handoff project status update msg=%s: %v", agentMsgID, uerr)
		}
	}
}
