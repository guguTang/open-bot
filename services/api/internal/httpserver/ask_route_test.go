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
	if got := askTargetFromAnswers(map[string]any{"ask": map[string]any{"choice": "c0", "confidence": "0.2641"}}, keys); got != "" {
		t.Fatalf("weak confidence should stay: %q", got)
	}
	if got := askTargetFromAnswers(map[string]any{"ask": map[string]any{"choice": "c0", "confidence": 0.8}}, keys); got != "coder" {
		t.Fatalf("confident c0 -> %s", got)
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

func TestAskContextLabelsColleagueReply(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写作", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{{ID: "coder", Name: "代码", Description: "负责写代码与排障"}}
	history := []runtimeMsg{
		{Role: "user", Content: "给我身份证信息"},
		{Role: "user", Content: "【代码】这份社保记录上的社会保障号码是 411526199302190452。"},
		{Role: "user", Content: "这个人是谁，叫什么名字"},
	}
	pack, ok := buildAskDecision(self, peers, history)
	if !ok {
		t.Fatal("expected a pack")
	}
	if strings.Contains(pack.State, "用户：【代码】") {
		t.Fatalf("colleague reply looks like the user named them:\n%s", pack.State)
	}
	if !strings.Contains(pack.State, "同事代码：") || !strings.Contains(pack.State, "411526199302190452") {
		t.Fatalf("colleague reply missing from the decision:\n%s", pack.State)
	}
	if !strings.Contains(pack.Question, "请处理用户刚说的：这个人是谁，叫什么名字") {
		t.Fatalf("question followed the colleague note:\n%s", pack.Question)
	}
	ask, _ := pack.Questions["ask"].(map[string]any)
	inst, _ := ask["instructions"].(string)
	if !strings.Contains(inst, "标成同事的旧回复不是点名") {
		t.Fatalf("instructions: %s", inst)
	}
}

func TestAskDecisionKeepsAssistantReply(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写作", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{{ID: "coder", Name: "代码", Description: "负责写代码与排障"}}
	summary := "这份文件是北京市社保缴费记录，重点如下：缴费范围 2016年6月至2018年9月，身份证号等敏感信息建议遮盖。"
	history := []runtimeMsg{
		{Role: "user", Content: "总结下"},
		{Role: "assistant", Content: summary},
		{Role: "user", Content: "给我身份证信息"},
	}
	pack, ok := buildAskDecision(self, peers, history)
	if !ok {
		t.Fatal("expected a pack")
	}
	if !strings.Contains(pack.State, "社保") || !strings.Contains(pack.State, "用户：给我身份证信息") {
		t.Fatalf("reply or ask missing from the decision:\n%s", pack.State)
	}
	if !strings.Contains(pack.Question, "社保") || !strings.Contains(pack.Question, "请处理用户刚说的：给我身份证信息") {
		t.Fatalf("colleague brief lost the prior reply:\n%s", pack.Question)
	}
}

func TestAskDecisionKeepsRollingSummary(t *testing.T) {
	self := &db.Agent{ID: "writer", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{{ID: "coder", Name: "代码", Description: "负责写代码与排障"}}
	history := []runtimeMsg{
		{Role: "summary", Content: "此前讨论了北京市社保缴费记录和身份证号"},
		{Role: "user", Content: "给我身份证信息"},
	}
	pack, ok := buildAskDecision(self, peers, history)
	if !ok {
		t.Fatal("expected a pack")
	}
	if !strings.Contains(pack.State, "社保") || !strings.Contains(pack.State, "用户：给我身份证信息") {
		t.Fatalf("summary or ask missing:\n%s", pack.State)
	}
}

func TestFitAskStateKeepsLatestAsk(t *testing.T) {
	header := "你的岗位：写东西\n\n会话：\n"
	old := "助手：" + strings.Repeat("旧", 800)
	convo := old + "\n用户：给我身份证信息"
	state := fitAskState(header, convo, 200)
	if !strings.Contains(state, "你的岗位：写东西") || !strings.Contains(state, "用户：给我身份证信息") {
		t.Fatalf("header or latest ask dropped:\n%s", state)
	}
	if strings.Contains(state, "旧旧旧旧旧") {
		t.Fatalf("old reply kept ahead of the latest ask:\n%s", state)
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
