package httpserver

import (
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestBuildAskDecisionUsesSummaryAndRecent(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写作", Description: "写作与改稿"}
	peers := []*db.Agent{
		{ID: "coder", Name: "代码", Description: "负责写代码与排障"},
		{ID: "design", Name: "设计", Description: "负责界面设计，不改仓库"},
		{ID: "writer", Name: "写作", Description: "写作与改稿"},
		{ID: "blank", Name: "空", Description: "  "},
	}
	history := []runtimeMsg{
		{Role: "user", Content: "很早的一句"},
		{Role: "summary", Content: "之前在改一封邮件"},
		{Role: "assistant", Content: "邮件已经改好"},
		{Role: "user", Content: "帮我写个html页面，简单的计算器"},
	}
	pack, ok := buildAskDecision(self, peers, history)
	if !ok {
		t.Fatal("expected a decision pack")
	}
	if !strings.Contains(pack.State, "之前在改一封邮件") || !strings.Contains(pack.State, "帮我写个html页面") {
		t.Fatalf("state missing summary or recent: %s", pack.State)
	}
	if strings.Contains(pack.State, "很早的一句") {
		t.Fatal("turns before the summary should not be in the state")
	}
	if strings.Contains(pack.State, "sandbox") {
		t.Fatal("state should not list tools")
	}
	criteria := pack.Questions["ask"].(map[string]any)["criteria"].(map[string]string)
	if _, hasNone := criteria["none"]; !hasNone {
		t.Fatal("missing none")
	}
	if !strings.Contains(criteria["none"], "两边都能干") {
		t.Fatalf("none should keep overlapping work: %s", criteria["none"])
	}
	if criteria["c0"] == "" || !strings.Contains(criteria["c0"], "代码") {
		t.Fatalf("c0 = %#v", criteria["c0"])
	}
	if pack.KeyToID["c0"] != "coder" {
		t.Fatalf("c0 id = %s", pack.KeyToID["c0"])
	}
	if _, selfListed := pack.KeyToID["writer"]; selfListed {
		t.Fatal("self should not be a choice")
	}
	if !strings.Contains(pack.Question, "帮我写个html页面，简单的计算器") {
		t.Fatalf("question = %s", pack.Question)
	}
}

func TestBuildAskDecisionWithoutSummaryUsesContext(t *testing.T) {
	self := &db.Agent{ID: "writer", Description: "写作与改稿"}
	peers := []*db.Agent{{ID: "coder", Name: "代码", Description: "写代码"}}
	history := []runtimeMsg{{Role: "user", Content: "帮我写个html页面，简单的计算器"}}
	pack, ok := buildAskDecision(self, peers, history)
	if !ok {
		t.Fatal("expected a pack")
	}
	if strings.Contains(pack.State, "[摘要]") {
		t.Fatal("short chat should not invent a summary")
	}
	if !strings.Contains(pack.State, "帮我写个html页面，简单的计算器") {
		t.Fatalf("state = %s", pack.State)
	}
}

func TestAskTargetFromAnswers(t *testing.T) {
	keys := map[string]string{"c0": "coder", "c1": "design"}
	if got := askTargetFromAnswers(map[string]any{"ask": map[string]any{"choice": "c0"}}, keys); got != "coder" {
		t.Fatalf("c0 -> %s", got)
	}
	if got := askTargetFromAnswers(map[string]any{"ask": map[string]any{"choice": "none"}}, keys); got != "" {
		t.Fatalf("none -> %q", got)
	}
	if got := askTargetFromAnswers(map[string]any{"ask": map[string]any{"choice": "c9"}}, keys); got != "" {
		t.Fatalf("unknown -> %q", got)
	}
}

func TestAskRouteUtteranceDropsFileBody(t *testing.T) {
	raw := "总结下这个文档\n\n（用户上传了 1 个附件）\n- spec.pdf (application/pdf, 281.3 KB)\n  以下为用户文件正文\n```markdown\n智能体互联 总体架构\n```"
	got := askRouteUtterance(raw)
	if strings.Contains(got, "总体架构") || strings.Contains(got, "以下为用户文件正文") {
		t.Fatalf("file body leaked: %s", got)
	}
	if !strings.Contains(got, "总结下这个文档") || !strings.Contains(got, "spec.pdf") {
		t.Fatalf("ask or filename missing: %s", got)
	}
	self := &db.Agent{ID: "writer", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{{ID: "coder", Name: "代码", Description: "负责写代码与排障"}}
	pack, ok := buildAskDecision(self, peers, []runtimeMsg{{Role: "user", Content: raw}})
	if !ok {
		t.Fatal("expected a pack")
	}
	if strings.Contains(pack.State, "总体架构") || strings.Contains(pack.Question, "总体架构") {
		t.Fatalf("decision saw the file body:\nstate=%s\nquestion=%s", pack.State, pack.Question)
	}
}

func TestPayloadOnboarding(t *testing.T) {
	if !payloadOnboarding(map[string]any{"onboarding": true}) {
		t.Fatal("job card turn should skip colleague routing")
	}
	if payloadOnboarding(map[string]any{"content": "我想先用你来做：查资料与总结"}) {
		t.Fatal("wording alone is not an onboarding turn")
	}
	if payloadOnboarding(nil) {
		t.Fatal("nil payload is not onboarding")
	}
}

func TestAskRouteShouldCall(t *testing.T) {
	if !askRouteShouldCall("", 0, true, false, "laya", 2) {
		t.Fatal("dm with peers should call")
	}
	if askRouteShouldCall("chan", 0, true, false, "laya", 2) {
		t.Fatal("channel should not call")
	}
	if askRouteShouldCall("", 1, true, false, "laya", 2) {
		t.Fatal("child ask should not call")
	}
	if askRouteShouldCall("", 0, true, false, "off", 2) {
		t.Fatal("provider off should not call")
	}
	if askRouteShouldCall("", 0, true, false, "laya", 0) {
		t.Fatal("empty roster should not call")
	}
	if askRouteShouldCall("", 0, false, false, "laya", 2) {
		t.Fatal("ask disabled should not call")
	}
}

func TestApplyAskRouteResultDisablesRedo(t *testing.T) {
	payload := map[string]any{
		"messages":        []runtimeMsg{{Role: "user", Content: "写个计算器"}},
		"system_prompt":   "你主攻写作",
		"allow_ask_agent": true,
	}
	applyAskRouteResult(payload, "代码", "页面已写好", false)
	if payload["allow_ask_agent"] != false {
		t.Fatal("ask_agent should be off for the parent turn")
	}
	if payload["ask_routed"] != true {
		t.Fatal("parent run should know a colleague already delivered")
	}
	system, _ := payload["system_prompt"].(string)
	if !strings.Contains(system, "不要再用自己的工具") {
		t.Fatalf("note missing: %s", system)
	}
	history, _ := payload["messages"].([]runtimeMsg)
	if len(history) != 2 || !strings.Contains(history[1].Content, "【代码】页面已写好") {
		t.Fatalf("history = %#v", history)
	}
	applyAskRouteResult(payload, "代码", "要哪个配色？", true)
	system, _ = payload["system_prompt"].(string)
	if !strings.Contains(system, "停下来等用户") {
		t.Fatalf("needs_user note missing: %s", system)
	}
}
