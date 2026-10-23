package httpserver

import (
	"fmt"
	"sort"
	"strings"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Structured turn context for group Auto选人.
//
// The decision model — not phrase lists, regexes or length thresholds — decides
// whether the current message continues an earlier turn. The API only supplies
// structured facts it already owns:
//   - prior user turns (t1..tN, oldest→newest) and which member bots answered each
//     (from message role/agent_id order, not from text);
//   - the explicit quote target (reply_to_id) when the user clicked「回复」;
//   - member profiles (opaque mN keys).
//
// Extra decide questions:
//   - intent: follow_up | new_ask | all_hands | who_can
//   - bound:  t1..tN | none (which prior turn a follow-up continues)
//
// Post-processing (autoPickApplyTurnIntent) maps intent=follow_up + bound=tK to the
// bots that answered tK (sticky), and intent=who_can to the capable-census mapping.

const (
	autoPickIntentQKey = "intent"
	autoPickBoundQKey  = "bound"
	autoPickBoundNone  = "none"
	autoPickBoundTask  = "task" // the group's open background task (conversation_tasks)

	autoPickIntentFollowUp = "follow_up"
	autoPickIntentNewAsk   = "new_ask"
	autoPickIntentAllHands = "all_hands"
	autoPickIntentWhoCan   = "who_can"
	autoPickIntentCancel   = "cancel_task" // only offered while a background task is open

	autoPickTurnContextMax = 8  // prior user turns offered as bound targets
	autoPickTurnTextClip   = 60 // runes per prior user text in decide state

	// autoPickIntentStrongConf: the intent head overrules the pick head (reject "all" for
	// a single-task turn, honour a task-cancel) only when clearly decided — a majority,
	// not just above the generic floor.
	autoPickIntentStrongConf = 0.6
	// autoPickAllHandsStrongConf: waking the whole room needs near-certainty from one
	// head (intent=all_hands, or pick=all when the intent head is undecided). After an
	// all-hands turn the small decide model leaks all_hands into the next asks at ~0.5–0.6.
	autoPickAllHandsStrongConf = 0.8
	// autoPickCancelStrongConf: stopping background work is destructive; the small decide
	// model scored 「做好了吗？顺便加一个暂停键」 as cancel_task at 0.69, so require near-certainty.
	// Below it the turn is a task follow-up (queued to the owner); the UI stop button stays.
	autoPickCancelStrongConf = 0.8
)

// autoPickTurn is one prior user message plus the member bots that answered it.
type autoPickTurn struct {
	Key       string
	UserMsgID string
	UserText  string
	// AnswerIDs: bots that replied to this turn (first-reply order, no [PASS]).
	AnswerIDs []string
	// MessageIDs: user + answer message ids in this turn (reply_to lookup).
	MessageIDs []string
}

// autoPickTurnContext is the structured Recent context for decide.
type autoPickTurnContext struct {
	Turns []autoPickTurn
	// ReplyToTurn is the turn key containing the explicitly quoted message (reply_to_id).
	ReplyToTurn string
	// ReplyToAgentID is the bot that authored the quoted message ("" when the user quoted
	// their own message or the quote is outside the offered turns).
	ReplyToAgentID string
	// OpenTask is the group's queued/running background task (后台续跑), when any.
	OpenTask *autoPickOpenTask
}

// autoPickOpenTask is a structured pointer to pending background work in the group.
type autoPickOpenTask struct {
	AgentID string
	Goal    string
	// Status is queued|running from conversation_tasks (structured cancel vs follow_up signal).
	Status string
}

func (c *autoPickTurnContext) turn(key string) *autoPickTurn {
	if c == nil {
		return nil
	}
	for i := range c.Turns {
		if c.Turns[i].Key == key {
			return &c.Turns[i]
		}
	}
	return nil
}

// newestAnsweredTurn is the key of the latest turn some member answered ("" if none).
func (c *autoPickTurnContext) newestAnsweredTurn() string {
	if c == nil {
		return ""
	}
	for i := len(c.Turns) - 1; i >= 0; i-- {
		if len(c.Turns[i].AnswerIDs) > 0 {
			return c.Turns[i].Key
		}
	}
	return ""
}

// newestWasAllHands is true when the latest answered turn woke (nearly) the whole roster.
// Structured signal only — used to raise the bar for repeating all_hands on the next ask.
func (c *autoPickTurnContext) newestWasAllHands(memberCount int) bool {
	if c == nil || memberCount <= 1 {
		return false
	}
	t := c.turn(c.newestAnsweredTurn())
	if t == nil || len(t.AnswerIDs) == 0 {
		return false
	}
	return len(t.AnswerIDs) >= memberCount
}

// singleNewestAnswerers returns the bots that alone answered the newest turn, or nil when
// nobody / the whole room answered. Used for decide fail-open sticky (no phrase lists).
func (c *autoPickTurnContext) singleNewestAnswerers(members []string) []string {
	if c == nil || len(members) <= 1 {
		return nil
	}
	t := c.turn(c.newestAnsweredTurn())
	if t == nil || len(t.AnswerIDs) == 0 {
		return nil
	}
	memberSet := map[string]struct{}{}
	for _, m := range members {
		memberSet[strings.TrimSpace(m)] = struct{}{}
	}
	var ids []string
	for _, id := range t.AnswerIDs {
		if _, ok := memberSet[id]; ok {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 || len(ids) >= len(members) {
		return nil
	}
	return orderIDsByMembers(ids, members)
}

// buildAutoPickTurnContext groups the main timeline into user turns. The just-saved
// current user message (trailing user row) is excluded; it is the decide "User message".
func buildAutoPickTurnContext(msgs []db.Message, replyParent *db.Message, members []string, maxTurns int) *autoPickTurnContext {
	if maxTurns <= 0 {
		maxTurns = autoPickTurnContextMax
	}
	memberSet := map[string]struct{}{}
	for _, m := range members {
		memberSet[strings.TrimSpace(m)] = struct{}{}
	}
	end := len(msgs)
	if end > 0 && strings.EqualFold(strings.TrimSpace(msgs[end-1].Role), "user") {
		end--
	}
	var turns []autoPickTurn
	for _, m := range msgs[:end] {
		if strings.TrimSpace(m.ThreadRootID) != "" {
			continue // sidebar thread replies are not mainline turns
		}
		role := strings.ToLower(strings.TrimSpace(m.Role))
		content := strings.TrimSpace(m.Content)
		switch role {
		case "user":
			if content == "" {
				continue
			}
			turns = append(turns, autoPickTurn{UserMsgID: m.ID, UserText: content, MessageIDs: []string{m.ID}})
		case "assistant":
			if len(turns) == 0 {
				continue
			}
			t := &turns[len(turns)-1]
			t.MessageIDs = append(t.MessageIDs, m.ID)
			aid := strings.TrimSpace(m.AgentID)
			if aid == "" || content == "" || isGroupPassReply(content) {
				continue
			}
			if _, ok := memberSet[aid]; !ok {
				continue
			}
			dup := false
			for _, x := range t.AnswerIDs {
				if x == aid {
					dup = true
					break
				}
			}
			if !dup {
				t.AnswerIDs = append(t.AnswerIDs, aid)
			}
		}
	}
	if len(turns) > maxTurns {
		turns = turns[len(turns)-maxTurns:]
	}
	ctx := &autoPickTurnContext{}
	for i := range turns {
		turns[i].Key = fmt.Sprintf("t%d", i+1)
	}
	ctx.Turns = turns
	if replyParent != nil {
		pid := strings.TrimSpace(replyParent.ID)
		for _, t := range turns {
			for _, id := range t.MessageIDs {
				if id == pid {
					ctx.ReplyToTurn = t.Key
				}
			}
		}
		if strings.EqualFold(strings.TrimSpace(replyParent.Role), "assistant") {
			if aid := strings.TrimSpace(replyParent.AgentID); aid != "" {
				if _, ok := memberSet[aid]; ok {
					ctx.ReplyToAgentID = aid
				}
			}
		}
	}
	return ctx
}

// addTurnIntentQuestions adds intent/bound questions and the structured Recent turns
// block to the decide payload. idToKey maps agent_id → opaque mN.
func addTurnIntentQuestions(questions map[string]any, b *strings.Builder, tc *autoPickTurnContext, idToKey map[string]string, agents []*db.Agent) {
	if questions == nil || b == nil {
		return
	}
	hasTask := tc != nil && tc.OpenTask != nil && strings.TrimSpace(tc.OpenTask.AgentID) != ""
	hasTurns := tc != nil && (len(tc.Turns) > 0 || hasTask)
	intentCriteria := map[string]string{
		autoPickIntentFollowUp: "Asks the bot(s) that answered a listed turn to keep going on the SAME work: a why/how question about that answer, a tweak (shorter, change X, another version), a go-ahead (好/继续/next), or the next in-character move in a game/story that bot is hosting — including fictional look/read/pick-up actions inside that world (「我选择往左走」「我拿起火把看看墙上写了什么」「我打开箱子」). Those are NOT real-world research. e.g. 「为什么不能…」「再改短一点」「继续」「换成 MySQL 呢」",
		autoPickIntentNewAsk:   "A new real-world request that stands on its own — including a DIFFERENT kind of work about an earlier result (copywriting, design, research, planning for something built before) or an unrelated out-of-story question. e.g. 「今天天气怎么样」「给这个功能写篇推广文案」「帮我查一下2024年诺贝尔…」. Do NOT use new_ask for in-world adventure actions just because they mention reading or looking.",
		autoPickIntentAllHands: "The User message ITSELF explicitly asks EVERY member to speak (大家/各位/你们都/everyone): open call for everyone's views, self-intro round. e.g. 「大家都说说…」「你们都能干啥」「都介绍下自己」「everyone share your thoughts」. Judge only this message — a request for one piece of work or one host (「帮我想想下个版本做什么」「你来当主持人」) is NOT all_hands, even right after an all-hands turn.",
		autoPickIntentWhoCan:   "Asks WHICH member(s) can do one specific skill (capability census). e.g. 「谁会写代码」「谁能做设计」「who can write SQL」",
	}
	if hasTask {
		intentCriteria[autoPickIntentCancel] = "User wants the owner to ABANDON the background task listed below — stop working, do not deliver. Soft drop-offs count (「算了，后台那个先别做了」「这个先不做了」「别做了」「先停下」「取消吧」). NOT cancel_task: asking whether it is done, or requesting a NEW feature to add into that same task (「做好了吗」「加一个暂停键」「顺便加上…」) — those are follow_up bound=task."
	}
	if !hasTurns {
		// Nothing to continue — follow_up is not a valid class.
		delete(intentCriteria, autoPickIntentFollowUp)
	}
	questions[autoPickIntentQKey] = map[string]any{
		"type": "choice",
		"instructions": "Classify the User message relative to Recent turns. Judge meaning, not keywords: " +
			"a message that only makes sense as more of the same bot's work is follow_up " +
			"(including the player's next move while a member is hosting a game/story — even if that move says 看看/读/查 inside the fiction); " +
			"a self-contained real-world ask, or a different kind of work about an earlier result, is new_ask; " +
			"an open call for everyone to speak is all_hands; asking who can do a skill is who_can.",
		"criteria": intentCriteria,
	}
	if hasTurns {
		bound := map[string]string{
			autoPickBoundNone: "Not a continuation of any listed turn",
		}
		for _, t := range tc.Turns {
			bound[t.Key] = "Continues turn " + t.Key + ": 「" + clipRunes(t.UserText, autoPickTurnTextClip) + "」" + answeredBySuffix(t, idToKey, agents)
		}
		if hasTask {
			bound[autoPickBoundTask] = "Continues / adds to the background task " + memberKeyLabel(tc.OpenTask.AgentID, idToKey, agents) +
				" is still working on: 「" + clipRunes(tc.OpenTask.Goal, autoPickTurnTextClip) + "」"
		}
		questions[autoPickBoundQKey] = map[string]any{
			"type": "choice",
			"instructions": "If the User message continues an earlier turn, which turn's task does it continue? " +
				"Usually the newest related turn, but pick an older one when the message clearly refers back to it. " +
				"none when it is a new ask / all-hands / capability census.",
			"criteria": bound,
		}
	}

	if !hasTurns {
		return
	}
	b.WriteString("\n\nRecent turns (oldest → newest; who answered each):\n")
	for _, t := range tc.Turns {
		b.WriteString("- ")
		b.WriteString(t.Key)
		b.WriteString(" User: 「")
		b.WriteString(clipRunes(t.UserText, autoPickTurnTextClip))
		b.WriteString("」")
		if s := answeredBySuffix(t, idToKey, agents); s != "" {
			b.WriteString(s)
		} else {
			b.WriteString(" → no bot answered")
		}
		b.WriteString("\n")
	}
	if hasTask {
		b.WriteString("Background task still in progress")
		if st := strings.TrimSpace(tc.OpenTask.Status); st != "" {
			b.WriteString(" [")
			b.WriteString(st)
			b.WriteString("]")
		}
		b.WriteString(" (owner ")
		b.WriteString(memberKeyLabel(tc.OpenTask.AgentID, idToKey, agents))
		b.WriteString("): 「")
		b.WriteString(clipRunes(tc.OpenTask.Goal, autoPickTurnTextClip))
		b.WriteString("」 — messages that continue or add features to THAT goal → follow_up + bound=task (owner); " +
			"messages that abandon it → cancel_task (owner); unrelated new asks → best-matching member (task keeps running).\n")
	}
	if tc.ReplyToTurn != "" {
		b.WriteString("The user explicitly quoted (clicked reply on) a message from turn ")
		b.WriteString(tc.ReplyToTurn)
		if k := idToKey[tc.ReplyToAgentID]; k != "" {
			b.WriteString(" written by ")
			b.WriteString(k)
		}
		b.WriteString(".\n")
	}
	if tc.newestWasAllHands(len(idToKey)) {
		b.WriteString("NOTE: the newest answered turn was ALL-HANDS (every member spoke). " +
			"Do NOT default this turn to all_hands / choice=\"all\" unless the User message ITSELF explicitly asks everyone again; " +
			"a single specialty / host / product ask after an all-hands round is new_ask.\n")
	}
	b.WriteString("If the User message continues the SAME work of a listed turn, pick the bot that answered it; " +
		"if it asks for a different kind of work about that result (copy, design, research, planning), pick the member whose role fits that work. " +
		"intent=follow_up + a bound turn → stick to that turn's answerer mN (ignore specialty words that only appear inside the fiction or the tweak). " +
		"intent=new_ask → newest wins; prefer the specialty profile that matches the new deliverable over any prior sticky host.")
}

func answeredBySuffix(t autoPickTurn, idToKey map[string]string, agents []*db.Agent) string {
	if len(t.AnswerIDs) == 0 {
		return ""
	}
	if len(idToKey) > 1 && len(t.AnswerIDs) >= len(idToKey) {
		return " → answered by all members"
	}
	var labels []string
	for _, id := range t.AnswerIDs {
		labels = append(labels, memberKeyLabel(id, idToKey, agents))
	}
	return " → answered by " + strings.Join(labels, ", ")
}

// memberKeyLabel renders "mN Name" for decide state (opaque key + display name).
func memberKeyLabel(id string, idToKey map[string]string, agents []*db.Agent) string {
	name := id
	for _, a := range agents {
		if a != nil && a.ID == id && strings.TrimSpace(a.Name) != "" {
			name = strings.TrimSpace(a.Name)
			break
		}
	}
	if k := idToKey[id]; k != "" {
		return k + " " + name
	}
	return name
}

// autoPickTurnIntent is the parsed model classification for this turn.
type autoPickTurnIntent struct {
	Intent     string
	IntentConf float64
	Bound      string
	BoundConf  float64
}

func parseTurnIntent(answers map[string]any) autoPickTurnIntent {
	var out autoPickTurnIntent
	out.Intent, out.IntentConf = choiceAnswer(answers, autoPickIntentQKey)
	out.Bound, out.BoundConf = choiceAnswer(answers, autoPickBoundQKey)
	return out
}

func choiceAnswer(answers map[string]any, key string) (string, float64) {
	raw, _ := answers[key].(map[string]any)
	if raw == nil {
		return "", 0
	}
	choice := strings.TrimSpace(fmt.Sprint(raw["choice"]))
	if choice == "" || choice == "<nil>" {
		return "", 0
	}
	probs := map[string]float64{}
	if pRaw, ok := raw["probabilities"].(map[string]any); ok {
		for pk, pv := range pRaw {
			probs[pk] = asFloat64(pv)
		}
	}
	return choice, autoPickDecisionConfidence(raw, choice, probs)
}

// stickyFollowUpTargets returns the bots that should keep a follow-up, or nil when the
// model did not classify a confident follow-up bound to a turn answered by a strict
// subset of members. pickIDs (model's own pick) narrows multi-answer turns when it
// agrees with one of the answerers.
func stickyFollowUpTargets(ti autoPickTurnIntent, tc *autoPickTurnContext, members []string, pickIDs []string) []string {
	if tc == nil || ti.Intent != autoPickIntentFollowUp || ti.IntentConf < autoPickConfidenceFloor {
		return nil
	}
	boundKey := ti.Bound
	if boundKey == "" || boundKey == autoPickBoundNone || ti.BoundConf < autoPickConfidenceFloor {
		// Explicit quote is a structured bound when the model did not name one;
		// otherwise a confident follow-up continues the newest answered turn.
		boundKey = tc.ReplyToTurn
		if boundKey == "" {
			boundKey = tc.newestAnsweredTurn()
		}
	}
	if boundKey == autoPickBoundTask && tc.OpenTask != nil {
		if id := strings.TrimSpace(tc.OpenTask.AgentID); id != "" {
			for _, m := range members {
				if m == id {
					return []string{id}
				}
			}
		}
		return nil
	}
	t := tc.turn(boundKey)
	if t == nil || len(t.AnswerIDs) == 0 {
		return nil
	}
	answer := map[string]struct{}{}
	for _, id := range t.AnswerIDs {
		answer[id] = struct{}{}
	}
	// A follow-up to a whole-room turn is not a reason to wake everyone again
	// (choice=all stays explicit-only) — let the model's pick decide.
	if len(members) > 1 && len(answer) >= len(members) {
		return nil
	}
	// Quoted bot of this turn wins (structured reply_to).
	if tc.ReplyToTurn == t.Key && tc.ReplyToAgentID != "" {
		if _, ok := answer[tc.ReplyToAgentID]; ok {
			return []string{tc.ReplyToAgentID}
		}
	}
	var agree []string
	for _, id := range pickIDs {
		if _, ok := answer[id]; ok {
			agree = append(agree, id)
		}
	}
	if len(agree) > 0 {
		return orderIDsByMembers(agree, members)
	}
	return append([]string(nil), t.AnswerIDs...)
}

// turnIntentRejectsAll: the intent head is confident this turn is one task (new ask or
// follow-up), so a pick-head "all" must not wake the whole room.
func turnIntentRejectsAll(ti autoPickTurnIntent) bool {
	if ti.IntentConf < autoPickIntentStrongConf {
		return false
	}
	return ti.Intent == autoPickIntentNewAsk || ti.Intent == autoPickIntentFollowUp
}

// turnIntentWantsAll: the intent head is near-certain everyone should speak.
func turnIntentWantsAll(ti autoPickTurnIntent) bool {
	return ti.Intent == autoPickIntentAllHands && ti.IntentConf >= autoPickAllHandsStrongConf
}

// pickAllAllowed decides whether a pick-head choice=all may stand, given the intent head.
// No intent answer (legacy schema / provider ignored the question) keeps the old rule.
// priorAllHands: newest answered turn woke the whole roster — require near-certainty to
// repeat all_hands (small models leak all_hands at ~0.5–0.6 into the next specialty ask).
func pickAllAllowed(ti autoPickTurnIntent, pickAllConf float64, priorAllHands bool) bool {
	allHandsBar := autoPickIntentStrongConf
	if priorAllHands {
		allHandsBar = autoPickAllHandsStrongConf
	}
	switch {
	case ti.Intent == "":
		return true
	case ti.Intent == autoPickIntentWhoCan:
		return true // census mapping narrows "all" to the capable subset itself
	case ti.Intent == autoPickIntentAllHands && ti.IntentConf >= allHandsBar:
		return true
	case turnIntentRejectsAll(ti):
		return false
	}
	return pickAllConf >= autoPickAllHandsStrongConf
}

// answersWithoutAllChoice returns a copy of answers whose pick choice "all" is replaced by
// the most probable member key (mN), with member probabilities renormalised. ok=false when pick is not "all" or no mN has mass.
func answersWithoutAllChoice(answers map[string]any) (map[string]any, bool) {
	raw, _ := answers[autoPickDecisionQKey].(map[string]any)
	if raw == nil || !strings.EqualFold(strings.TrimSpace(fmt.Sprint(raw["choice"])), autoPickDecisionAllKey) {
		return answers, false
	}
	pRaw, _ := raw["probabilities"].(map[string]any)
	best, bestP := "", 0.0
	keys := make([]string, 0, len(pRaw))
	for k := range pRaw {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if strings.EqualFold(k, autoPickDecisionAllKey) {
			continue
		}
		if p := asFloat64(pRaw[k]); p > bestP {
			best, bestP = k, p
		}
	}
	if best == "" {
		return answers, false
	}
	pick := map[string]any{}
	for k, v := range raw {
		pick[k] = v
	}
	// Conditional distribution over members given "not everyone": renormalise mN mass.
	sum := 0.0
	for k, v := range pRaw {
		if !strings.EqualFold(k, autoPickDecisionAllKey) {
			sum += asFloat64(v)
		}
	}
	probs := map[string]any{}
	for k, v := range pRaw {
		if !strings.EqualFold(k, autoPickDecisionAllKey) && sum > 0 {
			probs[k] = asFloat64(v) / sum
		}
	}
	pick["choice"] = best
	pick["probabilities"] = probs
	delete(pick, "confidence") // the all-confidence does not transfer to the member
	out := map[string]any{}
	for k, v := range answers {
		out[k] = v
	}
	out[autoPickDecisionQKey] = pick
	// The count head sized the roster for "all"; let mapping re-derive from member probs.
	delete(out, autoPickDecisionCountKey)
	return out, true
}

// openTaskIntent maps the intent head onto the group's open background task:
// judged=true when decide saw the task; cancel=true when it classified "stop the task".
func openTaskIntent(ti autoPickTurnIntent, tc *autoPickTurnContext) (judged, cancel bool) {
	if tc == nil || tc.OpenTask == nil || strings.TrimSpace(tc.OpenTask.AgentID) == "" || ti.Intent == "" {
		return false, false
	}
	return true, ti.Intent == autoPickIntentCancel && ti.IntentConf >= autoPickCancelStrongConf
}
