package httpserver

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const maxChannelWakeMembers = 3

// schedulePriorityWake runs agent wakeups in the background after a priority bus message.
func (s *Server) schedulePriorityWake(userID string, msg *db.AgentBusMessage) {
	if msg == nil || !msg.Priority {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
		defer cancel()
		if err := s.wakeForBusMessage(ctx, userID, msg); err != nil {
			log.Printf("agent-bus priority wake failed msg=%s: %v", msg.ID, err)
		}
	}()
}

func (s *Server) wakeForBusMessage(ctx context.Context, userID string, msg *db.AgentBusMessage) error {
	targets := s.priorityWakeTargets(userID, msg)
	if len(targets) == 0 {
		return nil
	}
	var firstErr error
	for _, agentID := range targets {
		if err := s.wakeOneAgent(ctx, userID, msg, agentID); err != nil {
			log.Printf("agent-bus wake agent=%s msg=%s: %v", agentID, msg.ID, err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (s *Server) priorityWakeTargets(userID string, msg *db.AgentBusMessage) []string {
	seen := map[string]struct{}{}
	var out []string
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || id == msg.FromAgentID {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		if _, err := s.db.GetAgent(userID, id); err != nil {
			return
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}

	if msg.ToAgentID != nil {
		add(*msg.ToAgentID)
	}
	if msg.ChannelID != nil && strings.TrimSpace(*msg.ChannelID) != "" {
		members, err := s.db.ListChannelMembers(*msg.ChannelID)
		if err != nil {
			log.Printf("agent-bus list channel members: %v", err)
		} else {
			for _, m := range members {
				if len(out) >= maxChannelWakeMembers {
					break
				}
				add(m)
			}
		}
	}
	if len(out) > maxChannelWakeMembers {
		out = out[:maxChannelWakeMembers]
	}
	return out
}

func (s *Server) wakeOneAgent(ctx context.Context, userID string, msg *db.AgentBusMessage, targetAgentID string) error {
	notice := fmt.Sprintf(
		"你收到来自助手「%s」的协作消息（priority 唤醒）。请根据下列消息内容作答；你的回复会回传给对方。",
		msg.FromAgentID,
	)
	title := fmt.Sprintf("协作唤醒 ← %s", msg.FromAgentID)
	res, err := s.runAgentOnce(ctx, userID, targetAgentID, msg.Body, title, "", notice)
	if err != nil {
		s.projectHandoffStatus(userID, msg, "failed")
		return err
	}
	reply := strings.TrimSpace(res.Reply)
	if reply == "" {
		reply = "（助手未返回文本）"
	}
	to := msg.FromAgentID
	replyTo := msg.ID
	_, err = s.deliverAgentMessage(userID, targetAgentID, &to, msg.ChannelID, false, reply, &replyTo)
	if err != nil {
		s.projectHandoffStatus(userID, msg, "failed")
		return err
	}
	s.projectHandoffStatus(userID, msg, "done")
	// Surface the woken bot's answer on the same timeline as the HandoffCard
	// so the user sees ownership (to_bot) without opening the wake side-thread.
	s.projectHandoffReply(userID, msg, reply)
	return nil
}
