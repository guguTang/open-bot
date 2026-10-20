package httpserver

import (
	"strings"
	"testing"
)

func TestClassifySendIgnoresWording(t *testing.T) {
	if got := classifySend("做完了么", false); got != gateNone {
		t.Fatalf("no running agent, start a turn: %v", got)
	}
	if got := classifySend("我来把这一版补上战斗动画，做好后给你", false); got != gateNone {
		t.Fatalf("wording must not open a gate: %v", got)
	}
	if got := classifySend("做完了么", true); got != gateFollowUp {
		t.Fatalf("running agent stays running: %v", got)
	}
	if got := classifySend("再加一个背包", true); got != gateFollowUp {
		t.Fatalf("follow-up while running: %v", got)
	}
	if got := classifySend("别做了", true); got != gateCancel {
		t.Fatalf("cancel: %v", got)
	}
}

func TestIsPendingTaskContinuationPrompt(t *testing.T) {
	if !isPendingTaskContinuationPrompt(buildPendingTaskInstruction("补战斗动画")) {
		t.Fatal("host instruction must match marker")
	}
	if isPendingTaskContinuationPrompt("帮我写个函数") {
		t.Fatal("normal user text must not match")
	}
	if isPendingTaskContinuationPrompt("") {
		t.Fatal("empty must not match")
	}
}

func TestOpenTaskSendPlanSkipsDecision(t *testing.T) {
	plan := openTaskSendPlan("bot-coder")
	if plan == nil || len(plan.Targets) != 1 || plan.Targets[0] != "bot-coder" {
		t.Fatalf("targets: %#v", plan)
	}
	if plan.AutoPick == nil || plan.AutoPick.Method != "open_task" {
		t.Fatalf("method: %#v", plan.AutoPick)
	}
	if plan.AutoPick.Confidence != 1 || plan.AutoPick.AllowSecondFailOpen {
		t.Fatalf("confidence/second-fail-open: %#v", plan.AutoPick)
	}
	if !plan.AutoPick.LeadFallback["bot-coder"] {
		t.Fatal("owner must be must-answer")
	}
	if empty := openTaskSendPlan("  "); empty == nil || len(empty.Targets) != 0 {
		t.Fatalf("empty agent: %#v", empty)
	}
}

func TestBuildPendingTaskInstructionStable(t *testing.T) {
	got := buildPendingTaskInstruction("补上战斗动画")
	if !strings.HasPrefix(got, pendingTaskInstructionPrefix) {
		t.Fatalf("prefix: %q", got)
	}
	if !strings.Contains(got, "补上战斗动画") {
		t.Fatalf("goal missing: %q", got)
	}
}
