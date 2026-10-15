package httpserver

import (
	"context"
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
	if !strings.HasPrefix(criteria["none"], askNoneCriteriaLead) || !strings.Contains(criteria["none"], "写作与改稿") {
		t.Fatalf("none should lead with the routing default, got %s", criteria["none"])
	}
	if strings.HasPrefix(criteria["none"], "写作与改稿") {
		t.Fatal("routing default should lead none")
	}
	if strings.Contains(pack.State, "# 角色") || strings.Contains(pack.State, "决策原则") {
		t.Fatalf("rules should stay in instructions, not the state:\n%s", pack.State)
	}
	if !strings.HasPrefix(pack.State, "当前：帮我写个html页面，简单的计算器\n（以下仅助解指代，勿作指派依据）\n会话：") {
		t.Fatalf("latest ask should lead the state:\n%s", pack.State)
	}
	if runeLen(pack.State) > askRouteDecisionRunes {
		t.Fatalf("state too long for Laya: %d", runeLen(pack.State))
	}
	if !strings.HasPrefix(criteria["c0"], "仅当最新句明确需要：负责写代码与排障") || !strings.Contains(criteria["c0"], "勿因历史曾转而选") {
		t.Fatalf("c0 = %#v", criteria["c0"])
	}
	if strings.Contains(criteria["c0"], "点名/") || strings.HasPrefix(criteria["c0"], "代码") || strings.Contains(criteria["c0"], "代码 —") {
		t.Fatalf("c0 should be the job trigger only, got %#v", criteria["c0"])
	}
	inst := pack.Questions["ask"].(map[string]any)["instructions"].(string)
	for _, needle := range []string{"优先级", "不确定选 none", "不算指派", "不得因曾转某同事再选", "c0 ", "c1 ", "none。只输出选项，无解释。"} {
		if !strings.Contains(inst, needle) {
			t.Fatalf("instructions missing %q: %s", needle, inst)
		}
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
	// 0.72 vs 0.28 clears both the floor and the 0.15 lead.
	snake := map[string]any{"ask": map[string]any{
		"choice":        "c0",
		"confidence":    "0.1457",
		"probabilities": map[string]any{"c0": "0.7209", "none": "0.2791"},
	}}
	if got := askTargetFromAnswers(snake, keys); got != "coder" {
		t.Fatalf("choice probability should hand off: %q", got)
	}
	weak := map[string]any{"ask": map[string]any{
		"choice":        "c0",
		"confidence":    "0.1457",
		"probabilities": map[string]any{"c0": "0.40", "none": "0.60"},
	}}
	if got := askTargetFromAnswers(weak, keys); got != "" {
		t.Fatalf("low choice probability should stay: %q", got)
	}
	// 0.504 used to clear 0.5. The floor is 0.55, so it stays even with a wide lead.
	justOver := map[string]any{"ask": map[string]any{
		"choice":        "c0",
		"confidence":    "0.9",
		"probabilities": map[string]any{"c0": "0.504", "none": "0.10"},
	}}
	if got := askTargetFromAnswers(justOver, keys); got != "" {
		t.Fatalf("0.504 should stay: %q", got)
	}
	if got := askTargetFromAnswers(map[string]any{"ask": map[string]any{"choice": "c0", "confidence": 0.52}}, keys); got != "" {
		t.Fatalf("0.52 confidence should stay: %q", got)
	}
	// A peak that clears 0.55 but does not lead the next option stays.
	narrow := map[string]any{"ask": map[string]any{
		"choice":        "c1",
		"confidence":    0.9,
		"probabilities": map[string]any{"c0": "0.41", "c1": "0.55", "none": "0.04"},
	}}
	if got := askTargetFromAnswers(narrow, keys); got != "" {
		t.Fatalf("narrow lead should stay: %q", got)
	}
	lead := map[string]any{"ask": map[string]any{
		"choice":        "c0",
		"confidence":    "0.1457",
		"probabilities": map[string]any{"c0": "0.70", "c1": "0.20", "none": "0.10"},
	}}
	if got := askTargetFromAnswers(lead, keys); got != "coder" {
		t.Fatalf("clear lead should hand off: %q", got)
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
	if !strings.Contains(inst, "不算指派") || !strings.Contains(inst, "不得因曾转某同事再选") || !strings.Contains(inst, "不确定选 none") {
		t.Fatalf("instructions: %s", inst)
	}
	if !strings.Contains(pack.State, "勿作指派依据") {
		t.Fatalf("history should not be assignment evidence:\n%s", pack.State)
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

func TestAskDecisionStateStaysInsideLayaWindow(t *testing.T) {
	self := &db.Agent{ID: "writer", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"}
	peers := []*db.Agent{{ID: "coder", Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。远程 SSH 先 load_skill host-ssh。"}}
	history := []runtimeMsg{
		{Role: "assistant", Content: strings.Repeat("社保缴费记录很长。", 80)},
		{Role: "user", Content: "帮我写个小游戏，贪吃蛇"},
	}
	pack, ok := buildAskDecision(self, peers, history)
	if !ok {
		t.Fatal("expected a pack")
	}
	if !strings.HasPrefix(pack.State, "当前：帮我写个小游戏，贪吃蛇\n（以下仅助解指代，勿作指派依据）\n会话：") {
		t.Fatalf("latest ask dropped:\n%s", pack.State)
	}
	if runeLen(pack.State) > askRouteDecisionRunes {
		t.Fatalf("state %d exceeds %d", runeLen(pack.State), askRouteDecisionRunes)
	}
	ask := pack.Questions["ask"].(map[string]any)
	inst := ask["instructions"].(string)
	if runeLen(inst) > 220 {
		t.Fatalf("instructions too long: %d %s", runeLen(inst), inst)
	}
	criteria := ask["criteria"].(map[string]string)
	if !strings.HasPrefix(criteria["none"], askNoneCriteriaLead) {
		t.Fatalf("none = %s", criteria["none"])
	}
	if runeLen(criteria["none"]) > runeLen(askNoneCriteriaLead)+askNoneJobRunes+1 {
		t.Fatalf("none criteria too long: %d %s", runeLen(criteria["none"]), criteria["none"])
	}
	if !strings.Contains(criteria["c0"], "勿选") || strings.Contains(criteria["c0"], "host-ssh") {
		t.Fatalf("c0 should be a clipped trigger, not the full job: %s", criteria["c0"])
	}
	qRunes := runeLen(inst)
	for _, text := range criteria {
		qRunes += runeLen(text)
	}
	if runeLen(pack.State)+qRunes > 1100 {
		t.Fatalf("state+questions %d exceeds the Laya window", runeLen(pack.State)+qRunes)
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
	if !strings.Contains(system, "不要再用自己的工具") || !strings.Contains(system, "不要整段复述") || !strings.Contains(system, "短接") {
		t.Fatalf("note missing: %s", system)
	}
	history, _ := payload["messages"].([]runtimeMsg)
	if len(history) != 2 || !strings.Contains(history[1].Content, "【代码】页面已写好") {
		t.Fatalf("history = %#v", history)
	}
	applyAskRouteResult(payload, "代码", "要哪个配色？", true)
	system, _ = payload["system_prompt"].(string)
	if !strings.Contains(system, "停下来等用户") || !strings.Contains(system, "不要立刻再问") {
		t.Fatalf("needs_user note missing: %s", system)
	}
}

func TestAskPeerCandidatesDropSameJob(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写手", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{
		{ID: "coder", Name: "码农", Description: "负责写代码与排障：改项目、查 bug"},
		{ID: "design", Name: "画板", Description: "负责界面设计，不改仓库"},
		{ID: "editor", Name: "润色", Description: "负责写东西与改稿：邮件、文档、文案"},
		{ID: "coder2", Name: "码农二号", Description: "负责写代码与排障：改项目、查 bug"},
		{ID: "blank", Name: "空", Description: "  "},
	}
	pack, ok := buildAskDecision(self, peers, []runtimeMsg{{Role: "user", Content: "你好"}})
	if !ok {
		t.Fatal("expected a pack")
	}
	got := map[string]bool{}
	for _, id := range pack.KeyToID {
		got[id] = true
	}
	if !got["coder"] || !got["design"] || got["editor"] || got["coder2"] || got["writer"] {
		t.Fatalf("KeyToID = %#v", pack.KeyToID)
	}
	if len(pack.KeyToID) != 2 {
		t.Fatalf("want coder and design only, got %#v", pack.KeyToID)
	}
}

func TestAskPeerCriteriaDescriptionOnly(t *testing.T) {
	got := askPeerCriteria("负责界面设计，不改仓库")
	if !strings.HasPrefix(got, "仅当最新句明确需要：负责界面设计，不改仓库") || strings.Contains(got, "点名/") || strings.Contains(got, "画板") {
		t.Fatalf("criteria = %s", got)
	}
}

func TestAskNameShortCircuitSkipsDecide(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写手", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{
		{ID: "coder", Name: "码农", Description: "负责写代码与排障"},
		{ID: "design", Name: "画板", Description: "负责界面设计，不改仓库"},
		{ID: "editor", Name: "润色", Description: "负责写东西与改稿：邮件、文档、文案"},
	}
	pack, ok := buildAskDecision(self, peers, []runtimeMsg{{Role: "user", Content: "在吗"}})
	if !ok {
		t.Fatal("expected a pack")
	}
	candidates := askPeerCandidates(self, peers)
	called := 0
	decide := func(context.Context, any, map[string]any) (map[string]any, error) {
		called++
		return map[string]any{"ask": map[string]any{"choice": "none", "confidence": "0.9"}}, nil
	}
	check := func(latest, want string, wantCall int) {
		t.Helper()
		called = 0
		got, err := resolveAskRoute(context.Background(), latest, self, candidates, pack, decide)
		if err != nil {
			t.Fatalf("%s: %v", latest, err)
		}
		if got != want || called != wantCall {
			t.Fatalf("%s: target=%q calls=%d, want %q calls=%d", latest, got, called, want, wantCall)
		}
	}
	check("@码农 修空指针", "coder", 0)
	check("登录接口空指针，帮我改代码修掉", "coder", 0)
	check("点名画板做登录页", "design", 0)
	check("点名 画板做登录页", "design", 0)
	check("@CODER 修一下", "", 1)
	coder := candidates[0]
	coder.Name = "Coder"
	check("@coder 修一下", "coder", 0)
	coder.Name = "码农"
	check("码农上次那句先别改，你帮我把开场改顺", "", 1)
	history := []runtimeMsg{
		{Role: "user", Content: "@码农 帮我写个计算器"},
		{Role: "user", Content: "【码农】计算器页面已写好。"},
		{Role: "user", Content: "今天晚饭吃什么"},
	}
	_, recent := splitAskContext(history)
	check(askLatestUser(recent), "", 1)
	check("@码农 @画板 你们一起看", "", 1)
}

func TestAskBareNameVetoStays(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写手", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{
		{ID: "coder", Name: "码农", Description: "负责写代码与排障"},
		{ID: "design", Name: "画板", Description: "负责界面设计，不改仓库"},
	}
	pack, ok := buildAskDecision(self, peers, []runtimeMsg{{Role: "user", Content: "在吗"}})
	if !ok {
		t.Fatal("expected a pack")
	}
	called := 0
	decide := func(context.Context, any, map[string]any) (map[string]any, error) {
		called++
		return map[string]any{"ask": map[string]any{
			"choice":        "c0",
			"confidence":    "0.2",
			"probabilities": map[string]any{"c0": "0.80", "c1": "0.10", "none": "0.10"},
		}}, nil
	}
	latest := "码农上次那句先别改，你帮我把开场改顺"
	got, err := resolveAskRoute(context.Background(), latest, self, peers, pack, decide)
	if err != nil {
		t.Fatal(err)
	}
	if got != "" || called != 1 {
		t.Fatalf("bare mention target=%q calls=%d", got, called)
	}
}

func TestAskKeywordShortCircuitSkipsDecide(t *testing.T) {
	self := &db.Agent{ID: "writer", Name: "写手", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{
		{ID: "coder", Name: "码农", Description: "负责写代码与排障"},
		{ID: "design", Name: "画板", Description: "负责界面设计，不改仓库"},
	}
	pack, ok := buildAskDecision(self, peers, []runtimeMsg{{Role: "user", Content: "在吗"}})
	if !ok {
		t.Fatal("expected a pack")
	}
	called := 0
	decide := func(context.Context, any, map[string]any) (map[string]any, error) {
		called++
		return map[string]any{"ask": map[string]any{"choice": "none", "confidence": "0.9"}}, nil
	}
	latest := "登录接口空指针，帮我改代码修掉"
	got, err := resolveAskRoute(context.Background(), latest, self, peers, pack, decide)
	if err != nil {
		t.Fatal(err)
	}
	if got != "coder" || called != 0 {
		t.Fatalf("keyword target=%q calls=%d", got, called)
	}
	codingSelf := &db.Agent{ID: "writer", Name: "写手", Description: "负责写代码与改稿"}
	if id := askKeywordPeer(latest, codingSelf, peers); id != "" {
		t.Fatalf("self covering code should not short-circuit, got %s", id)
	}
	both := []*db.Agent{
		{ID: "coder", Name: "码农", Description: "负责写代码与排障"},
		{ID: "coder2", Name: "另一个", Description: "负责改 bug 和空指针"},
	}
	if id := askKeywordPeer(latest, self, both); id != "" {
		t.Fatalf("two code peers should fall through, got %s", id)
	}
}
