package httpserver

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"strings"
	"unicode"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const (
	autoPickDefaultK        = 1
	autoPickMaxK            = 3
	autoPickConfidenceFloor = 0.4 // below → fail-open to lead
)

// groupAutoPickResult is the A-tier heuristic (or fail-open) outcome for a no-@ turn.
type groupAutoPickResult struct {
	AgentIDs   []string
	Confidence float64
	Method     string // "heuristic"
	Fallback   string // "" | "lead" | "all"
	// LeadFallback marks agents that get the hard must-answer / no-[PASS] participation
	// prompt. Set for: true all-hands (choice=all / full roster), intentional must-answer
	// (lead fail-open, second fail-open), and who-can capable picks (census answerers must
	// speak). Specialty / broad fail-open-all do NOT set this — selected bots keep
	// candidacy [PASS] when off-topic / mis-selected.
	LeadFallback map[string]bool
	// AllowSecondFailOpen: if every AutoPick candidate PASS-es, run lead (or all).
	// False for who-can / specialty / all-hands so PASS cannot dump incapable peers.
	AllowSecondFailOpen bool
	// TaskIntentJudged: decide classified this turn against the group's open background
	// task (intent head saw it). The send gate then uses CancelOpenTask instead of the
	// legacy cancel-phrase check (「加个暂停键」 is a feature ask, not stop).
	TaskIntentJudged bool
	// CancelOpenTask: the model classified this turn as "stop the background task".
	CancelOpenTask bool
}

func clampAutoPickK(k int) int {
	if k <= 0 {
		return autoPickDefaultK
	}
	if k > autoPickMaxK {
		return autoPickMaxK
	}
	return k
}

// groupHasExplicitAddressing is true when @ / @everyone / a proper subset of client
// agent_ids already chose targets. AutoPick must never replace those forced sets.
//
// Legacy web clients send every channel member as agent_ids on no-@ turns ("all
// candidates, each may PASS"). That full-member dump is NOT explicit addressing —
// treating it as such skipped AutoPick and ran every bot (duplicate UX + wrong pick).
func groupHasExplicitAddressing(content string, explicit []string, members []string, agents []*db.Agent) bool {
	if mentionIncludesEveryone(content) {
		return true
	}
	if len(resolveMentionedAgents(parseMentionTokens(content), members, agents)) > 0 {
		return true
	}
	memberSet := map[string]struct{}{}
	for _, m := range members {
		m = strings.TrimSpace(m)
		if m != "" {
			memberSet[m] = struct{}{}
		}
	}
	if len(memberSet) == 0 {
		return false
	}
	seen := map[string]struct{}{}
	n := 0
	for _, id := range explicit {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := memberSet[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		n++
	}
	if n == 0 {
		return false
	}
	// Full-member dump = legacy candidate list; AutoPick still applies.
	if n == len(memberSet) {
		return false
	}
	return true
}

// autoPickHeuristic picks ≤K members by keyword / role-description match; else fail-open to lead.
// No extra LLM. leadID is conv.AgentID / group lead assistant.
func autoPickHeuristic(userText string, members []string, agents []*db.Agent, leadID string, k int, synopsis string) groupAutoPickResult {
	return autoPickHeuristicAs("heuristic", userText, members, agents, leadID, k, synopsis)
}

// autoPickHeuristicAs is autoPickHeuristic with an explicit log/Method label
// (e.g. "decision->heuristic" when B-tier fail-opens).
func autoPickHeuristicAs(method, userText string, members []string, agents []*db.Agent, leadID string, k int, synopsis string) groupAutoPickResult {
	k = clampAutoPickK(k)
	leadID = strings.TrimSpace(leadID)
	if strings.TrimSpace(method) == "" {
		method = "heuristic"
	}

	memberSet := map[string]struct{}{}
	for _, m := range members {
		memberSet[m] = struct{}{}
	}
	leadInMembers := false
	if leadID != "" {
		_, leadInMembers = memberSet[leadID]
	}

	failOpenAll := func() groupAutoPickResult {
		out := copyStringSlice(members)
		// Broad path: everyone is a candidate, but do not ban [PASS] — unrelated bots
		// must still be able to stay silent via candidacy. True all-hands uses
		// choice=all LeadFallback instead.
		log.Printf("auto_pick=%s ids=%v conf=0.00 fallback=all", method, out)
		return groupAutoPickResult{
			AgentIDs:            out,
			Confidence:          0,
			Method:              method,
			Fallback:            "all",
			LeadFallback:        map[string]bool{},
			AllowSecondFailOpen: false,
		}
	}
	failOpenLead := func() groupAutoPickResult {
		if !leadInMembers {
			return failOpenAll()
		}
		log.Printf("auto_pick=%s ids=%v conf=0.00 fallback=lead", method, []string{leadID})
		return groupAutoPickResult{
			AgentIDs:            []string{leadID},
			Confidence:          0,
			Method:              method,
			Fallback:            "lead",
			LeadFallback:        map[string]bool{leadID: true},
			AllowSecondFailOpen: true,
		}
	}

	byID := map[string]*db.Agent{}
	for _, a := range agents {
		if a != nil {
			byID[a.ID] = a
		}
	}

	haystack := strings.ToLower(strings.TrimSpace(userText))
	// Score the raw ask only. Do not blend Recent-context synopsis: peer intros / prior
	// specialty talk falsely mark the wrong role capable. Decision mode uses structured
	// turn context for follow-up continuity instead of synopsis keyword bleed.
	_ = synopsis
	if haystack == "" {
		return failOpenLead()
	}

	type scored struct {
		id    string
		score int
	}
	var ranked []scored
	for _, id := range members {
		a := byID[id]
		name := id
		role := ""
		if a != nil {
			if n := strings.TrimSpace(a.Name); n != "" {
				name = n
			}
			role = groupParticipationRoleHint(a)
		}
		sc := scoreAutoPickMatch(haystack, name, role)
		if sc > 0 {
			ranked = append(ranked, scored{id: id, score: sc})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].id < ranked[j].id
	})

	if len(ranked) == 0 {
		return failOpenLead()
	}

	best := ranked[0].score
	conf := autoPickConfidence(best)
	if conf < autoPickConfidenceFloor {
		return failOpenLead()
	}

	n := k
	if n > len(ranked) {
		n = len(ranked)
	}
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		ids = append(ids, ranked[i].id)
	}
	// Heuristic has no synonym / who-can phrase tables: keep soft K, candidacy [PASS],
	// and second-wave fail-open. Decision mode owns who-can / specialty via model intent.
	leadFB := map[string]bool{}
	allowSecond := true
	log.Printf("auto_pick=%s ids=%v conf=%.2f fallback=", method, ids, conf)
	return groupAutoPickResult{
		AgentIDs:            ids,
		Confidence:          conf,
		Method:              method,
		Fallback:            "",
		LeadFallback:        leadFB,
		AllowSecondFailOpen: allowSecond,
	}
}


func autoPickConfidence(bestScore int) float64 {
	if bestScore <= 0 {
		return 0
	}
	// 1 → 0.55, 2 → 0.75, 3+ → 0.95
	c := 0.35 + 0.20*float64(bestScore)
	if c > 0.95 {
		c = 0.95
	}
	return c
}

// scoreAutoPickMatch scores how well name/role fit the user haystack (lowercased).
func scoreAutoPickMatch(haystack, name, role string) int {
	score := 0
	nameL := strings.ToLower(strings.TrimSpace(name))
	roleL := strings.ToLower(strings.TrimSpace(role))

	if nameL != "" && len([]rune(nameL)) >= 2 && strings.Contains(haystack, nameL) {
		score += 3
	}

	for _, tok := range tokenizeRoleHints(roleL) {
		if strings.Contains(haystack, tok) {
			score += 2
		}
	}
	for _, tok := range tokenizeUserNeedles(haystack) {
		if roleL != "" && strings.Contains(roleL, tok) {
			score += 1
		}
		if nameL != "" && strings.Contains(nameL, tok) {
			score += 1
		}
	}

	return score
}

func tokenizeRoleHints(role string) []string {
	role = strings.TrimSpace(role)
	if role == "" {
		return nil
	}
	parts := strings.FieldsFunc(role, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r) || r == '、' || r == '，' || r == '/' || r == '|' || r == '：' || r == ':'
	})
	seen := map[string]struct{}{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(strings.ToLower(s))
		if s == "" || len([]rune(s)) < 2 {
			return
		}
		if autoPickRoleHintStopword(s) {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	for _, p := range parts {
		add(p)
		runes := []rune(p)
		if len(runes) >= 4 {
			for i := 0; i+2 <= len(runes) && i < 8; i++ {
				add(string(runes[i : i+2]))
			}
		}
	}
	return out
}

func tokenizeUserNeedles(haystack string) []string {
	var out []string
	seen := map[string]struct{}{}
	add := func(s string) {
		s = strings.ToLower(strings.TrimSpace(s))
		if len([]rune(s)) < 2 {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	var buf []rune
	flushLatin := func() {
		if len(buf) >= 2 {
			add(string(buf))
		}
		buf = buf[:0]
	}
	for _, r := range haystack {
		switch {
		case unicode.IsLetter(r) && r < 0x80:
			buf = append(buf, unicode.ToLower(r))
		case unicode.Is(unicode.Han, r):
			flushLatin()
			buf = append(buf, r)
			if len(buf) >= 2 {
				add(string(buf[len(buf)-2:]))
			}
			if len(buf) > 6 {
				buf = buf[len(buf)-4:]
			}
		default:
			flushLatin()
			buf = buf[:0]
		}
	}
	flushLatin()
	return out
}

// autoPickRoleHintStopword drops generic tokens that appear in nearly every
// Chinese agent blurb (「负责…»). Matching them against role text falsely marks
// every member "capable".
func autoPickRoleHintStopword(tok string) bool {
	switch tok {
	case "负责", "主要", "进行", "可以", "需要", "输出", "以及", "或者",
		"自己", "用户", "问题", "回答", "尽量", "相关", "工作", "任务",
		"帮助", "提供", "成员", "助手", "机器人", "能力", "内容", "信息":
		return true
	default:
		return false
	}
}

func copyStringSlice(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, len(in))
	copy(out, in)
	return out
}

// secondFailOpenTargets chooses who runs after AutoPick candidates all PASS.
// Prefer lead if in members and not already tried; else remaining members.
func secondFailOpenTargets(members []string, alreadyRan []string, leadID string) (targets []string, leadFallback map[string]bool, fallback string) {
	leadFallback = map[string]bool{}
	ran := map[string]struct{}{}
	for _, id := range alreadyRan {
		ran[id] = struct{}{}
	}
	leadID = strings.TrimSpace(leadID)
	memberSet := map[string]struct{}{}
	for _, m := range members {
		memberSet[m] = struct{}{}
	}
	if leadID != "" {
		if _, ok := memberSet[leadID]; ok {
			if _, did := ran[leadID]; !did {
				leadFallback[leadID] = true
				return []string{leadID}, leadFallback, "lead"
			}
		}
	}
	var rest []string
	for _, m := range members {
		if _, did := ran[m]; !did {
			rest = append(rest, m)
		}
	}
	if len(rest) == 0 {
		return nil, leadFallback, "all"
	}
	for _, id := range rest {
		leadFallback[id] = true
	}
	return rest, leadFallback, "all"
}

// displayNamesForAgents returns member display names (no agent_id) for debug UI.
func displayNamesForAgents(ids []string, agents []*db.Agent) []string {
	byID := map[string]*db.Agent{}
	for _, a := range agents {
		if a != nil {
			byID[a.ID] = a
		}
	}
	var names []string
	for _, id := range ids {
		name := id
		if a := byID[id]; a != nil {
			if n := strings.TrimSpace(a.Name); n != "" {
				name = n
			}
		}
		names = append(names, name)
	}
	return names
}

// orgAutoPickMode reads feature_flags_json.auto_pick as off|heuristic|decision.
// Missing key → heuristic. Legacy bool true→heuristic, false→off.
func orgAutoPickMode(flagsJSON string) string {
	flagsJSON = strings.TrimSpace(flagsJSON)
	if flagsJSON == "" || flagsJSON == "{}" {
		return db.AutoPickHeuristic
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(flagsJSON), &m); err != nil {
		return db.AutoPickHeuristic
	}
	v, ok := m["auto_pick"]
	if !ok {
		return db.AutoPickHeuristic
	}
	mode, err := db.ParseAutoPickMode(v)
	if err != nil || mode == "" {
		return db.AutoPickHeuristic
	}
	return mode
}

// orgAutoPickEnabled is true when org mode is not off (legacy helper).
func orgAutoPickEnabled(flagsJSON string) bool {
	return orgAutoPickMode(flagsJSON) != db.AutoPickOff
}

// runAutoPickByMode applies org auto_pick mode for a no-@ turn.
// Decision always calls SystemOne: schema includes opaque "all" + mN + count;
// the decide prompt classifies all-hands vs who-can vs specialty (no phrase-list gate).
// multi/count may raise effective K up to members so the model can return a subset / all.
// On parse/timeout/empty/low-conf/off fail-open to heuristic (not lead-only).
// Heuristic has no all-hands / who-can / synonym phrase tables — decision mode is the
// product path (model intent + member profiles); heuristic is token match on name/role only.
func runAutoPickByMode(mode, userText string, members []string, agents []*db.Agent, leadID string, k int, synopsis string, deps *autoPickDecisionDeps) groupAutoPickResult {
	return runAutoPickByModeWithTurns(mode, userText, members, agents, leadID, k, synopsis, deps, nil)
}

// runAutoPickByModeWithTurns is runAutoPickByMode with structured turn context for decide
// (prior turns + answerers, reply_to, open background task). Heuristic ignores tc.
func runAutoPickByModeWithTurns(mode, userText string, members []string, agents []*db.Agent, leadID string, k int, synopsis string, deps *autoPickDecisionDeps, tc *autoPickTurnContext) groupAutoPickResult {
	mode = db.NormalizeAutoPickMode(mode)
	switch mode {
	case db.AutoPickDecision:
		if pick, ok := autoPickDecisionWithTurns(context.Background(), deps, userText, members, agents, k, synopsis, tc); ok {
			return pick
		}
		// Decide failed (timeout/parse/low-conf/off). Specialty heuristic keeps capable
		// subsets; empty/lead-only expands to all + LeadFallback so a slow SystemOne that
		// would have returned choice=all (Langfuse cf23 「大家好」 7.3s vs 8s client
		// timeout) does not collapse the room to a single lead reply.
		h := autoPickHeuristicAs("decision->heuristic", userText, members, agents, leadID, k, synopsis)
		// Lead-only still expands to all (cf23 all-hands decide timeout) so the room is
		// not collapsed to a single lead. Do NOT LeadFallback everyone: this is a broad
		// path when intent is unknown — unrelated bots must still [PASS] via candidacy.
		// True all-hands with successful choice=all still LeadFallbacks. A single
		// specialty hit recovered via Recent-context synopsis (FOLLOW-UP + prior specialty
		// USER ask) must NOT be dumped to everyone — that is the fail-open-all trap.
		// No synonym / who-can phrase gates: keep a confident heuristic specialty hit;
		// expand lead / low-confidence singles to the whole room (all-hands decide timeout).
		if h.Fallback == "lead" || (len(h.AgentIDs) <= 1 && len(members) > 1 && h.Confidence < autoPickConfidenceFloor) {
			out := copyStringSlice(members)
			log.Printf("auto_pick=decision->heuristic ids=%v conf=0.00 fallback=all note=decide_fail_all_hands_failopen", out)
			return groupAutoPickResult{
				AgentIDs:            out,
				Confidence:          0,
				Method:              "decision->heuristic",
				Fallback:            "all",
				LeadFallback:        map[string]bool{},
				AllowSecondFailOpen: false,
			}
		}
		return h
	default: // heuristic
		return autoPickHeuristic(userText, members, agents, leadID, k, synopsis)
	}
}

// recentMessagesSynopsis builds Recent context for decide state:
// prior USER turns + last answering bot(s) (name — role). Not raw keyword needles —
// FOLLOW-UP continuity comes from who spoke last and what the user asked before.
// Skip the trailing current-user message (already in "User message:"). Markup-heavy
// bot bodies are omitted from text slots, but the answering bot identity is still
// recorded so decide sees specialty continuity (e.g. coder answered with SVG).
func recentMessagesSynopsis(msgs []db.Message, maxMsgs int, agents []*db.Agent) string {
	if maxMsgs <= 0 {
		maxMsgs = 2
	}
	if len(msgs) == 0 {
		return ""
	}
	byID := map[string]*db.Agent{}
	for _, a := range agents {
		if a != nil {
			byID[a.ID] = a
		}
	}
	end := len(msgs)
	// Just-saved current turn is already the decide "User message:"; omit it so
	// the synopsis budget goes to prior turns (esp. prior user specialty asks).
	if end > 0 && strings.EqualFold(strings.TrimSpace(msgs[end-1].Role), "user") {
		end--
	}
	if end <= 0 {
		return ""
	}
	lookback := maxMsgs * 4
	if lookback < 8 {
		lookback = 8
	}
	start := end - lookback
	if start < 0 {
		start = 0
	}
	window := msgs[start:end]

	var userParts []string
	var lastAnswerers []string // newest-first display labels
	seenAnswerer := map[string]struct{}{}
	for i := len(window) - 1; i >= 0; i-- {
		m := window[i]
		c := strings.TrimSpace(m.Content)
		if c == "" || isGroupPassReply(c) {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(m.Role))
		if role == "user" {
			snippet := synopsisClip(c, role)
			if snippet == "" {
				continue
			}
			userParts = append(userParts, "User: "+snippet)
			if len(userParts) >= maxMsgs {
				// Still scan remaining for last answerers if we have none yet.
				if len(lastAnswerers) > 0 {
					break
				}
			}
			continue
		}
		// Assistant / bot turn: record who answered (even if body is markup-heavy).
		aid := strings.TrimSpace(m.AgentID)
		if aid != "" {
			if _, did := seenAnswerer[aid]; !did {
				seenAnswerer[aid] = struct{}{}
				lastAnswerers = append(lastAnswerers, synopsisAgentLabel(aid, byID[aid]))
			}
		}
		if len(userParts) >= maxMsgs && len(lastAnswerers) > 0 {
			break
		}
	}

	var parts []string
	// Chronological user turns first (collected newest-first).
	for i := len(userParts) - 1; i >= 0; i-- {
		parts = append(parts, userParts[i])
	}
	if len(lastAnswerers) > 0 {
		// lastAnswerers is newest-first. Show only the single newest answerer so
		// FOLLOW-UP sticky rules have one clear mN target (dual peers as equal
		// sticky targets caused RPG follow-ups to re-specialize off 代码).
		parts = append(parts, "Last answered by: "+lastAnswerers[0])
	}
	return strings.Join(parts, " | ")
}

func synopsisAgentLabel(id string, a *db.Agent) string {
	name := id
	role := ""
	if a != nil {
		if n := strings.TrimSpace(a.Name); n != "" {
			name = n
		}
		role = strings.TrimSpace(groupParticipationRoleHint(a))
	}
	if role == "" {
		return name
	}
	// Keep label short for synopsis budget.
	runes := []rune(role)
	if len(runes) > 24 {
		role = string(runes[:24]) + "…"
	}
	return name + " — " + role
}

func synopsisClip(content, role string) string {
	limit := 80
	if role != "user" {
		limit = 40
	}
	runes := []rune(content)
	if len(runes) > limit {
		return string(runes[:limit]) + "…"
	}
	return content
}
