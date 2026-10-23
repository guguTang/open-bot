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

// priorityWakeNotice is the system fragment injected into the woken bot's run.
// Prompt-only: ownership + deliver now; no reply keyword filters.
func priorityWakeNotice(fromLabel string) string {
	fromLabel = strings.TrimSpace(fromLabel)
	if fromLabel == "" {
		fromLabel = "同事"
	}
	return fmt.Sprintf(
		"【任务交接 / priority 唤醒】助手「%s」已把下列任务的所有权移交给你。"+
			"用户正在钉住的会话里等待你的交付结果；你的本回合回复会回传给交接方，并投影到该会话展示给用户。\n"+
			"请立刻产出任务本身的可交付内容（答案、文案、代码、结论、设计建议等）。"+
			"不要只确认已收到、不要只说你会处理或稍后再做。"+
			"若完成任务需要工具，先调用工具做完工作，再给出实质答复；简短收尾只能放在实质内容之后。"+
			"下列用户消息即任务说明（purpose），按它交付。",
		fromLabel,
	)
}

func (s *Server) wakeOneAgent(ctx context.Context, userID string, msg *db.AgentBusMessage, targetAgentID string) error {
	fromLabel := agentDisplayName(s.db, userID, msg.FromAgentID)
	notice := priorityWakeNotice(fromLabel)
	title := fmt.Sprintf("协作唤醒 ← %s", fromLabel)
	res, err := s.runAgentOnce(ctx, userID, targetAgentID, msg.Body, title, "", notice)
	if err != nil {
		// One retry for transient upstream/timeouts; content-policy failures usually
		// repeat, but a single retry is cheap and recovers flaky gateway errors.
		select {
		case <-ctx.Done():
			s.projectHandoffStatusDetail(userID, msg, "failed", err.Error())
			return err
		case <-time.After(2 * time.Second):
		}
		res, err = s.runAgentOnce(ctx, userID, targetAgentID, msg.Body, title, "", notice)
		if err != nil {
			s.projectHandoffStatusDetail(userID, msg, "failed", err.Error())
			return err
		}
	}
	reply := strings.TrimSpace(res.Reply)
	if reply == "" {
		reply = "（助手未返回文本）"
	}
	to := msg.FromAgentID
	replyTo := msg.ID
	_, err = s.deliverAgentMessage(userID, targetAgentID, &to, msg.ChannelID, false, reply, &replyTo, "")
	if err != nil {
		s.projectHandoffStatusDetail(userID, msg, "failed", err.Error())
		return err
	}
	s.projectHandoffStatus(userID, msg, "done")
	// Surface the woken bot's answer on the same timeline as the HandoffCard
	// so the user sees ownership (to_bot) without opening the wake side-thread.
	s.projectHandoffReply(userID, msg, reply)
	return nil
}
