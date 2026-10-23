package httpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const askReplyMaxRunes = 12000

type askAgentBody struct {
	UserID               string `json:"user_id"`
	FromAgentID          string `json:"from_agent_id"`
	ToAgentID            string `json:"to_agent_id"`
	Question             string `json:"question"`
	ParentConversationID string `json:"parent_conversation_id"`
	ParentThreadID       string `json:"parent_thread_id"`
}

// askRequestKey is stable across a crash retry of the same parent turn.
func askRequestKey(parentThread, toAgent, question string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(parentThread) + "\n" + strings.TrimSpace(toAgent) + "\n" + strings.TrimSpace(question)))
	return hex.EncodeToString(sum[:16])
}

// POST /internal/agents/ask — synchronous colleague help inside the caller's turn.
// The target runs with its own persona, skills, and memory. The reply is written
// into the caller's conversation (来自 target) and the target's primary conversation
// (来自 caller), which is the thread the sidebar opens for that bot.
func (s *Server) handleInternalAskAgent(w http.ResponseWriter, r *http.Request) {
	var body askAgentBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Minute)
	defer cancel()
	out, code, err := s.askAgent(ctx, body)
	if err != nil {
		writeJSON(w, code, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, code, out)
}

func (s *Server) askAgent(ctx context.Context, body askAgentBody) (map[string]any, int, error) {
	userID := strings.TrimSpace(body.UserID)
	fromID := strings.TrimSpace(body.FromAgentID)
	toID := strings.TrimSpace(body.ToAgentID)
	question := strings.TrimSpace(body.Question)
	if userID == "" || fromID == "" || toID == "" || question == "" {
		return nil, http.StatusBadRequest, errors.New("user_id, from_agent_id, to_agent_id, and question are required")
	}
	if fromID == toID {
		return nil, http.StatusBadRequest, errors.New("不能向自己提问")
	}
	question = clipRunes(question, 8000)
	from, err := s.db.GetAgent(userID, fromID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, http.StatusNotFound, errors.New("from agent not found")
		}
		return nil, http.StatusInternalServerError, err
	}
	to, err := s.db.GetAgent(userID, toID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return nil, http.StatusNotFound, errors.New("to agent not found")
		}
		return nil, http.StatusInternalServerError, err
	}

	key := askRequestKey(body.ParentThreadID, toID, question)
	targetConv, err := s.db.GetOrCreatePrimaryConversation(userID, toID)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	toName := strings.TrimSpace(to.Name)
	if toName == "" {
		toName = toID
	}
	s.ensureAskNoticeOnParent(userID, body.ParentConversationID, toID, toName, key)
	if reply, convID, ok := s.cachedAskReply(userID, targetConv.ID, toID, key); ok {
		visible, needsUser := splitAskNeedUser(reply)
		s.ensureAskReplyOnParent(userID, body.ParentConversationID, toID, visible, key)
		return askOK(fromID, toID, visible, convID, needsUser), http.StatusOK, nil
	}
	if _, qerr := s.db.FindUserMessageByRequestID(userID, key+":q"); qerr != nil {
		qmsg, aerr := s.db.AddMessageWithOpts(targetConv.ID, "assistant", question, db.AddMessageOpts{
			AgentID:   fromID,
			RequestID: key + ":q",
		})
		if aerr != nil {
			return nil, http.StatusInternalServerError, aerr
		}
		s.publishConversationMessage(userID, qmsg)
	}

	fromName := strings.TrimSpace(from.Name)
	if fromName == "" {
		fromName = fromID
	}
	notice := fmt.Sprintf(
		"你正在回答同事「%s」转来的问题。问题已自包含，请直接作答并交回对方。不要调用 ask_agent，也不要再转交其他同事。"+
			"材料够就直接作答。不要复述岗位，不要寒暄。"+
			"若缺的是只有用户才知道的细节，第一行只写 NEED_USER，换行后再列问题，不要替用户做主。",
		fromName,
	)
	systemPrompt := strings.TrimSpace(to.SystemPrompt)
	if systemPrompt != "" {
		systemPrompt = systemPrompt + "\n\n" + notice
	} else {
		systemPrompt = notice
	}

	msgs, err := s.db.ListMessages(userID, targetConv.ID)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	history := historyForRuntime(msgs, toID, speakerNamesForHistory(s.db, msgs, toID, toName))
	content := question
	if len(history) > 0 && history[len(history)-1].Role == "user" {
		content = history[len(history)-1].Content
	}

	enabledSkills, _ := s.db.ListEnabledSkillNamesForAgent(userID, toID)
	if enabledSkills == nil {
		enabledSkills = []string{}
	}
	var llmPayload map[string]any
	if conn, lerr := s.db.ResolveEffectiveLLM(userID); lerr == nil && conn != nil {
		llmPayload = llmRuntimePayload(conn)
	} else if lerr != nil && !errors.Is(lerr, db.ErrNotFound) {
		return nil, http.StatusInternalServerError, lerr
	}

	payload := map[string]any{
		"conversation_id": targetConv.ID,
		"content":         content,
		"agent_id":        toID,
		"user_id":         userID,
		"system_prompt":   systemPrompt,
		"messages":        history,
		"enabled_skills":  enabledSkills,
		"request_id":      key + ":run",
		"max_tool_rounds": s.effectiveMaxToolRounds(userID),
		"ask_depth":       1,
		"allow_ask_agent": false,
		"owner_thread_id": strings.TrimSpace(body.ParentThreadID),
	}
	if llmPayload != nil {
		payload["llm"] = llmPayload
	}
	attachDecision(payload, s.decisionRuntimePayload(userID))
	attachUserTimezone(payload, s.userSettingsOrDefault(userID))
	attachToolAllowlist(payload, s.toolAllowlistOrEmpty(userID))
	s.attachPreferredMachine(payload, userID, toID)

	reply, _, _, sources, _, runErr := s.proxyRuntimeRun(ctx, func(string, any) {}, payload, &recallPersistContext{
		UserID:         userID,
		AgentID:        toID,
		ConversationID: targetConv.ID,
		Source:         "ask_agent",
	})
	if ctx.Err() != nil {
		return nil, http.StatusGatewayTimeout, errors.New("询问已取消")
	}
	if runErr != nil {
		return nil, http.StatusBadGateway, runErr
	}
	reply = strings.TrimSpace(stripThinkTags(reply))
	if reply == "" {
		return nil, http.StatusBadGateway, errors.New("对方没有返回文本")
	}
	reply = clipRunes(reply, askReplyMaxRunes)
	visible, needsUser := splitAskNeedUser(reply)
	// The child run may already have projected this reply (journal request_id is
	// the runtime run id, not key+":run"). Insert only when that row is absent.
	// User-visible text drops the NEED_USER marker.
	if !s.targetHasAskReply(userID, targetConv.ID, toID, reply, visible, key) {
		msg, aerr := s.db.AddMessageWithOpts(targetConv.ID, "assistant", visible, db.AddMessageOpts{
			AgentID:   toID,
			RequestID: key + ":a",
			Sources:   sources,
		})
		if aerr != nil {
			return nil, http.StatusInternalServerError, aerr
		}
		s.publishConversationMessage(userID, msg)
	}
	s.ensureAskReplyOnParent(userID, body.ParentConversationID, toID, visible, key)
	return askOK(fromID, toID, visible, targetConv.ID, needsUser), http.StatusOK, nil
}

func splitAskNeedUser(reply string) (string, bool) {
	reply = strings.TrimSpace(reply)
	if reply == "" {
		return reply, false
	}
	lines := strings.Split(reply, "\n")
	first := strings.Trim(strings.TrimSpace(lines[0]), "`*_ ")
	token := strings.TrimRight(strings.ToUpper(first), ":： ")
	if token != "NEED_USER" {
		return reply, false
	}
	rest := strings.TrimSpace(strings.Join(lines[1:], "\n"))
	if rest == "" {
		rest = "还需要你补充一些细节。"
	}
	return rest, true
}

func (s *Server) targetHasAskReply(userID, targetConvID, toAgentID, raw, visible, key string) bool {
	if _, err := s.db.FindAssistantByRequestID(targetConvID, key+":a"); err == nil {
		return true
	}
	if _, err := s.db.FindAssistantByRequestID(targetConvID, key+":run"); err == nil {
		return true
	}
	msgs, err := s.db.ListMessages(userID, targetConvID)
	if err != nil || len(msgs) == 0 {
		return false
	}
	last := msgs[len(msgs)-1]
	if last.Role != "assistant" || last.AgentID != toAgentID {
		return false
	}
	got := strings.TrimSpace(last.Content)
	if got != strings.TrimSpace(raw) && got != strings.TrimSpace(visible) {
		return false
	}
	if got != strings.TrimSpace(visible) {
		if updated, uerr := s.db.UpdateMessageContent(targetConvID, last.ID, visible); uerr == nil && updated != nil {
			s.publishConversationMessage(userID, updated)
		}
	}
	return true
}

func (s *Server) cachedAskReply(userID, targetConvID, toAgentID, key string) (string, string, bool) {
	for _, id := range []string{key, key + ":a"} {
		var existing *db.Message
		var err error
		if id == key+":a" {
			existing, err = s.db.FindAssistantByRequestID(targetConvID, id)
		} else {
			existing, err = s.db.FindUserMessageByRequestID(userID, id)
		}
		if err != nil || existing == nil || existing.Role != "assistant" {
			continue
		}
		reply := strings.TrimSpace(existing.Content)
		if reply == "" {
			continue
		}
		return reply, existing.ConversationID, true
	}
	q, qerr := s.db.FindUserMessageByRequestID(userID, key+":q")
	if qerr != nil || q == nil {
		return "", "", false
	}
	msgs, err := s.db.ListMessages(userID, targetConvID)
	if err != nil {
		return "", "", false
	}
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.ID == q.ID {
			break
		}
		if m.Role == "assistant" && m.AgentID == toAgentID && strings.TrimSpace(m.Content) != "" {
			return strings.TrimSpace(m.Content), m.ConversationID, true
		}
	}
	return "", "", false
}

func askOK(fromID, toID, reply, conversationID string, needsUser bool) map[string]any {
	out := map[string]any{
		"ok":              true,
		"from_agent_id":   fromID,
		"to_agent_id":     toID,
		"reply":           reply,
		"conversation_id": conversationID,
	}
	if needsUser {
		out["needs_user"] = true
		out["instruction"] = "同事的追问已经显示在当前会话里。停下来等用户，不要立刻再问。不要复述 reply，不要替用户做选择，不要再调用 ask_agent。没有新信息就用不超过十五个字收尾。"
	}
	return out
}

func (s *Server) ensureAskReplyOnParent(userID, parentConvID, toAgentID, reply, key string) {
	parentConvID = strings.TrimSpace(parentConvID)
	if parentConvID == "" || strings.TrimSpace(reply) == "" {
		return
	}
	parent, err := s.db.GetConversation(userID, parentConvID)
	if err != nil || parent == nil {
		return
	}
	if parent.ID != "" {
		if existing, ferr := s.db.FindAssistantByRequestID(parent.ID, key); ferr == nil && existing != nil {
			return
		}
	}
	msg, err := s.db.AddMessageWithOpts(parent.ID, "assistant", reply, db.AddMessageOpts{
		AgentID:   toAgentID,
		RequestID: key,
	})
	if err != nil {
		return
	}
	s.publishConversationMessage(userID, msg)
}

// agentInParentChannel reports that toAgentID is already a member of the parent
// conversation's channel (group). Used to skip DM-style ask_notice noise when the
// colleague's reply will already appear as a normal group bubble.
func (s *Server) agentInParentChannel(userID, parentConvID, toAgentID string) bool {
	if s == nil || s.db == nil {
		return false
	}
	parentConvID = strings.TrimSpace(parentConvID)
	toAgentID = strings.TrimSpace(toAgentID)
	if parentConvID == "" || toAgentID == "" {
		return false
	}
	parent, err := s.db.GetConversation(userID, parentConvID)
	if err != nil || parent == nil {
		return false
	}
	chID := strings.TrimSpace(parent.ChannelID)
	if chID == "" {
		return false // DM / primary: keep ask_notice
	}
	ch, err := s.db.GetChannel(userID, chID)
	if err != nil || ch == nil {
		return false
	}
	for _, m := range ch.Members {
		if strings.TrimSpace(m) == toAgentID {
			return true
		}
	}
	return false
}

func (s *Server) ensureAskNoticeOnParent(userID, parentConvID, toAgentID, toName, key string) {
	parentConvID = strings.TrimSpace(parentConvID)
	if parentConvID == "" || strings.TrimSpace(key) == "" {
		return
	}
	// Same-group colleague: ensureAskReplyOnParent already shows their answer as a
	// normal assistant bubble — a gray 「消息通知了 X」 line is redundant noise.
	if s.agentInParentChannel(userID, parentConvID, toAgentID) {
		return
	}
	noticeID := key + ":notice"
	if _, err := s.db.FindMessageByRequestID(parentConvID, noticeID); err == nil {
		return
	}
	name := strings.TrimSpace(toName)
	if name == "" {
		name = "同事"
	}
	msg, err := s.db.AddMessageWithOpts(parentConvID, "ask_notice", "消息通知了 "+name, db.AddMessageOpts{
		AgentID:   toAgentID,
		RequestID: noticeID,
	})
	if err != nil {
		return
	}
	s.publishConversationMessage(userID, msg)
}

// replyEchoesColleague reports that the caller's closing text is the colleague
// bubble already shown in this turn (exact, or the same text plus a short lead-in).
func replyEchoesColleague(final, colleague string) bool {
	a := compactReply(final)
	b := compactReply(colleague)
	if utf8.RuneCountInString(a) < 4 || utf8.RuneCountInString(b) < 4 {
		return false
	}
	if a == b {
		return true
	}
	if strings.Contains(a, b) {
		extra := utf8.RuneCountInString(a) - utf8.RuneCountInString(b)
		// A short lead-in still counts as a copy. A fifth of a long colleague
		// reply (capped) leaves room for a brief intro without keeping a rewrite.
		allow := 24
		if fifth := utf8.RuneCountInString(b) / 5; fifth > allow {
			allow = fifth
		}
		if allow > 80 {
			allow = 80
		}
		return extra <= allow
	}
	return sameSandboxLink(final, colleague)
}

var sandboxLinkPattern = regexp.MustCompile(`sandbox:[^\s)\]]+`)

// sameSandboxLink is a shorter restatement that points at the file the
// colleague already delivered, such as a second "open the calculator" link.
func sameSandboxLink(final, colleague string) bool {
	theirs := sandboxLinkPattern.FindAllString(colleague, -1)
	if len(theirs) == 0 {
		return false
	}
	have := map[string]struct{}{}
	for _, link := range theirs {
		have[link] = struct{}{}
	}
	mine := sandboxLinkPattern.FindAllString(final, -1)
	if len(mine) == 0 {
		return false
	}
	for _, link := range mine {
		if _, ok := have[link]; !ok {
			return false
		}
	}
	rest := sandboxLinkPattern.ReplaceAllString(final, "")
	return utf8.RuneCountInString(compactReply(rest)) <= 24
}

func compactReply(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// finalEchoesColleague is true when this turn already shows another assistant's
// reply and the text about to be saved only repeats it.
func (s *Server) finalEchoesColleague(userID, conversationID, agentID, text string) bool {
	if s == nil || s.db == nil || strings.TrimSpace(text) == "" {
		return false
	}
	msgs, err := s.db.ListMessages(userID, conversationID)
	if err != nil {
		return false
	}
	self := strings.TrimSpace(agentID)
	for i := len(msgs) - 1; i >= 0; i-- {
		m := msgs[i]
		if m.Role == "user" {
			break
		}
		if m.Role != "assistant" {
			continue
		}
		other := strings.TrimSpace(m.AgentID)
		if other == "" || other == self {
			continue
		}
		if replyEchoesColleague(text, m.Content) {
			return true
		}
	}
	return false
}
