package httpserver

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const (
	askRouteRecentMax   = 8
	askRouteMsgRunes    = 400
	askRouteQuestionMax = 4000
	// Laya rejects the decide call once state + questions pass ~1100 runes.
	askRouteDecisionRunes = 640
	askRouteLatestRunes   = 180
	// Colleague criteria are one-line triggers, not full job posts.
	askCriteriaTriggerRunes = 60
	// Optional self-job tail after the none routing default.
	askNoneJobRunes = 48
	// Below this, a colleague choice stays with the current bot.
	askHandoffConfidenceFloor = 0.5
)

const askNoneCriteriaLead = "本职可答；或与下列同事职责重叠；或闲聊/模糊/未点名。默认。"

const askRoutedNote = "本回合已请同事完成这件事，回复已经出现在当前会话里。不要再用自己的工具把同一件事做一遍，也不要整段复述同事的回复。只需短接一句；没有新信息就用不超过十五个字收尾。"

const askRoutedNeedUserNote = "同事已经在向用户追问，问题已经出现在当前会话里。停下来等用户回答，不要立刻再问。不要替用户做主，不要复述问题，不要自己把事情做掉。"

// askRouteShouldCall is the gate before a decision call or askAgent.
// Channels stay on AutoPick. Child asks, empty rosters, and a decision
// provider that is off leave the turn on the existing model path.
func askRouteShouldCall(channelID string, askDepth int, allowAsk, afterInterrupt bool, provider string, peerCount int) bool {
	if strings.TrimSpace(channelID) != "" || askDepth >= 1 || !allowAsk || afterInterrupt {
		return false
	}
	if peerCount < 1 {
		return false
	}
	if db.NormalizeDecisionProvider(provider) == "off" {
		return false
	}
	return true
}

type askDecisionPack struct {
	State     string
	Questions map[string]any
	KeyToID   map[string]string
	Question  string
}

// buildAskDecision packs a choice question for one DM turn.
// No tool list. With a summary, the state is that summary plus the turns
// after it. Without one, it is the current conversation context.
func buildAskDecision(self *db.Agent, peers []*db.Agent, history []runtimeMsg) (askDecisionPack, bool) {
	candidates := askPeerCandidates(selfIDOf(self), peers)
	if len(candidates) == 0 {
		return askDecisionPack{}, false
	}
	keyToID := map[string]string{}
	// none leads with the stay-here default. A short self job may follow.
	// Colleague keys are triggers only: no display names.
	criteria := map[string]string{
		"none": askNoneCriteria(self),
	}
	var choices []askChoiceLine
	for i, peer := range candidates {
		key := fmt.Sprintf("c%d", i)
		keyToID[key] = peer.ID
		criteria[key] = askPeerCriteria(peer.Description)
		choices = append(choices, askChoiceLine{key: key})
	}
	summary, recent := splitAskContext(history)
	state := askDecisionState(askLatestUser(recent), askConversationBlock(summary, recent))
	question := askColleagueQuestion(summary, recent)
	if strings.TrimSpace(question) == "" {
		return askDecisionPack{}, false
	}
	return askDecisionPack{
		State:    state,
		KeyToID:  keyToID,
		Question: question,
		Questions: map[string]any{
			"ask": map[string]any{
				"type":         "choice",
				"instructions": askDecisionRules(choices),
				"criteria":     criteria,
			},
		},
	}, true
}

type askChoiceLine struct {
	key string
}

func askLatestUser(recent []runtimeMsg) string {
	last := ""
	for _, m := range recent {
		text := strings.TrimSpace(m.Content)
		if m.Role != "user" || colleagueNoteName(text) != "" {
			continue
		}
		last = askRouteUtterance(text)
	}
	return last
}

func askDecisionState(latest, convo string) string {
	latest = clipRunes(oneLine(latest), askRouteLatestRunes)
	header := "当前：" + latest + "\n（以下仅助解指代，勿作指派依据）\n会话：\n"
	return fitAskState(header, convo, askRouteDecisionRunes)
}

func askNoneCriteria(agent *db.Agent) string {
	job := askSelfJobText(agent)
	if job == "" {
		return askNoneCriteriaLead
	}
	// Routing defaults lead. The job is only a clipped tail.
	return askNoneCriteriaLead + clipRunes(job, askNoneJobRunes)
}

func askPeerCriteria(desc string) string {
	trigger := clipRunes(oneLine(desc), askCriteriaTriggerRunes)
	return "仅当最新句明确需要：" + trigger + "。本职能做或未点名则勿选。勿因历史曾转而选。"
}

func askDecisionRules(choices []askChoiceLine) string {
	var b strings.Builder
	b.WriteString("只判断「当前：」后最新用户句。历史仅解指代，不当作任务，不得因曾转某同事再选。")
	b.WriteString("优先级：1) 本轮明确点名/@某同事→选对应 cN；仅提及、引用旧回复、闲聊不算指派。")
	b.WriteString("2) 同事职责明确匹配且本职盖不住→该 cN。")
	b.WriteString("3) 本职能做、两边都能做、闲聊、模糊、超出本职也无明确对口→none。不确定选 none。")
	b.WriteString("选项：")
	for _, c := range choices {
		b.WriteString(c.key + " ")
	}
	b.WriteString("none。只输出选项，无解释。")
	return b.String()
}

// askTargetFromAnswers maps a decision choice onto one colleague id.
// none and unknown keys stay. Laya's confidence is 1 minus the entropy of the
// choice distribution, so a 0.72/0.28 split scores about 0.15. The chosen
// option's own probability is what the floor compares.
func askTargetFromAnswers(answers map[string]any, keyToID map[string]string) string {
	raw, _ := answers["ask"].(map[string]any)
	if raw == nil {
		return ""
	}
	choice := strings.TrimSpace(fmt.Sprint(raw["choice"]))
	if choice == "" || choice == "<nil>" || strings.EqualFold(choice, "none") {
		return ""
	}
	if !askChoiceClearsFloor(raw, choice) {
		return ""
	}
	return strings.TrimSpace(keyToID[choice])
}

func askChoiceClearsFloor(raw map[string]any, choice string) bool {
	score, ok := answerConfidence(raw["confidence"])
	if p, has := choiceProbability(raw["probabilities"], choice); has && p > score {
		score = p
		ok = true
	}
	if !ok {
		return true
	}
	return score >= askHandoffConfidenceFloor
}

func choiceProbability(v any, choice string) (float64, bool) {
	probs, _ := v.(map[string]any)
	if probs == nil {
		if typed, ok := v.(map[string]string); ok {
			return answerConfidence(typed[choice])
		}
		return 0, false
	}
	return answerConfidence(probs[choice])
}

func answerConfidence(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func askPeerCandidates(selfID string, agents []*db.Agent) []*db.Agent {
	selfID = strings.TrimSpace(selfID)
	var out []*db.Agent
	for _, a := range agents {
		if a == nil || strings.TrimSpace(a.ID) == "" || a.ID == selfID {
			continue
		}
		if strings.TrimSpace(a.Description) == "" {
			continue
		}
		out = append(out, a)
		if len(out) >= peerRosterMax {
			break
		}
	}
	return out
}

func askSelfJobText(agent *db.Agent) string {
	if agent == nil {
		return ""
	}
	if desc := strings.TrimSpace(agent.Description); desc != "" {
		return oneLine(desc)
	}
	if prompt := strings.TrimSpace(agent.SystemPrompt); prompt != "" {
		return oneLine(prompt)
	}
	return ""
}

func splitAskContext(history []runtimeMsg) (summary string, recent []runtimeMsg) {
	last := -1
	for i, m := range history {
		if m.Role == "summary" {
			last = i
		}
	}
	if last >= 0 {
		summary = strings.TrimSpace(history[last].Content)
		recent = history[last+1:]
	} else {
		recent = history
	}
	if len(recent) > askRouteRecentMax {
		recent = recent[len(recent)-askRouteRecentMax:]
	}
	return summary, recent
}

// askConversationBlock is the conversation the choice model sees, and the brief
// a chosen colleague receives. Replies and the rolling summary stay in. Inlined
// file bodies stay out. Colleague notes are labeled as that colleague.
func askConversationBlock(summary string, recent []runtimeMsg) string {
	var lines []string
	if strings.TrimSpace(summary) != "" {
		lines = append(lines, "[摘要] "+clipRunes(oneLine(summary), askRouteMsgRunes))
	}
	for _, m := range recent {
		label, text, ok := handoffLine(m)
		if !ok {
			continue
		}
		lines = append(lines, label+"："+clipRunes(oneLine(text), askRouteMsgRunes))
	}
	if len(lines) == 0 {
		return "（没有更早的对话）"
	}
	return strings.Join(lines, "\n")
}

// fitAskState keeps the header and the newest conversation lines when the
// choice text is over the cap. Clipping the tail would drop the user's latest ask.
func fitAskState(header, convo string, limit int) string {
	header = strings.TrimRight(header, "\n") + "\n"
	lines := strings.Split(convo, "\n")
	for len(lines) > 1 && runeLen(header+strings.Join(lines, "\n")) > limit {
		lines = lines[1:]
	}
	body := strings.Join(lines, "\n")
	state := header + body
	if runeLen(state) <= limit {
		return state
	}
	room := limit - runeLen(header)
	if room < 1 {
		return clipRunes(header, limit)
	}
	tail := []rune(body)
	if len(tail) > room {
		tail = tail[len(tail)-room:]
	}
	return header + string(tail)
}

func runeLen(s string) int {
	return len([]rune(s))
}

func handoffLine(m runtimeMsg) (label, text string, ok bool) {
	text = strings.TrimSpace(m.Content)
	if text == "" {
		return "", "", false
	}
	switch m.Role {
	case "assistant":
		return "助手", text, true
	case "user":
		if name := colleagueNoteName(text); name != "" {
			body := text
			if i := strings.Index(text, "】"); i >= 0 {
				body = strings.TrimSpace(text[i+len("】"):])
			}
			if body == "" {
				return "", "", false
			}
			return "同事" + name, body, true
		}
		return "用户", askRouteUtterance(text), true
	default:
		return "", "", false
	}
}

func askColleagueQuestion(summary string, recent []runtimeMsg) string {
	lastUser := ""
	for _, m := range recent {
		text := strings.TrimSpace(m.Content)
		if m.Role != "user" || colleagueNoteName(text) != "" {
			continue
		}
		lastUser = askRouteUtterance(text)
	}
	block := askConversationBlock(summary, recent)
	if lastUser == "" {
		return clipRunes(block, askRouteQuestionMax)
	}
	return clipRunes("会话上下文：\n"+block+"\n\n请处理用户刚说的："+lastUser, askRouteQuestionMax)
}

// askRouteUtterance drops inlined file bodies. Colleague choice follows the
// user's ask and the filename, not the document text.
func askRouteUtterance(text string) string {
	const marker = "以下为用户文件正文"
	if i := strings.Index(text, marker); i >= 0 {
		return strings.TrimSpace(text[:i])
	}
	return text
}

// colleagueNoteName reads the label written by formatOtherAgentHistoryNote.
// Those rows stay role=user for the chat model, so the decision view must not
// present them as the user naming that colleague.
func colleagueNoteName(content string) string {
	text := strings.TrimSpace(content)
	if !strings.HasPrefix(text, "【") {
		return ""
	}
	end := strings.Index(text, "】")
	if end <= len("【") || end > 40 {
		return ""
	}
	name := strings.TrimSpace(text[len("【"):end])
	if name == "" || strings.HasPrefix(name, "回复") {
		return ""
	}
	return name
}

func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func selfIDOf(agent *db.Agent) string {
	if agent == nil {
		return ""
	}
	return agent.ID
}

func payloadAskDepth(payload map[string]any) int {
	switch v := payload["ask_depth"].(type) {
	case int:
		return v
	case float64:
		return int(v)
	default:
		return 0
	}
}

func payloadHistory(payload map[string]any) []runtimeMsg {
	switch v := payload["messages"].(type) {
	case []runtimeMsg:
		return v
	default:
		return nil
	}
}

func payloadString(payload map[string]any, key string) string {
	s, _ := payload[key].(string)
	return strings.TrimSpace(s)
}

// payloadOnboarding is set by the client when this turn is the job card
// (or a custom answer on that card). The user is telling this bot what to
// focus on, so the turn stays with it.
func payloadOnboarding(payload map[string]any) bool {
	if payload == nil {
		return false
	}
	on, _ := payload["onboarding"].(bool)
	return on
}

// applyAskRouteResult shows the colleague reply in the parent model history
// and stops this turn from asking again or redoing the work.
func applyAskRouteResult(payload map[string]any, colleagueName, reply string, needsUser bool) {
	if payload == nil || strings.TrimSpace(reply) == "" {
		return
	}
	history := append([]runtimeMsg{}, payloadHistory(payload)...)
	history = append(history, runtimeMsg{
		Role:    "user",
		Content: formatOtherAgentHistoryNote(colleagueName, reply),
	})
	payload["messages"] = history
	note := askRoutedNote
	if needsUser {
		note = askRoutedNeedUserNote
	}
	system := payloadString(payload, "system_prompt")
	if system == "" {
		payload["system_prompt"] = note
	} else {
		payload["system_prompt"] = system + "\n\n" + note
	}
	payload["allow_ask_agent"] = false
	payload["ask_routed"] = true
}

// routeAskColleague decides once, before the parent run, whether this DM turn
// should ask one colleague. Provider off, timeout, or no match leaves the
// payload unchanged so the parent model can still call ask_agent itself.
func (s *Server) routeAskColleague(ctx context.Context, payload map[string]any) {
	if s == nil || s.db == nil || payload == nil {
		return
	}
	if payloadOnboarding(payload) {
		payload["allow_ask_agent"] = false
		return
	}
	channelID := payloadString(payload, "channel_id")
	allow, _ := payload["allow_ask_agent"].(bool)
	after, _ := payload["after_interrupt"].(bool)
	userID := payloadString(payload, "user_id")
	agentID := payloadString(payload, "agent_id")
	convID := payloadString(payload, "conversation_id")
	if userID == "" || agentID == "" || convID == "" {
		return
	}
	if channelID != "" || payloadAskDepth(payload) >= 1 || !allow || after {
		return
	}
	deps := s.decisionDepsForUser(userID, convID)
	provider := ""
	if deps != nil {
		provider = deps.Provider
	}
	agents, err := s.db.ListAgents(userID)
	if err != nil {
		log.Printf("ask_route list agents: %v", err)
		return
	}
	self, err := s.db.GetAgent(userID, agentID)
	if err != nil {
		log.Printf("ask_route get agent: %v", err)
		return
	}
	peers := askPeerCandidates(agentID, agents)
	if !askRouteShouldCall(channelID, payloadAskDepth(payload), allow, after, provider, len(peers)) {
		return
	}
	if deps == nil || deps.Decide == nil {
		return
	}
	pack, ok := buildAskDecision(self, peers, payloadHistory(payload))
	if !ok {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	dctx, cancel := context.WithTimeout(ctx, autoPickDecisionTimeout)
	answers, err := deps.Decide(dctx, pack.State, pack.Questions)
	cancel()
	if err != nil {
		log.Printf("ask_route decision err=%v", err)
		return
	}
	target := askTargetFromAnswers(answers, pack.KeyToID)
	if target == "" || target == agentID {
		return
	}
	requestID := payloadString(payload, "request_id")
	threadID := convID
	if requestID != "" {
		threadID = convID + ":" + requestID
	}
	actx, acancel := context.WithTimeout(ctx, 8*time.Minute)
	defer acancel()
	out, _, err := s.askAgent(actx, askAgentBody{
		UserID:               userID,
		FromAgentID:          agentID,
		ToAgentID:            target,
		Question:             pack.Question,
		ParentConversationID: convID,
		ParentThreadID:       threadID,
	})
	if err != nil {
		log.Printf("ask_route ask err=%v", err)
		return
	}
	reply, _ := out["reply"].(string)
	if strings.TrimSpace(reply) == "" {
		return
	}
	needsUser, _ := out["needs_user"].(bool)
	name := target
	if peer, gerr := s.db.GetAgent(userID, target); gerr == nil && peer != nil && strings.TrimSpace(peer.Name) != "" {
		name = peer.Name
	}
	applyAskRouteResult(payload, name, reply, needsUser)
}
