package httpserver

import (
	"context"
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func intentTestGroup() ([]string, []*db.Agent) {
	members := []string{"writer", "coder", "pm"}
	agents := []*db.Agent{
		{ID: "writer", Name: "文案", Description: "写文章与文案"},
		{ID: "coder", Name: "代码", Description: "写代码与排障"},
		{ID: "pm", Name: "产品", Description: "需求分析与PRD"},
	}
	return members, agents
}

func intentTestMsgs() []db.Message {
	return []db.Message{
		{ID: "u1", Role: "user", Content: "写个 Python 词频统计函数"},
		{ID: "a1", Role: "assistant", AgentID: "coder", Content: "def count(): ..."},
		{ID: "a1p", Role: "assistant", AgentID: "writer", Content: "[PASS]"},
		{ID: "u2", Role: "user", Content: "给它写段推广文案"},
		{ID: "a2", Role: "assistant", AgentID: "writer", Content: "一键统计…"},
		{ID: "x", Role: "assistant", AgentID: "outsider", Content: "not a member"},
		{ID: "th", Role: "user", Content: "thread reply", ThreadRootID: "u1"},
		{ID: "u3", Role: "user", Content: "current message"},
	}
}

func TestBuildAutoPickTurnContextStructure(t *testing.T) {
	members, _ := intentTestGroup()
	tc := buildAutoPickTurnContext(intentTestMsgs(), &db.Message{ID: "a1", Role: "assistant", AgentID: "coder"}, members, 4)
	if len(tc.Turns) != 2 {
		t.Fatalf("want 2 prior turns (current + thread excluded), got %#v", tc.Turns)
	}
	if tc.Turns[0].Key != "t1" || tc.Turns[1].Key != "t2" {
		t.Fatalf("keys must be chronological t1..tN: %#v", tc.Turns)
	}
	if got := tc.Turns[0].AnswerIDs; len(got) != 1 || got[0] != "coder" {
		t.Fatalf("t1 answerers must skip [PASS] and non-members: %#v", got)
	}
	if got := tc.Turns[1].AnswerIDs; len(got) != 1 || got[0] != "writer" {
		t.Fatalf("t2 answerers: %#v", got)
	}
	if tc.ReplyToTurn != "t1" || tc.ReplyToAgentID != "coder" {
		t.Fatalf("reply_to must resolve structurally to t1/coder, got %q/%q", tc.ReplyToTurn, tc.ReplyToAgentID)
	}
	short := buildAutoPickTurnContext(intentTestMsgs(), nil, members, 1)
	if len(short.Turns) != 1 || short.Turns[0].UserMsgID != "u2" || short.Turns[0].Key != "t1" {
		t.Fatalf("maxTurns keeps newest turns, re-keyed: %#v", short.Turns)
	}
}

func TestDecisionPayloadWithTurnsAddsIntentAndBound(t *testing.T) {
	members, agents := intentTestGroup()
	tc := buildAutoPickTurnContext(intentTestMsgs(), nil, members, 4)
	tc.OpenTask = &autoPickOpenTask{AgentID: "coder", Goal: "做成小工具"}
	_, q, st := buildAutoPickDecisionPayloadWithTurns("为什么", members, agents, "", tc)
	intent, ok := q[autoPickIntentQKey].(map[string]any)
	if !ok || intent["type"] != "choice" {
		t.Fatalf("intent choice question missing: %#v", q)
	}
	crit := intent["criteria"].(map[string]string)
	for _, k := range []string{autoPickIntentFollowUp, autoPickIntentNewAsk, autoPickIntentAllHands, autoPickIntentWhoCan} {
		if crit[k] == "" {
			t.Fatalf("intent criteria missing %q: %#v", k, crit)
		}
	}
	bound := q[autoPickBoundQKey].(map[string]any)["criteria"].(map[string]string)
	for _, k := range []string{"t1", "t2", autoPickBoundNone, autoPickBoundTask} {
		if bound[k] == "" {
			t.Fatalf("bound criteria missing %q: %#v", k, bound)
		}
	}
	// coder is m1 (members order) — answerer labels use opaque keys.
	if !strings.Contains(bound["t1"], "m1 代码") || !strings.Contains(bound["t2"], "m0 文案") {
		t.Fatalf("bound criteria must name answerers by mN: %#v", bound)
	}
	if !strings.Contains(st, "Recent turns") || !strings.Contains(st, "t1 User: 「写个 Python 词频统计函数」 → answered by m1 代码") {
		t.Fatalf("state must list structured turns: %s", st)
	}
	if !strings.Contains(st, "Background task still in progress (owner m1 代码)") {
		t.Fatalf("state must carry open task: %s", st)
	}
	// No turns → no follow_up class, no bound question.
	_, q2, _ := buildAutoPickDecisionPayloadWithTurns("hi", members, agents, "", &autoPickTurnContext{})
	if _, has := q2[autoPickBoundQKey]; has {
		t.Fatal("bound question needs prior turns")
	}
	if c := q2[autoPickIntentQKey].(map[string]any)["criteria"].(map[string]string); c[autoPickIntentFollowUp] != "" {
		t.Fatal("follow_up class requires prior turns")
	}
	// Legacy (nil tc): no intent questions.
	_, q3, _ := buildAutoPickDecisionPayload("hi", members, agents, "User: x")
	if _, has := q3[autoPickIntentQKey]; has {
		t.Fatal("nil turn context keeps the legacy pick/count schema")
	}
}

func decideWith(answers map[string]any) *autoPickDecisionDeps {
	return &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return answers, nil
		},
	}
}

func choiceAns(choice string, probs map[string]any) map[string]any {
	return map[string]any{"type": "choice", "choice": choice, "probabilities": probs}
}

func TestFollowUpBoundToOlderTurnSticksToItsAnswerer(t *testing.T) {
	members, agents := intentTestGroup()
	tc := buildAutoPickTurnContext(intentTestMsgs(), nil, members, 4)
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m0", map[string]any{"m0": "0.7", "m1": "0.2"}), // newest answerer (writer)
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.85"}),
		"bound":  choiceAns("t1", map[string]any{"t1": "0.8"}), // older coder turn
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "那个函数能支持中文吗", members, agents, "writer", 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "coder" {
		t.Fatalf("follow-up to t1 must go to t1's answerer, got %#v", got)
	}
}

func TestNewAskIgnoresPriorAnswerer(t *testing.T) {
	members, agents := intentTestGroup()
	tc := buildAutoPickTurnContext(intentTestMsgs(), nil, members, 4)
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.8"}),
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("new_ask", map[string]any{"new_ask": "0.9"}),
		"bound":  choiceAns("t2", map[string]any{"t2": "0.6"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "下个版本做什么", members, agents, "writer", 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "pm" {
		t.Fatalf("new ask must follow the model pick, got %#v", got)
	}
}

func TestLowConfidenceFollowUpFallsBackToPick(t *testing.T) {
	members, agents := intentTestGroup()
	tc := buildAutoPickTurnContext(intentTestMsgs(), nil, members, 4)
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.8"}),
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.2", "new_ask": "0.19"}),
		"bound":  choiceAns("t1", map[string]any{"t1": "0.9"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "嗯", members, agents, "writer", 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "pm" {
		t.Fatalf("low-confidence intent must not override pick, got %#v", got)
	}
}

func TestFollowUpReplyToPinsQuotedBot(t *testing.T) {
	members, agents := intentTestGroup()
	msgs := []db.Message{
		{ID: "u1", Role: "user", Content: "大家说说"},
		{ID: "a1", Role: "assistant", AgentID: "coder", Content: "x"},
		{ID: "a2", Role: "assistant", AgentID: "writer", Content: "y"},
		{ID: "u2", Role: "user", Content: "now"},
	}
	tc := buildAutoPickTurnContext(msgs, &db.Message{ID: "a2", Role: "assistant", AgentID: "writer"}, members, 4)
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m1", map[string]any{"m1": "0.6"}),
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.8"}),
		"bound":  choiceAns("none", map[string]any{"none": "0.6"}), // model did not name a turn
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "展开说说", members, agents, "writer", 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "writer" {
		t.Fatalf("follow-up on a quoted reply must go to the quoted bot, got %#v", got)
	}
}

func TestFollowUpToWholeRoomTurnDoesNotWakeEveryone(t *testing.T) {
	members, agents := intentTestGroup()
	msgs := []db.Message{
		{ID: "u1", Role: "user", Content: "大家介绍下"},
		{ID: "a1", Role: "assistant", AgentID: "coder", Content: "x"},
		{ID: "a2", Role: "assistant", AgentID: "writer", Content: "y"},
		{ID: "a3", Role: "assistant", AgentID: "pm", Content: "z"},
		{ID: "u2", Role: "user", Content: "now"},
	}
	tc := buildAutoPickTurnContext(msgs, nil, members, 4)
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.8"}),
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.9"}),
		"bound":  choiceAns("t1", map[string]any{"t1": "0.9"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "那 PRD 谁来写", members, agents, "writer", 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "pm" {
		t.Fatalf("follow-up to an all-hands turn keeps pick (choice=all stays explicit), got %#v", got)
	}
}

func TestOpenTaskBoundRoutesToOwnerElseNewAskRoutesElsewhere(t *testing.T) {
	members, agents := intentTestGroup()
	tc := &autoPickTurnContext{OpenTask: &autoPickOpenTask{AgentID: "coder", Goal: "做成小工具"}}
	cont := decideWith(map[string]any{
		"pick":   choiceAns("m0", map[string]any{"m0": "0.5"}),
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.9"}),
		"bound":  choiceAns("task", map[string]any{"task": "0.9"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "加个导出按钮", members, agents, "writer", 1, "", cont, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "coder" {
		t.Fatalf("task follow-up must go to the owner, got %#v", got)
	}
	other := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.9"}),
		"count":  map[string]any{"type": "noul", "noul": "0"},
		"intent": choiceAns("new_ask", map[string]any{"new_ask": "0.9"}),
		"bound":  choiceAns("none", map[string]any{"none": "0.9"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "下个版本做什么", members, agents, "writer", 1, "", other, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "pm" {
		t.Fatalf("new ask during a background task goes to the picked member, got %#v", got)
	}
}

func TestPickAllRejectedWhenIntentIsSingleTask(t *testing.T) {
	members, agents := intentTestGroup()
	deps := decideWith(map[string]any{
		"pick":   choiceAns("all", map[string]any{"all": "0.89", "m0": "0.07", "m1": "0.02", "m2": "0.02"}),
		"count":  map[string]any{"type": "noul", "noul": "0.4"},
		"intent": choiceAns("new_ask", map[string]any{"new_ask": "0.9"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "我们来玩个文字冒险游戏，你来当主持人", members, agents, "writer", 1, "", deps, &autoPickTurnContext{})
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "writer" || got.Fallback == "all" {
		t.Fatalf("pick=all with confident new_ask must narrow to the top member, got %#v", got)
	}
	// Both heads lukewarm (pick all 0.45, intent all_hands 0.51): not enough to wake everyone.
	luke := decideWith(map[string]any{
		"pick":   choiceAns("all", map[string]any{"all": "0.45", "m0": "0.1", "m1": "0.3", "m2": "0.15"}),
		"intent": choiceAns("all_hands", map[string]any{"all_hands": "0.51", "new_ask": "0.45"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "我们来玩个游戏", members, agents, "writer", 1, "", luke, &autoPickTurnContext{})
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "coder" {
		t.Fatalf("lukewarm all must narrow to the top member, got %#v", got)
	}
	// Undecided intent + confident pick=all: stands.
	weak := decideWith(map[string]any{
		"pick":   choiceAns("all", map[string]any{"all": "0.89", "m0": "0.07"}),
		"count":  map[string]any{"type": "noul", "noul": "1"},
		"intent": choiceAns("new_ask", map[string]any{"new_ask": "0.45", "all_hands": "0.4"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "你们觉得呢", members, agents, "writer", 1, "", weak, &autoPickTurnContext{})
	if len(got.AgentIDs) != len(members) || got.Fallback != "all" {
		t.Fatalf("weak intent must not overrule pick=all, got %#v", got)
	}
}

func TestIntentAllHandsExpandsToRoster(t *testing.T) {
	members, agents := intentTestGroup()
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m0", map[string]any{"m0": "0.6", "all": "0.2"}),
		"count":  map[string]any{"type": "noul", "noul": "0.5"},
		"intent": choiceAns("all_hands", map[string]any{"all_hands": "0.9"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "大家都说说怎么改进", members, agents, "writer", 1, "", deps, &autoPickTurnContext{})
	if len(got.AgentIDs) != len(members) || got.Fallback != "all" || got.AllowSecondFailOpen {
		t.Fatalf("confident all_hands intent must reach the whole roster, got %#v", got)
	}
	for _, id := range members {
		if !got.LeadFallback[id] {
			t.Fatalf("all-hands members must not [PASS]: %#v", got.LeadFallback)
		}
	}
	// all_hands below the strong bar does not overrule a member pick.
	weak := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.5"}),
		"intent": choiceAns("all_hands", map[string]any{"all_hands": "0.61"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "帮我想想下个版本做什么", members, agents, "writer", 1, "", weak, &autoPickTurnContext{})
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "pm" {
		t.Fatalf("weak all_hands must keep the member pick, got %#v", got)
	}
}

func TestTargetsOnlyTaskOwner(t *testing.T) {
	if !targetsOnlyTaskOwner([]string{"coder"}, "coder", "lead") {
		t.Fatal("owner-only plan queues behind the task")
	}
	if targetsOnlyTaskOwner([]string{"pm"}, "coder", "lead") || targetsOnlyTaskOwner([]string{"coder", "pm"}, "coder", "lead") {
		t.Fatal("plans with other members must run now")
	}
	if !targetsOnlyTaskOwner([]string{"lead"}, "", "lead") {
		t.Fatal("empty task agent falls back to conversation agent")
	}
}

func TestOpenTaskCancelIsModelClassified(t *testing.T) {
	members, agents := intentTestGroup()
	tc := &autoPickTurnContext{OpenTask: &autoPickOpenTask{AgentID: "coder", Goal: "贪吃蛇小游戏"}}
	_, q, _ := buildAutoPickDecisionPayloadWithTurns("x", members, agents, "", tc)
	if c := q[autoPickIntentQKey].(map[string]any)["criteria"].(map[string]string); c[autoPickIntentCancel] == "" {
		t.Fatal("cancel_task class must be offered while a task is open")
	}
	_, q2, _ := buildAutoPickDecisionPayloadWithTurns("x", members, agents, "", &autoPickTurnContext{Turns: []autoPickTurn{{Key: "t1", UserText: "hi"}}})
	if c := q2[autoPickIntentQKey].(map[string]any)["criteria"].(map[string]string); c[autoPickIntentCancel] != "" {
		t.Fatal("cancel_task needs an open task")
	}
	stop := decideWith(map[string]any{
		"pick":   choiceAns("m0", map[string]any{"m0": "0.6"}),
		"intent": choiceAns("cancel_task", map[string]any{"cancel_task": "0.9"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "先别做了", members, agents, "writer", 1, "", stop, tc)
	if !got.CancelOpenTask || !got.TaskIntentJudged || len(got.AgentIDs) != 1 || got.AgentIDs[0] != "coder" {
		t.Fatalf("model cancel_task must flag cancel for the owner, got %#v", got)
	}
	unsure := decideWith(map[string]any{
		"pick":   choiceAns("m1", map[string]any{"m1": "0.8"}),
		"intent": choiceAns("cancel_task", map[string]any{"cancel_task": "0.69"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "做好了吗？顺便加一个暂停键", members, agents, "writer", 1, "", unsure, tc)
	if got.CancelOpenTask || !got.TaskIntentJudged {
		t.Fatalf("an unsure cancel_task must not stop background work, got %#v", got)
	}
	feature := decideWith(map[string]any{
		"pick":   choiceAns("m1", map[string]any{"m1": "0.8"}),
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.8"}),
		"bound":  choiceAns("task", map[string]any{"task": "0.8"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "顺便加一个暂停键", members, agents, "writer", 1, "", feature, tc)
	if got.CancelOpenTask || !got.TaskIntentJudged || len(got.AgentIDs) != 1 || got.AgentIDs[0] != "coder" {
		t.Fatalf("feature ask mentioning pause is a task follow-up, got %#v", got)
	}
}

func TestFollowUpWithoutBoundUsesNewestAnsweredTurn(t *testing.T) {
	members, agents := intentTestGroup()
	tc := buildAutoPickTurnContext(intentTestMsgs(), nil, members, 4)
	deps := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.3"}),
		"intent": choiceAns("follow_up", map[string]any{"follow_up": "0.8"}),
		"bound":  choiceAns("none", map[string]any{"none": "0.7"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "继续", members, agents, "writer", 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "writer" {
		t.Fatalf("unbound follow-up continues the newest answered turn (t2 writer), got %#v", got)
	}
}

func TestLowConfidencePickKeptWhenIntentIsNotAllHands(t *testing.T) {
	members, agents := intentTestGroup()
	single := decideWith(map[string]any{
		"pick":   choiceAns("m2", map[string]any{"m2": "0.3", "m0": "0.25", "m1": "0.2", "all": "0.25"}),
		"intent": choiceAns("new_ask", map[string]any{"new_ask": "0.8"}),
	})
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "帮我想想下个版本做什么", members, agents, "writer", 1, "", single, &autoPickTurnContext{})
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != "pm" || got.Method != "decision" {
		t.Fatalf("low-conf pick with a single-task intent keeps the top member, got %#v", got)
	}
	// Legacy schema (no intent answer): unchanged low-conf fail-open.
	legacy := decideWith(map[string]any{
		"pick": choiceAns("m2", map[string]any{"m2": "0.3", "m0": "0.25", "m1": "0.2", "all": "0.25"}),
	})
	got = runAutoPickByModeWithTurns(db.AutoPickDecision, "帮我想想下个版本做什么", members, agents, "writer", 1, "", legacy, &autoPickTurnContext{})
	if got.Method == "decision" {
		t.Fatalf("without an intent answer low confidence still fail-opens, got %#v", got)
	}
}
