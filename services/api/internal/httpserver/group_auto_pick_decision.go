package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

const (
	autoPickDecisionTimeout  = 20 * time.Second // Laya often 5–12s; 8s raced Langfuse cf23 (7.3s done → client timeout → lead-only)
	autoPickDecisionQKey     = "pick"
	autoPickDecisionCountKey = "count" // noul: how many should reply (→ 1..members)
	autoPickDecisionAllKey   = "all"   // opaque criteria: every member should reply
	autoPickAllHandsMaxK     = 8       // multi/all-hands ceiling; soft specialty K stays ≤ autoPickMaxK
)

// autoPickDecisionDeps wires the single selected decision backend + injectable decide.
// Provider is one of off|jev|laya|microsoft|custom (mutually exclusive).
// Nil Decide or provider off → caller fail-opens to heuristic.
type autoPickDecisionDeps struct {
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
	// Microsoft is true when Provider==microsoft and the Go-native client is bound.
	Microsoft bool
	// Decide posts state+questions and returns the answers map (DecisionResult.answers).
	// Tests inject a mock; production uses Microsoft client or Server.callRuntimeDecision.
	Decide func(ctx context.Context, state any, questions map[string]any) (map[string]any, error)
}

// decisionMemberCap is the max agents decision mapping may return (multi / all-hands).
func decisionMemberCap(memberCount int) int {
	capN := autoPickAllHandsMaxK
	if memberCount > 0 && memberCount < capN {
		capN = memberCount
	}
	if capN < 1 {
		return 1
	}
	return capN
}

// decisionEffectiveK keeps auto_pick_k as the soft specialty default (≤ autoPickMaxK).
// countHint (from noul, 1..members) may raise K up to min(members, autoPickAllHandsMaxK).
// All-hands is not phrase-gated: when the model returns choice=all / high count, mapping
// expands the roster; countHint is what raises K for multi / full-roster replies.
func decisionEffectiveK(k, memberCount int, countHint int) int {
	base := clampAutoPickK(k)
	capN := decisionMemberCap(memberCount)
	want := base
	if countHint > 0 {
		want = countHint
	}
	if want < 1 {
		want = 1
	}
	if want > capN {
		want = capN
	}
	if want < base {
		return base
	}
	return want
}

// autoPickDecision asks org decision model (choice + optional count) for members.
// Opaque criteria keys (m0..) map back to agent_ids; "all" → every candidate.
// count noul → how many (1..members); specialty soft K; multi/count may raise to members.
// Trusts model choice+count+probs. Decide state always feeds Member capability profiles;
// the prompt classifies ALL-HANDS / WHO-CAN / SPECIALTY / FOLLOW-UP (no isAllHandsIntent
// phrase gate; no SVG/HTML/anaphora needle tables). Thin structural safety: explicit
// choice=all (or mapping that already covers the full roster) → LeadFallback (hard
// no-[PASS]); who-can capable picks also LeadFallback (must answer) + close second-wave;
// specialty closes second-wave but does NOT LeadFallback (selected off-topic bots may
// still [PASS]). Underpick choice=mN is never expanded to the full
// roster via count≈N + probs[all] mass — only choice=all means everyone. Who-can may
// remap choice=all → capable subset; who-can / specialty mismatch vs Member capability
// profiles rematches or fail-opens. On soft failure the caller fail-opens to heuristic
// (not lead-only).
func autoPickDecision(ctx context.Context, deps *autoPickDecisionDeps, userText string, members []string, agents []*db.Agent, k int, synopsis string) (groupAutoPickResult, bool) {
	return autoPickDecisionWithTurns(ctx, deps, userText, members, agents, k, synopsis, nil)
}

// autoPickDecisionWithTurns is autoPickDecision with structured turn context (prior user
// turns + who answered each + reply_to). When tc is set, decide also answers intent
// (follow_up|new_ask|all_hands|who_can) and bound (t1..tN|none); a confident
// follow_up bound to a turn sticks to that turn's answerer(s) — the model classifies,
// the API never infers follow-up from phrases / lengths.
func autoPickDecisionWithTurns(ctx context.Context, deps *autoPickDecisionDeps, userText string, members []string, agents []*db.Agent, k int, synopsis string, tc *autoPickTurnContext) (groupAutoPickResult, bool) {
	method := "decision"
	if deps == nil {
		log.Printf("auto_pick=decision note=deps_nil_failopen_heuristic")
		return groupAutoPickResult{}, false
	}
	provider := db.NormalizeDecisionProvider(deps.Provider)
	if provider == "off" {
		log.Printf("auto_pick=decision note=provider_off_failopen_heuristic")
		return groupAutoPickResult{}, false
	}
	if deps.Decide == nil {
		log.Printf("auto_pick=decision note=decide_nil_failopen_heuristic")
		return groupAutoPickResult{}, false
	}

	// No pre-decide who-can / specialty phrase tables — the model classifies intent
	// (who_can | …) from member profiles + turn context; payload instructions always cover WHO-CAN.
	keyToID, questions, state := buildAutoPickDecisionPayloadWithTurns(userText, members, agents, synopsis, tc)
	if len(keyToID) == 0 {
		return groupAutoPickResult{}, false
	}

	if ctx == nil {
		ctx = context.Background()
	}
	dctx, cancel := context.WithTimeout(ctx, autoPickDecisionTimeout)
	defer cancel()

	answers, err := deps.Decide(dctx, state, questions)
	if err != nil {
		log.Printf("auto_pick=decision note=decide_err err=%v", err)
		return groupAutoPickResult{}, false
	}
	turnIntent := parseTurnIntent(answers)
	if tc != nil {
		log.Printf("auto_pick=decision intent=%s(%.2f) bound=%s(%.2f) reply_to=%s", turnIntent.Intent, turnIntent.IntentConf, turnIntent.Bound, turnIntent.BoundConf, tc.ReplyToTurn)
	}
	taskJudged, cancelTask := openTaskIntent(turnIntent, tc)
	if cancelTask {
		owner := strings.TrimSpace(tc.OpenTask.AgentID)
		log.Printf("auto_pick=decision note=cancel_open_task owner=%s intent=%s(%.2f)", owner, turnIntent.Intent, turnIntent.IntentConf)
		return groupAutoPickResult{
			AgentIDs:         []string{owner},
			Confidence:       turnIntent.IntentConf,
			Method:           method,
			LeadFallback:     map[string]bool{owner: true},
			TaskIntentJudged: true,
			CancelOpenTask:   true,
		}, true
	}
	// who_can comes from the model intent head (not a phrase list).
	whoCan := turnIntent.Intent == autoPickIntentWhoCan && turnIntent.IntentConf >= autoPickIntentStrongConf
	// Cross-check the pick head against the intent head (pickAllAllowed): "all" stands only
	// when the intent head agrees (all_hands / who_can) or is undecided and pick=all is
	// near-certain; otherwise narrow to the most probable member.
	pickRaw, _ := answers[autoPickDecisionQKey].(map[string]any)
	pickChoice, pickProbs := decisionPickMeta(answers)
	if !whoCan && pickRaw != nil && strings.EqualFold(pickChoice, autoPickDecisionAllKey) &&
		!pickAllAllowed(turnIntent, autoPickDecisionConfidence(pickRaw, pickChoice, pickProbs)) {
		if remapped, okr := answersWithoutAllChoice(answers); okr {
			log.Printf("auto_pick=decision note=all_rejected_by_intent intent=%s(%.2f)", turnIntent.Intent, turnIntent.IntentConf)
			answers = remapped
		}
	}
	countHint := countHintFromAnswers(answers, len(members))
	effectiveK := decisionEffectiveK(k, len(members), countHint)
	// Who-can census: allow multi from mN probs even when count says 1 (model often undershoots).
	// Explicit count still raises K; who-can also lifts K to member cap so mapping can keep all capable.
	if whoCan {
		capN := decisionMemberCap(len(members))
		if effectiveK < capN {
			effectiveK = capN
		}
	}
	// Explicit count (even 1) wins for specialty; who-can / omitted count may infer multi from probs.
	allowMultiFromProbs := countHint == 0 || whoCan
	ids, conf, allSelected, ok := mapDecisionChoiceToAgentIDs(answers, keyToID, members, effectiveK, allowMultiFromProbs, whoCan, countHint)
	choiceKey, probs := decisionPickMeta(answers)
	// No full_roster_count_expand: underpick choice=mN stays the mapped subset even when
	// count≈roster and probs[all] is high (Langfuse a0233dbd 「写个html…canvas」 shape).
	// Explicit choice=all is the only path that means everyone (mapping above).
	if !ok || len(ids) == 0 {
		log.Printf("auto_pick=decision note=parse_or_empty_failopen_heuristic choice=%s count=%d probs=%v", choiceKey, countHint, probs)
		return groupAutoPickResult{}, false
	}
	// FOLLOW-UP (model intent + bound turn): the bot(s) that answered the bound turn keep
	// the task. LeadFallback (must answer) + closed second-wave so a [PASS] cannot hand
	// the follow-up to an unrelated peer.
	if sticky := stickyFollowUpTargets(turnIntent, tc, members, ids); len(sticky) > 0 {
		if turnIntent.IntentConf > conf {
			conf = turnIntent.IntentConf
		}
		leadFB := map[string]bool{}
		for _, id := range sticky {
			leadFB[id] = true
		}
		log.Printf("auto_pick=%s ids=%v conf=%.2f choice=%s count=%d probs=%v note=follow_up_sticky bound=%s", method, sticky, conf, choiceKey, countHint, probs, turnIntent.Bound)
		return groupAutoPickResult{
			AgentIDs:            sticky,
			Confidence:          conf,
			Method:              method,
			LeadFallback:        leadFB,
			AllowSecondFailOpen: false,
			TaskIntentJudged:    taskJudged,
		}, true
	}
	// Intent head confidently says the whole room should speak → everyone (explicit
	// all-hands classification, even when the pick head parked on one mN).
	if !whoCan && !allSelected && turnIntentWantsAll(turnIntent) {
		ids = orderedDecisionMemberIDs(members, keyToID)
		allSelected = true
		if turnIntent.IntentConf > conf {
			conf = turnIntent.IntentConf
		}
		log.Printf("auto_pick=decision note=all_hands_by_intent intent=%s(%.2f)", turnIntent.Intent, turnIntent.IntentConf)
	}
	// Low pick confidence normally fail-opens to heuristic, which for an unclear ask
	// wakes the whole room. When the intent head answered and did not call this an
	// all-hands turn, keep the pick head's top member instead: waking everyone is the
	// one outcome both heads ruled out (spread 6-member probs often top out ~0.3–0.4).
	if conf < autoPickConfidenceFloor && !allSelected && len(ids) > 0 && turnIntent.Intent != "" &&
		turnIntent.Intent != autoPickIntentAllHands && turnIntent.IntentConf >= autoPickConfidenceFloor {
		log.Printf("auto_pick=decision ids=%v conf=%.2f choice=%s intent=%s(%.2f) note=low_conf_kept_top_member", ids[:1], conf, choiceKey, turnIntent.Intent, turnIntent.IntentConf)
		ids = ids[:1]
		conf = autoPickConfidenceFloor
	}
	if conf < autoPickConfidenceFloor {
		log.Printf("auto_pick=decision ids=%v conf=%.2f choice=%s count=%d probs=%v note=low_conf_failopen_heuristic", ids, conf, choiceKey, countHint, probs)
		return groupAutoPickResult{}, false
	}

	fallback := ""
	allowSecond := true
	leadFB := map[string]bool{}
	// Thin structural safety (no phrase list): model selected everyone (choice=all) or
	// count+mapping covers the full roster → LeadFallback (forbid [PASS]) + no second-wave.
	// Production 14:25 CST 「大家都介绍下自己」 (Langfuse peek f24b88df): choice=all without
	// LeadFallback → both bots [PASS] → silence.
	fullRoster := len(members) > 0 && len(ids) >= len(members)
	if allSelected || fullRoster {
		allowSecond = false
		for _, id := range ids {
			leadFB[id] = true
		}
		if allSelected || fullRoster {
			fallback = "all"
		}
		log.Printf("auto_pick=%s ids=%v conf=%.2f choice=%s count=%d probs=%v fallback=%s", method, ids, conf, choiceKey, countHint, probs, fallback)
	} else {
		// Who-can (model intent): close second-wave + LeadFallback so a [PASS] cannot
		// silence the census or dump incapable peers. Specialty trusts the pick head —
		// no synonym correction; mis-selected bots may still PASS via candidacy.
		if whoCan {
			allowSecond = false
			for _, id := range ids {
				leadFB[id] = true
			}
		}
		log.Printf("auto_pick=%s ids=%v conf=%.2f choice=%s count=%d probs=%v fallback=", method, ids, conf, choiceKey, countHint, probs)
	}
	return groupAutoPickResult{
		AgentIDs:            ids,
		Confidence:          conf,
		Method:              method,
		Fallback:            fallback,
		LeadFallback:        leadFB,
		AllowSecondFailOpen: allowSecond,
		TaskIntentJudged:    taskJudged,
	}, true
}

func buildAutoPickDecisionPayload(userText string, members []string, agents []*db.Agent, synopsis string) (keyToID map[string]string, questions map[string]any, state string) {
	return buildAutoPickDecisionPayloadWithTurns(userText, members, agents, synopsis, nil)
}

// buildAutoPickDecisionPayloadWithTurns builds pick/count (+ intent/bound when tc != nil).
// With tc, Recent context is the structured turn list; synopsis is only used when tc is nil.
// No who-can phrase pre-hint: instructions always teach WHO-CAN vs ALL-HANDS vs SPECIALTY;
// the intent head classifies after decide.
func buildAutoPickDecisionPayloadWithTurns(userText string, members []string, agents []*db.Agent, synopsis string, tc *autoPickTurnContext) (keyToID map[string]string, questions map[string]any, state string) {
	byID := map[string]*db.Agent{}
	for _, a := range agents {
		if a != nil {
			byID[a.ID] = a
		}
	}
	keyToID = map[string]string{}
	criteria := map[string]string{}
	// Opaque "all" first so models can select every member (intro / round-robin / roast).
	// WHO-CAN instructions below discourage parking on all when only a subset is capable.
	criteria[autoPickDecisionAllKey] = "Everyone — all members should reply (self-intro, round-robin, address-everyone / roast-everyone, or explicit all-hands). For WHO-CAN / SPECIALTY: prefer capable mN keys — only use all when EVERY profile can do X"

	type memberProfile struct {
		key, name, role string
	}
	var profiles []memberProfile
	for i, id := range members {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		key := fmt.Sprintf("m%d", i)
		name := id
		role := ""
		if a := byID[id]; a != nil {
			if n := strings.TrimSpace(a.Name); n != "" {
				name = n
			}
			role = strings.TrimSpace(groupParticipationRoleHint(a))
		}
		label := name
		if role != "" {
			label = name + " — " + role
		}
		keyToID[key] = id
		criteria[key] = label
		profiles = append(profiles, memberProfile{key: key, name: name, role: role})
	}
	if len(keyToID) == 0 {
		return nil, nil, ""
	}

	// Product path: model classifies task type from the User message + Member capability
	// profiles + Recent context — not from ever-growing SVG/HTML/anaphora keyword needles.
	instr := "Who should reply this turn? Classify the User message into exactly one task type, then pick opaque keys.\n" +
		"1) ALL-HANDS: addresses the whole room (self-intro, round-robin, address-everyone, roast-everyone; " +
		"e.g. 「都介绍下自己」「大家都介绍一下」「在座的各位都是辣鸡」「introduce yourselves」). " +
		"choice MUST be \"all\", count = full roster (noul near 1), HIGH probability on \"all\", even mass on every mN — never a single mN as primary.\n" +
		"2) WHO-CAN: asks who among members can do X (「谁会写代码」「谁会查资料」「who can code」「who can coding」). " +
		"Match X ONLY to Member capability profiles / criteria role labels — not Recent-context chat. " +
		"coding/写代码/排障/debug ≠ writing/文案/写东西/改稿 — never pick a writer profile for a coding census. " +
		"choice = a capable mN; count = how many profiles share that capability; HIGH probs on every capable mN; " +
		"NEAR-ZERO on incapable mNs and on \"all\" unless EVERY profile can do X.\n" +
		"3) SPECIALTY: asks bots to perform work (lookup/research, coding/debug, writing, translate, …). " +
		"Match the task to Member capability profiles — never park on \"all\", never pick an unrelated role. " +
		"Research/lookup → research/资料/搜索 profiles; coding/debug/implementation → coding/写代码/排障 profiles only; " +
		"writing/文案 → writer profiles only. Set count to how many matching profiles should reply.\n" +
		"4) FOLLOW-UP: the User message continues a prior turn's task (judge by meaning with Recent context). " +
		"Pick the bot that answered that turn (same mN) unless its role is a hard mismatch; count near one specialist; NEVER choice=\"all\".\n" +
		"INTERRUPT: a new self-contained ask (new SPECIALTY / WHO-CAN / ALL-HANDS) — newest wins; ignore unfinished prior asks.\n" +
		"SINGLE / vague: one best-matching profile, or the generalist. When several specialists fit, set count and probabilities for a multi subset (not only all-or-one). " +
		"Reserve choice=\"all\" for ALL-HANDS only — not SPECIALTY or FOLLOW-UP."

	memberN := len(keyToID)
	frac2 := 0.0
	if memberN > 1 {
		frac2 = 1.0 / float64(memberN-1) // noul for exactly 2 of N
	}
	countInstr := fmt.Sprintf(
		"How many members should reply this turn? Output noul in [0,1]: near 0 → one specialist; "+
			"around 0.5 → several complementary specialists (multi subset); near 1 → all %d members. "+
			"ALL-HANDS → noul near 1 (full roster). "+
			"WHO-CAN: one capable → near 0 (→1); two capable → about %.2f (→2); near 1 ONLY when every profile is capable. "+
			"SPECIALTY / FOLLOW-UP → noul for matching profiles only (often near 0 for one specialist); FORBIDDEN to raise noul toward 1 when only a subset fits.",
		memberN, frac2,
	)

	questions = map[string]any{
		autoPickDecisionQKey: map[string]any{
			"type":         "choice",
			"instructions": instr,
			"criteria":     criteria,
		},
		autoPickDecisionCountKey: map[string]any{
			"type":         "noul",
			"instructions": countInstr,
		},
	}
	var b strings.Builder
	utterance := strings.TrimSpace(userText)
	b.WriteString("User message:\n")
	b.WriteString(utterance)
	b.WriteString("\n\nMember capability profiles (authoritative — match tasks to these roles):\n")
	for _, p := range profiles {
		if p.role != "" {
			b.WriteString(fmt.Sprintf("- %s: %s — %s\n", p.key, p.name, p.role))
		} else {
			b.WriteString(fmt.Sprintf("- %s: %s\n", p.key, p.name))
		}
	}
	b.WriteString("Classify the User message (with Recent context) then pick: ")
	b.WriteString("ALL-HANDS → choice=\"all\" + full-roster count; ")
	b.WriteString("WHO-CAN → capable mN subset only; SPECIALTY → matching-role mNs only (not all); ")
	b.WriteString("FOLLOW-UP → the mN that answered the continued turn (never all); ")
	b.WriteString("new ask interrupts unfinished prior work — newest wins.")
	if tc != nil {
		idToKey := map[string]string{}
		for key, id := range keyToID {
			idToKey[id] = key
		}
		addTurnIntentQuestions(questions, &b, tc, idToKey, agents)
	} else if syn := strings.TrimSpace(synopsis); syn != "" {
		b.WriteString("\n\nRecent context (FOLLOW-UP support only; on who-can / all-hands / new self-contained ask ignore unfinished prior and do not override Member capability profiles):\n")
		b.WriteString(syn)
	}
	return keyToID, questions, b.String()
}

func mapDecisionChoiceToAgentIDs(answers map[string]any, keyToID map[string]string, memberOrder []string, k int, allowMultiFromProbs bool, whoCan bool, countHint int) (ids []string, conf float64, allSelected bool, ok bool) {
	if k <= 0 {
		k = autoPickDefaultK
	}
	if len(answers) == 0 || len(keyToID) == 0 {
		return nil, 0, false, false
	}
	raw, _ := answers[autoPickDecisionQKey].(map[string]any)
	if raw == nil {
		// Some providers may nest under the only key; try first choice-shaped answer.
		for _, v := range answers {
			if m, okm := v.(map[string]any); okm {
				if _, has := m["choice"]; has || strings.EqualFold(fmt.Sprint(m["type"]), "choice") {
					raw = m
					break
				}
			}
		}
	}
	if raw == nil {
		return nil, 0, false, false
	}

	choiceKey := strings.TrimSpace(fmt.Sprint(raw["choice"]))
	probs := map[string]float64{}
	if pRaw, okp := raw["probabilities"].(map[string]any); okp {
		for pk, pv := range pRaw {
			probs[pk] = asFloat64(pv)
		}
	}
	conf = autoPickDecisionConfidence(raw, choiceKey, probs)

	// Who-can / multi-subset: choice=all with count < members means "all who can", not every seat.
	// Remap via mN probabilities + count so both capable specialists run (e.g. 22+44 research).
	remapAllToCapable := strings.EqualFold(choiceKey, autoPickDecisionAllKey) && whoCan
	if strings.EqualFold(choiceKey, autoPickDecisionAllKey) && !remapAllToCapable {
		// True all-hands (or model insists on everyone without census intent).
		if countHint > 0 && countHint < len(keyToID) && allowMultiFromProbs {
			// Soft: count says subset — prefer mN multi over literal everyone.
			remapAllToCapable = true
		}
	}
	if remapAllToCapable {
		mapCount := countHint
		// Inflated full-roster count on who-can (Langfuse 21ed840c / 12:18 CST 「谁会写代码」):
		// SystemOne returned choice=all + noul≈0.91 → count=N; trusting count expanded everyone.
		// Already-approved who-can remap: never literal full roster — infer from relative mN probs.
		if whoCan && countHint >= len(keyToID) && len(keyToID) > 0 {
			mapCount = 0
		}
		ids, conf2 := mapCapableMultiFromProbs(probs, keyToID, memberOrder, k, mapCount)
		if len(ids) == 0 {
			return nil, 0, false, false
		}
		if conf2 > conf {
			conf = conf2
		}
		// Valid census multi: don't discard on diluted per-member probs / low confidence field.
		if conf < autoPickConfidenceFloor && len(ids) >= 1 {
			conf = autoPickDecisionConfidence(raw, choiceKey, probs)
			if conf < autoPickConfidenceFloor {
				if pAll := probs[autoPickDecisionAllKey]; pAll > conf {
					conf = pAll
				}
				if conf < autoPickConfidenceFloor {
					conf = 0.55
				}
			}
		}
		return ids, conf, false, true
	}

	if strings.EqualFold(choiceKey, autoPickDecisionAllKey) {
		ids = orderedDecisionMemberIDs(memberOrder, keyToID)
		if len(ids) == 0 {
			return nil, 0, false, false
		}
		// Literal everyone (all-hands intro): SystemOne often returns choice=all + high
		// noul/probs[all] with a diluted confidence field (~0.1). Don't fail-open away
		// from a correct all mapping (14:25 CST 「大家都介绍下自己」 conf=0.10).
		if conf < autoPickConfidenceFloor {
			if pAll := probs[autoPickDecisionAllKey]; pAll > conf {
				conf = pAll
			}
			if conf < autoPickConfidenceFloor {
				conf = 0.55
			}
		}
		return ids, conf, true, true
	}

	primaryID, havePrimary := keyToID[choiceKey]
	if !havePrimary {
		return nil, 0, false, false
	}

	ids = []string{primaryID}
	seen := map[string]struct{}{primaryID: {}}

	type ranked struct {
		key  string
		prob float64
	}
	var extra []ranked
	for key, p := range probs {
		if strings.EqualFold(key, autoPickDecisionAllKey) {
			continue
		}
		id, okm := keyToID[key]
		if !okm {
			continue
		}
		if _, did := seen[id]; did {
			continue
		}
		// Who-can: accept relative matches (mass often sits on "all"); specialty keeps absolute floor.
		if whoCan {
			if p <= 0 {
				continue
			}
		} else if p < autoPickConfidenceFloor {
			continue
		}
		extra = append(extra, ranked{key: key, prob: p})
	}
	sort.SliceStable(extra, func(i, j int) bool {
		if extra[i].prob != extra[j].prob {
			return extra[i].prob > extra[j].prob
		}
		return extra[i].key < extra[j].key
	})
	if whoCan && len(extra) > 0 {
		maxP := probs[choiceKey]
		for _, e := range extra {
			if e.prob > maxP {
				maxP = e.prob
			}
		}
		if maxP <= 0 {
			maxP = extra[0].prob
		}
		relFloor := maxP * 0.4
		filtered := extra[:0]
		for _, e := range extra {
			if e.prob >= relFloor {
				filtered = append(filtered, e)
			}
		}
		extra = filtered
	}

	// Multi from top probabilities without requiring "all": if count was omitted / who-can
	// and soft K is low but several specialists clear the threshold, raise want up to member cap.
	want := k
	if countHint > 0 && countHint < want {
		// Explicit smaller count still respected for specialty; who-can may keep raised want.
		if !whoCan {
			want = countHint
		}
	}
	if countHint > want {
		want = countHint
		capN := decisionMemberCap(len(keyToID))
		if want > capN {
			want = capN
		}
	}
	if allowMultiFromProbs && len(extra) > 0 {
		multiFromProbs := 1 + len(extra) // primary + extras above floor
		capN := decisionMemberCap(len(keyToID))
		if multiFromProbs > want && want < capN {
			want = multiFromProbs
			if want > capN {
				want = capN
			}
		}
	}
	for _, e := range extra {
		if len(ids) >= want {
			break
		}
		id := keyToID[e.key]
		ids = append(ids, id)
		seen[id] = struct{}{}
	}
	return ids, conf, false, true
}

// mapCapableMultiFromProbs picks top-N opaque mN members by probability for who-can / subset-all.
// When countHint >= 2, takes that many; countHint 0/<2 keeps members within 40% of the best mN prob.
// Callers should pass countHint=0 when who-can choice=all claimed a full-roster count (inflated).
func mapCapableMultiFromProbs(probs map[string]float64, keyToID map[string]string, memberOrder []string, k, countHint int) ([]string, float64) {
	type ranked struct {
		key  string
		id   string
		prob float64
	}
	var list []ranked
	maxP := 0.0
	for key, id := range keyToID {
		p := probs[key]
		list = append(list, ranked{key: key, id: id, prob: p})
		if p > maxP {
			maxP = p
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].prob != list[j].prob {
			return list[i].prob > list[j].prob
		}
		return list[i].key < list[j].key
	})
	want := k
	if countHint > 0 {
		want = countHint
	}
	capN := decisionMemberCap(len(keyToID))
	if want < 1 {
		want = 1
	}
	if want > capN {
		want = capN
	}
	if countHint < 2 && maxP > 0 {
		// Infer capable set by relative probability (SystemOne often parks mass on "all").
		relFloor := maxP * 0.4
		n := 0
		for _, e := range list {
			if e.prob >= relFloor {
				n++
			}
		}
		if n > want {
			want = n
		}
		if want > capN {
			want = capN
		}
	}
	ids := make([]string, 0, want)
	seen := map[string]struct{}{}
	var sum float64
	for _, e := range list {
		if len(ids) >= want {
			break
		}
		if _, did := seen[e.id]; did {
			continue
		}
		if countHint < 2 && maxP > 0 && e.prob < maxP*0.4 && len(ids) >= 1 {
			break
		}
		seen[e.id] = struct{}{}
		ids = append(ids, e.id)
		sum += e.prob
	}
	// Prefer channel order for stability when reporting multi census.
	if len(ids) > 1 && len(memberOrder) > 0 {
		ids = orderIDsByMembers(ids, memberOrder)
	}
	conf := maxP
	if sum > conf {
		conf = sum
		if conf > 1 {
			conf = 1
		}
	}
	if pAll := probs[autoPickDecisionAllKey]; pAll > conf {
		conf = pAll
	}
	return ids, conf
}

func orderIDsByMembers(ids []string, memberOrder []string) []string {
	want := map[string]struct{}{}
	for _, id := range ids {
		want[id] = struct{}{}
	}
	var out []string
	for _, id := range memberOrder {
		if _, ok := want[id]; ok {
			out = append(out, id)
			delete(want, id)
		}
	}
	for _, id := range ids {
		if _, ok := want[id]; ok {
			out = append(out, id)
		}
	}
	return out
}

// decisionPickMeta extracts choice + probabilities for auto_pick logs.
func decisionPickMeta(answers map[string]any) (choice string, probs map[string]float64) {
	probs = map[string]float64{}
	if len(answers) == 0 {
		return "", probs
	}
	raw, _ := answers[autoPickDecisionQKey].(map[string]any)
	if raw == nil {
		return "", probs
	}
	choice = strings.TrimSpace(fmt.Sprint(raw["choice"]))
	if pRaw, okp := raw["probabilities"].(map[string]any); okp {
		for pk, pv := range pRaw {
			probs[pk] = asFloat64(pv)
		}
	}
	return choice, probs
}

// countHintFromAnswers maps answers.count noul ∈ [0,1] → how many members (1..memberCount).
// 0 unset / missing → 0 (caller keeps soft K). Mapping: 1 + round(noul*(N-1)).
func countHintFromAnswers(answers map[string]any, memberCount int) int {
	if memberCount <= 0 || len(answers) == 0 {
		return 0
	}
	raw, _ := answers[autoPickDecisionCountKey].(map[string]any)
	if raw == nil {
		return 0
	}
	noul, ok := optionalFloat(raw["noul"])
	if !ok {
		return 0
	}
	if noul < 0 {
		noul = 0
	}
	if noul > 1 {
		noul = 1
	}
	if memberCount == 1 {
		return 1
	}
	n := 1 + int(math.Round(noul*float64(memberCount-1)))
	if n < 1 {
		n = 1
	}
	if n > memberCount {
		n = memberCount
	}
	return n
}

// orderedDecisionMemberIDs expands keyToID into channel member order (stable, no dups).
func orderedDecisionMemberIDs(memberOrder []string, keyToID map[string]string) []string {
	want := map[string]struct{}{}
	for _, id := range keyToID {
		want[id] = struct{}{}
	}
	var out []string
	seen := map[string]struct{}{}
	for _, id := range memberOrder {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := want[id]; !ok {
			continue
		}
		if _, did := seen[id]; did {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == len(want) {
		return out
	}
	// Fallback: any remaining keys sorted by opaque mN order.
	type pair struct {
		key string
		id  string
	}
	var rest []pair
	for key, id := range keyToID {
		if _, did := seen[id]; did {
			continue
		}
		rest = append(rest, pair{key: key, id: id})
	}
	sort.SliceStable(rest, func(i, j int) bool { return rest[i].key < rest[j].key })
	for _, p := range rest {
		out = append(out, p.id)
	}
	return out
}

func autoPickDecisionConfidence(raw map[string]any, choiceKey string, probs map[string]float64) float64 {
	conf := 0.0
	have := false
	if c, ok := optionalFloat(raw["confidence"]); ok {
		conf = c
		have = true
	}
	if p, ok := probs[choiceKey]; ok && p > 0 {
		if !have || p > conf {
			conf = p
		}
		have = true
	}
	if have {
		return conf
	}
	// Valid mapped choice without explicit conf → treat as moderate (above floor).
	return 0.55
}

func asFloat64(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		var f float64
		fmt.Sscanf(strings.TrimSpace(t), "%f", &f)
		return f
	default:
		return 0
	}
}

func optionalFloat(v any) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		// SystemOne / Langfuse sometimes stringify noul/confidence ("0.8896").
		s := strings.TrimSpace(t)
		if s == "" {
			return 0, false
		}
		var f float64
		if _, err := fmt.Sscanf(s, "%f", &f); err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

// callRuntimeDecision invokes agent-runtime /v1/decision/decide (factory → SystemOne).
// userID / conversationID are optional Langfuse attribution (user-delete purge).
func (s *Server) callRuntimeDecision(ctx context.Context, provider, baseURL, apiKey, model string, state any, questions map[string]any, userID, conversationID string) (map[string]any, error) {
	if s == nil || strings.TrimSpace(s.runtimeURL) == "" {
		return nil, fmt.Errorf("runtime unavailable")
	}
	provider, baseURL, model = db.ApplyDecisionDefaults(provider, baseURL, model)
	body := map[string]any{
		"provider":  provider,
		"base_url":  baseURL,
		"api_key":   apiKey,
		"model":     model,
		"state":     state,
		"questions": questions,
	}
	if uid := strings.TrimSpace(userID); uid != "" {
		body["user_id"] = uid
	}
	if cid := strings.TrimSpace(conversationID); cid != "" {
		body["conversation_id"] = cid
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.runtimeURL+"/v1/decision/decide", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: autoPickDecisionTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		var parsed map[string]any
		if json.Unmarshal(raw, &parsed) == nil {
			if d, ok := parsed["detail"].(string); ok && d != "" {
				msg = d
			} else if e, ok := parsed["error"].(string); ok && e != "" {
				msg = e
			}
		}
		if msg == "" {
			msg = fmt.Sprintf("decision status %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("%s", msg)
	}
	var out struct {
		Enabled bool           `json:"enabled"`
		Answers map[string]any `json:"answers"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decision response parse: %w", err)
	}
	if !out.Enabled || len(out.Answers) == 0 {
		return nil, fmt.Errorf("decision disabled or empty answers")
	}
	return out.Answers, nil
}

// decisionDepsForUser loads org decision settings and binds runtime decide.
// conversationID is the Langfuse session_id (= conversations.id) for purge attribution.
// Returns nil when org decision is off (caller fail-opens to heuristic).
func (s *Server) decisionDepsForUser(uid, conversationID string) *autoPickDecisionDeps {
	if s == nil || s.db == nil {
		return nil
	}
	uid = strings.TrimSpace(uid)
	if uid == "" {
		return nil
	}
	conversationID = strings.TrimSpace(conversationID)
	u, err := s.db.GetUserByID(uid)
	if err != nil || u == nil || strings.TrimSpace(u.OrgID) == "" {
		return nil
	}
	settings, err := s.db.GetOrgSettings(u.OrgID)
	if err != nil || settings == nil {
		return nil
	}
	provider := db.NormalizeDecisionProvider(settings.DecisionProvider)
	if provider == "off" {
		return &autoPickDecisionDeps{Provider: "off"}
	}
	deps := &autoPickDecisionDeps{
		Provider: provider,
		BaseURL:  settings.DecisionBaseURL,
		APIKey:   settings.DecisionAPIKey,
		Model:    settings.DecisionModel,
	}
	// Exactly one backend: microsoft (Go-native) XOR runtime System One (jev/laya/custom).
	if provider == "microsoft" {
		ms := s.msDecisionBindingFromSettings(settings)
		if ms == nil {
			// Selected but incomplete (no key/endpoint) → Decide nil → heuristic fail-open.
			return deps
		}
		deps.Microsoft = true
		deps.Decide = microsoftAutoPickDecide(ms)
		return deps
	}
	if db.IsRuntimeSystemOneProvider(provider) {
		deps.Decide = func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return s.callRuntimeDecision(ctx, deps.Provider, deps.BaseURL, deps.APIKey, deps.Model, state, questions, uid, conversationID)
		}
	}
	return deps
}
