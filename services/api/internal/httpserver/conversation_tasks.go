package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const (
	taskSlotsMax   = 3
	taskRunTimeout = 30 * time.Minute
)

type taskControl struct {
	mu      sync.Mutex
	cancels map[string]taskRun
	slots   int
	wake    chan struct{}
}

type taskRun struct {
	userID string
	cancel context.CancelFunc
}

func newTaskControl() *taskControl {
	return &taskControl{
		cancels: map[string]taskRun{},
		slots:   taskSlotsMax,
		wake:    make(chan struct{}, 1),
	}
}

func (s *Server) wakeTasks() {
	if s == nil || s.tasks == nil {
		return
	}
	select {
	case s.tasks.wake <- struct{}{}:
	default:
	}
}

// StartConversationTaskRunner claims queued tasks inside the API process.
func (s *Server) StartConversationTaskRunner(ctx context.Context) {
	if s.tasks == nil {
		s.tasks = newTaskControl()
	}
	if err := s.db.RequeueExpiredConversationTasks(); err != nil {
		log.Printf("conversation tasks requeue: %v", err)
	}
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		s.kickConversationTasks()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.kickConversationTasks()
			case <-s.tasks.wake:
				s.kickConversationTasks()
			}
		}
	}()
	log.Printf("conversation task runner started")
}

func (s *Server) kickConversationTasks() {
	if s.tasks == nil {
		return
	}
	if err := s.db.RequeueExpiredConversationTasks(); err != nil {
		log.Printf("conversation tasks requeue: %v", err)
	}
	for {
		s.tasks.mu.Lock()
		if s.tasks.slots <= 0 {
			s.tasks.mu.Unlock()
			return
		}
		s.tasks.slots--
		s.tasks.mu.Unlock()

		task, err := s.db.ClaimNextConversationTask()
		if err != nil {
			log.Printf("conversation tasks claim: %v", err)
			s.releaseTaskSlot()
			return
		}
		if task == nil {
			s.releaseTaskSlot()
			return
		}
		go s.executeConversationTask(task)
	}
}

func (s *Server) releaseTaskSlot() {
	s.tasks.mu.Lock()
	if s.tasks.slots < taskSlotsMax {
		s.tasks.slots++
	}
	s.tasks.mu.Unlock()
}

func (s *Server) executeConversationTask(task *db.ConversationTask) {
	defer func() {
		s.tasks.mu.Lock()
		delete(s.tasks.cancels, task.ConversationID)
		if s.tasks.slots < taskSlotsMax {
			s.tasks.slots++
		}
		s.tasks.mu.Unlock()
		s.wakeTasks()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), taskRunTimeout)
	defer cancel()
	s.tasks.mu.Lock()
	s.tasks.cancels[task.ConversationID] = taskRun{userID: task.UserID, cancel: cancel}
	s.tasks.mu.Unlock()

	leaseDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-leaseDone:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.db.RenewConversationTaskLease(task.ID); err != nil {
					log.Printf("conversation task lease %s: %v", task.ID, err)
				}
			}
		}
	}()
	defer close(leaseDone)

	conv, _ := s.db.GetConversation(task.UserID, task.ConversationID)
	channelID := ""
	if conv != nil {
		channelID = conv.ChannelID
	}
	s.publishTaskStatus(task.UserID, task.ConversationID, task.AgentID, channelID, "running", "正在做，做好会发在这里")

	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		if ctx.Err() != nil {
			break
		}
		cur, err := s.db.GetConversationTask(task.ID)
		if err != nil || cur == nil || cur.Status != db.TaskRunning {
			return
		}
		_ = s.db.SetConversationTaskAttempt(task.ID, attempt)
		reply, requestID, runErr := s.runConversationTaskOnce(ctx, task)
		if runErr != nil {
			lastErr = runErr
			if ctx.Err() != nil {
				break
			}
			continue
		}
		if strings.TrimSpace(reply) != "" {
			s.finishTaskMessage(task, reply, db.TaskDone, "", channelID, requestID)
			return
		}
		lastErr = errors.New("empty")
	}

	cur, _ := s.db.GetConversationTask(task.ID)
	if cur == nil || cur.Status != db.TaskRunning {
		return
	}
	msg := taskFailText
	status := db.TaskFailed
	errText := ""
	if lastErr != nil {
		errText = lastErr.Error()
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		msg = taskTimeoutText
		errText = "timeout"
	} else if errors.Is(ctx.Err(), context.Canceled) {
		return
	}
	s.finishTaskMessage(task, msg, status, errText, channelID, "")
}

func (s *Server) finishTaskMessage(task *db.ConversationTask, text, status, lastError, channelID, requestID string) {
	cur, err := s.db.GetConversationTask(task.ID)
	if err != nil || cur == nil || cur.Status != db.TaskRunning {
		return
	}
	ok, err := s.db.FinishConversationTask(task.ID, status, lastError)
	if err != nil || !ok {
		return
	}
	msg, err := s.db.AddMessageWithOpts(task.ConversationID, "assistant", text, db.AddMessageOpts{
		AgentID:   task.AgentID,
		RequestID: strings.TrimSpace(requestID),
	})
	if err != nil {
		log.Printf("conversation task message %s: %v", task.ID, err)
	} else {
		s.publishConversationMessage(task.UserID, msg)
	}
	label := ""
	if status != db.TaskDone {
		label = text
	}
	s.publishTaskStatus(task.UserID, task.ConversationID, task.AgentID, channelID, "idle", label)
}

func (s *Server) runConversationTaskOnce(ctx context.Context, task *db.ConversationTask) (string, string, error) {
	msgs, err := s.db.ListMessages(task.UserID, task.ConversationID)
	if err != nil {
		return "", "", err
	}
	conv, err := s.db.GetConversation(task.UserID, task.ConversationID)
	if err != nil {
		return "", "", err
	}
	systemPrompt := ""
	agentName := ""
	if agent, aerr := s.db.GetAgent(task.UserID, task.AgentID); aerr == nil {
		systemPrompt = agent.SystemPrompt
		agentName = agent.Name
	}
	instruction := fmt.Sprintf(
		"你有一条尚未交付的后台任务，必须在本轮用工具真正做完，不能只回复承诺或「稍后」。\n目标：\n%s\n完成后：用简短中文报告结果；若改了文件请给出可打开的链接。若做不到，说明卡在哪一步。",
		task.Goal,
	)
	if strings.TrimSpace(systemPrompt) != "" {
		systemPrompt = systemPrompt + "\n\n" + instruction
	} else {
		systemPrompt = instruction
	}

	var llmPayload map[string]any
	conn, err := s.db.ResolveEffectiveLLM(task.UserID)
	if err != nil && !errors.Is(err, db.ErrNotFound) {
		return "", "", err
	}
	if conn != nil {
		llmPayload = llmRuntimePayload(conn)
	}
	enabledSkills, _ := s.db.ListEnabledSkillNamesForAgent(task.UserID, task.AgentID)
	if enabledSkills == nil {
		enabledSkills = []string{}
	}
	payloadMap := map[string]any{
		"conversation_id": task.ConversationID,
		"content":         instruction,
		"agent_id":        task.AgentID,
		"user_id":         task.UserID,
		"channel_id":      conv.ChannelID,
		"system_prompt":   systemPrompt,
		"messages":        historyForRuntime(msgs, task.AgentID, speakerNamesForHistory(s.db, msgs, task.AgentID, agentName)),
		"enabled_skills":  enabledSkills,
		"max_tool_rounds": 16,
		"request_id":      task.ID,
	}
	if llmPayload != nil {
		payloadMap["llm"] = llmPayload
	}
	attachDecision(payloadMap, s.decisionRuntimePayload(task.UserID))
	attachUserTimezone(payloadMap, s.userSettingsOrDefault(task.UserID))
	s.attachPreferredMachine(payloadMap, task.UserID, task.AgentID)

	emit := func(event string, data any) {
		if event != "status" {
			return
		}
		label := ""
		if m, ok := data.(map[string]any); ok {
			label, _ = m["label"].(string)
		}
		if strings.TrimSpace(label) == "" {
			label = "正在做，做好会发在这里"
		}
		s.publishTaskStatus(task.UserID, task.ConversationID, task.AgentID, conv.ChannelID, "running", label)
	}
	recallCtx := &recallPersistContext{
		UserID:         task.UserID,
		AgentID:        task.AgentID,
		ConversationID: task.ConversationID,
		MessageID:      task.SourceMessageID,
		Source:         "defer_work",
	}
	text, _, runID, runUsage, runErr := s.proxyRuntimeRun(ctx, emit, payloadMap, recallCtx)
	if runErr == nil {
		_ = s.db.RecordUsageRun("", task.UserID, task.AgentID, task.ConversationID, "defer_work",
			runUsage.PromptTokens, runUsage.CompletionTokens, runUsage.TotalTokens)
	}
	return text, runID, runErr
}

func (s *Server) abortTask(conversationID string) {
	if s.tasks == nil {
		return
	}
	s.tasks.mu.Lock()
	run, ok := s.tasks.cancels[conversationID]
	s.tasks.mu.Unlock()
	if ok && run.cancel != nil {
		run.cancel()
	}
}

func (s *Server) abortUserTasks(userID string) {
	if s.tasks == nil {
		return
	}
	s.tasks.mu.Lock()
	defer s.tasks.mu.Unlock()
	for _, run := range s.tasks.cancels {
		if run.userID == userID && run.cancel != nil {
			run.cancel()
		}
	}
}

// botAssistantMessageOpts builds persist opts for Bot-generated assistant rows.
// ReplyToID is always empty (product: only explicit user「回复」quotes).
// RequestID links the row to the triggering runtime turn when known.
// threadRootID is inherited from the triggering user turn only when that turn
// was an explicit sidebar-thread post (client thread_root_id); mainline quotes
// leave it empty so Bot stays on the main timeline.
func botAssistantMessageOpts(agentID, threadRootID, requestID string) db.AddMessageOpts {
	return db.AddMessageOpts{
		AgentID:      agentID,
		ThreadRootID: strings.TrimSpace(threadRootID),
		RequestID:    strings.TrimSpace(requestID),
	}
}


// dropProjectedGroupPass deletes an assistant row already projected for this
// runtime request_id when the turn is classified as group PASS / silence.
func (s *Server) dropProjectedGroupPass(conversationID, requestID string) {
	rid := strings.TrimSpace(requestID)
	cid := strings.TrimSpace(conversationID)
	if rid == "" || cid == "" || s.db == nil {
		return
	}
	existing, err := s.db.FindAssistantByRequestID(cid, rid)
	if err != nil || existing == nil {
		return
	}
	if err := s.db.DeleteMessage(cid, existing.ID); err != nil {
		log.Printf("drop projected PASS conv=%s req=%s: %v", cid, rid, err)
	}
}

func (s *Server) saveAssistant(userID, conversationID, agentID, text string, emit func(event string, data any)) *db.Message {
	return s.saveAssistantThreaded(userID, conversationID, agentID, text, "", "", "", emit)
}

// saveAssistantThreaded persists an assistant row.
// replyToID must stay empty for normal Bot turns and stop markers — the UI treats
// reply_to_id as a user quote/引用. Only the user send path (explicit「回复」) writes
// reply_to_id. Use requestID (runtime run_id) to associate with the triggering turn.
// threadRootID must match the triggering user turn: empty on mainline (including
// quote-only reply_to); non-empty only for explicit sidebar-thread posts.
func (s *Server) saveAssistantThreaded(userID, conversationID, agentID, text, replyToID, threadRootID, requestID string, emit func(event string, data any)) *db.Message {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	// Hard guard: never persist group silence tokens (even if caller forgot to skip).
	if db.ContentIsGroupPass(text) {
		return nil
	}
	rid := strings.TrimSpace(requestID)
	// Durable harness may already have projected this turn via journal
	// commit_assistant(project=True). Reuse that row so one user turn cannot
	// produce two identical assistant messages in DB/UI.
	if rid != "" {
		if existing, err := s.db.FindAssistantByRequestID(conversationID, rid); err == nil && existing != nil {
			s.emitAssistantSaved(emit, conversationID, existing)
			s.publishConversationMessage(userID, existing)
			return existing
		}
	}
	msg, err := s.db.AddMessageWithOpts(conversationID, "assistant", text, db.AddMessageOpts{
		AgentID:      agentID,
		ReplyToID:    strings.TrimSpace(replyToID),
		ThreadRootID: strings.TrimSpace(threadRootID),
		RequestID:    rid,
	})
	if err != nil {
		log.Printf("save assistant conv=%s: %v", conversationID, err)
		return nil
	}
	s.emitAssistantSaved(emit, conversationID, msg)
	s.publishConversationMessage(userID, msg)
	return msg
}

func (s *Server) emitAssistantSaved(emit func(event string, data any), conversationID string, msg *db.Message) {
	if emit == nil || msg == nil {
		return
	}
	meta := map[string]any{
		"phase":           "message_saved",
		"message_id":      msg.ID,
		"conversation_id": conversationID,
		"reply_to_id":     msg.ReplyToID,
		"thread_root_id":  msg.ThreadRootID,
	}
	if msg.RequestID != "" {
		meta["request_id"] = msg.RequestID
	}
	emit("meta", meta)
}

// cancelTasksAndNotify stops queued and running work for this conversation.
// When a task was actually cancelled, it writes 「已停下。」 and returns true.
func (s *Server) cancelTasksAndNotify(userID string, conv *db.Conversation, emit func(event string, data any)) (bool, error) {
	if conv == nil {
		return false, nil
	}
	_, n, err := s.db.CancelOpenConversationTasks(conv.ID)
	s.abortTask(conv.ID)
	if err != nil || n == 0 {
		return false, err
	}
	if emit != nil {
		emit("token", map[string]any{"text": cancelTaskText})
	}
	s.saveAssistant(userID, conv.ID, conv.AgentID, cancelTaskText, emit)
	s.publishTaskStatus(userID, conv.ID, conv.AgentID, conv.ChannelID, "idle", "")
	return true, nil
}

// tryShortcutTurn does not call the model when a backend agent is already
// running. The new text is queued as-is. Wording is not interpreted.
func (s *Server) tryShortcutTurn(userID string, conv *db.Conversation, sourceMessageID, content, agentID string, emit func(event string, data any)) bool {
	open, err := s.db.OpenConversationTask(conv.ID)
	if err != nil {
		log.Printf("open conversation task conv=%s: %v", conv.ID, err)
		return false
	}
	kind := classifySend(content, open != nil)
	if kind == gateNone {
		return false
	}
	if kind == gateCancel {
		ok, err := s.cancelTasksAndNotify(userID, conv, emit)
		if err != nil {
			log.Printf("cancel conversation tasks conv=%s: %v", conv.ID, err)
		}
		return ok
	}
	goal := strings.TrimSpace(content)
	if goal == "" {
		return false
	}
	if _, err := s.db.EnqueueConversationTask(userID, conv.ID, agentID, goal, sourceMessageID); err != nil {
		log.Printf("enqueue conversation task conv=%s: %v", conv.ID, err)
		return false
	}
	s.wakeTasks()
	s.publishTaskStatus(userID, conv.ID, agentID, conv.ChannelID, "running", "正在做，做好会发在这里")
	emit("meta", map[string]any{"phase": "task_queued", "conversation_id": conv.ID})
	s.speakShortcut(userID, conv, agentID, statusWaitText, emit)
	return true
}

func (s *Server) speakShortcut(userID string, conv *db.Conversation, agentID, text string, emit func(event string, data any)) {
	name := agentID
	if agent, err := s.db.GetAgent(userID, agentID); err == nil && agent != nil {
		name = agent.Name
	}
	emit("meta", map[string]any{
		"phase":      "agent_start",
		"agent_id":   agentID,
		"agent_name": name,
		"index":      0,
		"total":      1,
	})
	emit("token", map[string]any{"text": text})
	s.saveAssistant(userID, conv.ID, agentID, text, emit)
	emit("meta", map[string]any{
		"phase":    "agent_done",
		"agent_id": agentID,
		"index":    0,
	})
}
