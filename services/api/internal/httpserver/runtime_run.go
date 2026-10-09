package httpserver

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

type runOnceResult struct {
	ConversationID string
	Reply          string
	Summary        string
}

// runAgentOnce creates a conversation (or reuses convID), appends user message,
// calls runtime SSE, persists assistant reply, and returns collected text.
// extraSystem is appended to the agent system_prompt when non-empty.
func (s *Server) runAgentOnce(ctx context.Context, userID, agentID, content, title, convID, extraSystem string) (*runOnceResult, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errors.New("content required")
	}
	resolved, rerr := s.db.ResolveAgentID(userID, agentID)
	if rerr != nil {
		return nil, rerr
	}
	agentID = resolved

	var conv *db.Conversation
	var err error
	if strings.TrimSpace(convID) != "" {
		conv, err = s.db.EnsureConversation(userID, convID, agentID, title)
	} else {
		if strings.TrimSpace(title) == "" {
			title = "例行任务"
		}
		conv, err = s.db.CreateConversation(userID, agentID, title)
	}
	if err != nil {
		return nil, err
	}

	userMsg, err := s.db.AddMessage(conv.ID, "user", content)
	if err != nil {
		return nil, err
	}

	msgs, err := s.db.ListMessages(userID, conv.ID)
	if err != nil {
		return nil, err
	}
	history := historyForRuntime(msgs, agentID, speakerNamesForHistory(s.db, msgs, agentID, ""))

	var llmPayload map[string]any
	conn, err := s.db.ResolveEffectiveLLM(userID)
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		return nil, err
	}
	if conn != nil {
		llmPayload = llmRuntimePayload(conn)
	}

	systemPrompt := ""
	if agent, aerr := s.db.GetAgent(userID, agentID); aerr == nil {
		systemPrompt = agent.SystemPrompt
	}
	if es := strings.TrimSpace(extraSystem); es != "" {
		if systemPrompt != "" {
			systemPrompt = systemPrompt + "\n\n" + es
		} else {
			systemPrompt = es
		}
	}

	enabledSkills, _ := s.db.ListEnabledSkillNamesForAgent(userID, agentID)
	if enabledSkills == nil {
		enabledSkills = []string{}
	}

	requestID := uuid.NewString()
	payloadMap := map[string]any{
		"conversation_id": conv.ID,
		"content":         content,
		"agent_id":        agentID,
		"user_id":         userID,
		"channel_id":      conv.ChannelID,
		"system_prompt":   systemPrompt,
		"messages":        history,
		"enabled_skills":  enabledSkills,
		"request_id":      requestID,
		"max_tool_rounds": s.effectiveMaxToolRounds(userID),
	}
	if llmPayload != nil {
		payloadMap["llm"] = llmPayload
	}
	attachDecision(payloadMap, s.decisionRuntimePayload(userID))
	attachUserTimezone(payloadMap, s.userSettingsOrDefault(userID))
	s.attachPreferredMachine(payloadMap, userID, agentID)
	payload, _ := json.Marshal(payloadMap)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.runtimeURL+"/v1/runs", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")

	client := s.client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	// Start of run → thinking; runtime pushes working during tool exec.
	s.publishBotPresence(userID, conv.ID, agentID, "thinking")
	resp, err := client.Do(req)
	if err != nil {
		s.publishBotPresence(userID, conv.ID, agentID, "error")
		return nil, fmt.Errorf("runtime unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		s.publishBotPresence(userID, conv.ID, agentID, "error")
		return nil, fmt.Errorf("runtime error: %s", strings.TrimSpace(string(b)))
	}

	var assistant strings.Builder
	var eventName string
	var pendingSummary string
	var runID string
	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			trimmed := strings.TrimRight(string(line), "\r\n")
			if strings.HasPrefix(trimmed, "event:") {
				eventName = strings.TrimSpace(strings.TrimPrefix(trimmed, "event:"))
			} else if strings.HasPrefix(trimmed, "data:") {
				raw := strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
				var payload map[string]any
				if json.Unmarshal([]byte(raw), &payload) == nil {
					switch eventName {
					case "token":
						if text, ok := payload["text"].(string); ok {
							assistant.WriteString(text)
						}
					case "meta":
						if summaryNew, _ := payload["summary_new"].(bool); summaryNew {
							if sum, ok := payload["summary"].(string); ok && strings.TrimSpace(sum) != "" {
								pendingSummary = sum
							}
						}
						if rid := runIDFromRuntimeMeta(payload); rid != "" {
							runID = rid
						}
						s.persistMemoryRecallFromMeta(payload, recallPersistContext{
							UserID:         userID,
							AgentID:        agentID,
							ConversationID: conv.ID,
							MessageID:      userMsg.ID,
							Source:         sourceHint(title),
						})
					case "error":
						if msg, ok := payload["message"].(string); ok && msg != "" {
							s.publishBotPresence(userID, conv.ID, agentID, "error")
							return nil, errors.New(msg)
						}
					}
				}
			} else if trimmed == "" {
				eventName = ""
			}
		}
		if err != nil {
			if err != io.EOF {
				s.finishBotPresence(userID, conv.ID, agentID, err)
				return nil, err
			}
			break
		}
	}

	if pendingSummary != "" {
		sumAt := userMsg.CreatedAt.Add(-time.Millisecond)
		_, _ = s.db.AddMessageAt(conv.ID, "summary", pendingSummary, sumAt)
	}
	reply := stripThinkTags(assistant.String())
	if reply != "" {
		_, _ = s.db.AddMessageWithOpts(conv.ID, "assistant", reply, db.AddMessageOpts{RequestID: runID})
	}
	source := sourceHint(title)
	_ = s.db.RecordUsageRun("", userID, agentID, conv.ID, source, 0, 0, 0)
	s.publishBotPresence(userID, conv.ID, agentID, "idle")
	return &runOnceResult{
		ConversationID: conv.ID,
		Reply:          reply,
		Summary:        pendingSummary,
	}, nil
}

func sourceHint(title string) string {
	if strings.HasPrefix(title, "A2A ") {
		return "a2a"
	}
	if strings.Contains(title, "例行") || strings.Contains(strings.ToLower(title), "routine") {
		return "routine"
	}
	return "run_once"
}
