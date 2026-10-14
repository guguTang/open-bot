package httpserver

import (
	"fmt"
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// askEvalRoster is a writer who can draft, plus a coder and a designer whose
// display names do not appear inside their job text. That keeps the "no display
// name in cN" check from passing by accident.
func askEvalRoster() (*db.Agent, []*db.Agent) {
	self := &db.Agent{ID: "writer", Name: "写手", Description: "负责写东西与改稿：邮件、文档、文案"}
	peers := []*db.Agent{
		{ID: "coder", Name: "码农", Description: "负责写代码与排障：改项目、查 bug、联调"},
		{ID: "design", Name: "画板", Description: "负责界面设计，不改仓库"},
		{ID: "editor", Name: "润色", Description: "负责写东西与改稿：邮件、文档、文案"},
	}
	return self, peers
}

type askEvalRow struct {
	name     string
	expected string
	actual   string
}

// TestAskHandoffRoutingEval checks the decision pack and the answer mapper for
// the handoff cases the prompt is supposed to separate. It does not call Laya.
// Prompt cases record the state line, the cN binding, and a mapper result.
// Probability cases record askTargetFromAnswers on Laya-shaped payloads.
func TestAskHandoffRoutingEval(t *testing.T) {
	self, peers := askEvalRoster()
	rows := []askEvalRow{
		evalPromptCase(t, self, peers, "明确 @ 同事", "交接 coder", "@码农 帮我修登录空指针",
			[]runtimeMsg{{Role: "user", Content: "@码农 帮我修登录空指针"}},
			"coder", "c0"),
		evalPromptCase(t, self, peers, "明确点名同事", "交接 design", "点名画板做一版登录页",
			[]runtimeMsg{{Role: "user", Content: "点名画板做一版登录页"}},
			"design", "c1"),
		evalPromptCase(t, self, peers, "职责重叠 / 两边都能做", "留下", "这封客户邮件帮我改得正式一点",
			[]runtimeMsg{{Role: "user", Content: "这封客户邮件帮我改得正式一点"}},
			"", ""),
		evalPromptCase(t, self, peers, "闲聊", "留下", "在吗，今天过得怎么样",
			[]runtimeMsg{{Role: "user", Content: "在吗，今天过得怎么样"}},
			"", ""),
		evalPromptCase(t, self, peers, "本职盖不住的专项", "交接 coder", "登录接口空指针，帮我改代码修掉",
			[]runtimeMsg{{Role: "user", Content: "登录接口空指针，帮我改代码修掉"}},
			"coder", "c0"),
		evalHistoryNotRepicked(t, self, peers),
		evalMentionWithoutAssign(t, self, peers),
		evalPromptCase(t, self, peers, "模糊请求", "留下", "帮我弄一下",
			[]runtimeMsg{{Role: "user", Content: "帮我弄一下"}},
			"", ""),
		evalLayaProbability(t, self, peers, "Laya 高选项概率、低 entropy confidence", "交接 coder", "c0", "0.1457",
			map[string]any{"c0": "0.7209", "none": "0.2791"}, "coder"),
		evalLayaProbability(t, self, peers, "Laya 低选项概率", "留下", "c0", "0.1457",
			map[string]any{"c0": "0.40", "none": "0.60"}, ""),
	}
	var b strings.Builder
	b.WriteString("\n| 用例 | 期望 | 实测 |\n|---|---|---|\n")
	for _, row := range rows {
		b.WriteString("| " + row.name + " | " + row.expected + " | " + row.actual + " |\n")
	}
	t.Log(b.String())
}

func evalPromptCase(t *testing.T, self *db.Agent, peers []*db.Agent, name, expected, latest string, history []runtimeMsg, wantID, wantKey string) askEvalRow {
	t.Helper()
	pack, ok := buildAskDecision(self, peers, history)
	problems := askEvalShapeProblems(pack, ok, latest, peers)
	mapped := ""
	if ok && wantKey != "" {
		mapped = askTargetFromAnswers(layaChoice(wantKey, "0.7209"), pack.KeyToID)
		if mapped != wantID {
			problems = append(problems, fmt.Sprintf("map %s → %q, want %s", wantKey, mapped, wantID))
		}
		if pack.KeyToID[wantKey] != wantID {
			problems = append(problems, fmt.Sprintf("KeyToID[%s]=%s", wantKey, pack.KeyToID[wantKey]))
		}
	}
	if ok && wantKey == "" {
		mapped = askTargetFromAnswers(layaChoice("none", "0.9"), pack.KeyToID)
		if mapped != "" {
			problems = append(problems, "none mapped to "+mapped)
		}
	}
	actual := askEvalActual(pack, ok, wantKey, mapped)
	if len(problems) > 0 {
		t.Errorf("%s: %s", name, strings.Join(problems, "; "))
		actual = actual + "；失败：" + strings.Join(problems, "；")
	}
	return askEvalRow{name: name, expected: expected, actual: actual}
}

func evalHistoryNotRepicked(t *testing.T, self *db.Agent, peers []*db.Agent) askEvalRow {
	t.Helper()
	const latest = "今天晚饭吃什么"
	history := []runtimeMsg{
		{Role: "user", Content: "@码农 帮我写个计算器"},
		{Role: "user", Content: "【码农】计算器页面已写好。"},
		{Role: "user", Content: latest},
	}
	pack, ok := buildAskDecision(self, peers, history)
	problems := askEvalShapeProblems(pack, ok, latest, peers)
	if ok {
		prior := historyAfterDisclaimer(pack.State)
		if !strings.Contains(prior, "@码农 帮我写个计算器") || !strings.Contains(prior, "同事码农：") {
			problems = append(problems, "prior route missing under disclaimer")
		}
		if strings.Contains(askStateCurrentLine(pack.State), "计算器") {
			problems = append(problems, "old task is still the current line")
		}
		if strings.Contains(pack.State, "用户：【码农】") {
			problems = append(problems, "colleague note looks like the user")
		}
		if !strings.Contains(criteriaText(pack, "c0"), "勿因历史曾转而选") {
			problems = append(problems, "c0 missing do-not-repick")
		}
		if mapped := askTargetFromAnswers(layaChoice("none", "0.8"), pack.KeyToID); mapped != "" {
			problems = append(problems, "none mapped to "+mapped)
		}
	}
	actual := "留下（当前=今天晚饭吃什么；旧转在勿作指派依据之后）"
	if len(problems) > 0 {
		t.Errorf("历史曾转但最新句无关: %s", strings.Join(problems, "; "))
		actual = actual + "；失败：" + strings.Join(problems, "；")
	}
	return askEvalRow{name: "历史曾转但最新句无关", expected: "留下", actual: actual}
}

func evalMentionWithoutAssign(t *testing.T, self *db.Agent, peers []*db.Agent) askEvalRow {
	t.Helper()
	const latest = "码农上次那句先别改，你帮我把开场改顺"
	history := []runtimeMsg{
		{Role: "user", Content: "帮我写开场"},
		{Role: "user", Content: "【码农】页面已写好，计算器在这里。"},
		{Role: "user", Content: latest},
	}
	pack, ok := buildAskDecision(self, peers, history)
	problems := askEvalShapeProblems(pack, ok, latest, peers)
	if ok {
		if strings.Contains(pack.State, "用户：【码农】") {
			problems = append(problems, "quoted reply looks like a user assignment")
		}
		prior := historyAfterDisclaimer(pack.State)
		if !strings.Contains(prior, "同事码农：") || !strings.Contains(prior, "计算器在这里") {
			problems = append(problems, "quoted reply not labeled as colleague")
		}
		cur := askStateCurrentLine(pack.State)
		if !strings.Contains(cur, "码农") || !strings.Contains(cur, "开场改顺") {
			problems = append(problems, "current line lost the mention or the real ask")
		}
		inst := instructionsText(pack)
		if !strings.Contains(inst, "仅提及、引用旧回复、闲聊不算指派") {
			problems = append(problems, "instructions missing mention/quote exception")
		}
		if mapped := askTargetFromAnswers(layaChoice("none", "0.8"), pack.KeyToID); mapped != "" {
			problems = append(problems, "none mapped to "+mapped)
		}
	}
	actual := "留下（当前含码农但任务是改开场；旧回复标为同事码农）"
	if len(problems) > 0 {
		t.Errorf("顺带提及 / 引用旧回复: %s", strings.Join(problems, "; "))
		actual = actual + "；失败：" + strings.Join(problems, "；")
	}
	return askEvalRow{name: "顺带提及 / 引用旧回复", expected: "留下", actual: actual}
}

func evalLayaProbability(t *testing.T, self *db.Agent, peers []*db.Agent, name, expected, choice, confidence string, probs map[string]any, wantID string) askEvalRow {
	t.Helper()
	pack, ok := buildAskDecision(self, peers, []runtimeMsg{{Role: "user", Content: "登录接口空指针，帮我改代码修掉"}})
	problems := askEvalShapeProblems(pack, ok, "登录接口空指针，帮我改代码修掉", peers)
	got := ""
	if ok {
		got = askTargetFromAnswers(map[string]any{"ask": map[string]any{
			"choice":        choice,
			"confidence":    confidence,
			"probabilities": probs,
		}}, pack.KeyToID)
		if got != wantID {
			problems = append(problems, fmt.Sprintf("mapped %q, want %q", got, wantID))
		}
	}
	actual := "留下"
	if got != "" {
		actual = "交接 " + got
	}
	actual = fmt.Sprintf("%s（choice=%s confidence=%s p=%v）", actual, choice, confidence, probs[choice])
	if len(problems) > 0 {
		t.Errorf("%s: %s", name, strings.Join(problems, "; "))
		actual = actual + "；失败：" + strings.Join(problems, "；")
	}
	return askEvalRow{name: name, expected: expected, actual: actual}
}

func askEvalShapeProblems(pack askDecisionPack, ok bool, latest string, peers []*db.Agent) []string {
	if !ok {
		return []string{"buildAskDecision returned no pack"}
	}
	var problems []string
	head := "当前：" + latest + "\n（以下仅助解指代，勿作指派依据）\n会话：\n"
	if !strings.HasPrefix(pack.State, head) {
		problems = append(problems, "state prefix")
	}
	if runeLen(pack.State) > askRouteDecisionRunes {
		problems = append(problems, fmt.Sprintf("state runes %d", runeLen(pack.State)))
	}
	inst := instructionsText(pack)
	for _, needle := range []string{
		"只判断「当前：」后最新用户句",
		"不得因曾转某同事再选",
		"点名/@某同事→选对应 cN",
		"仅提及、引用旧回复、闲聊不算指派",
		"本职盖不住→该 cN",
		"两边都能做",
		"闲聊",
		"模糊",
		"不确定选 none",
		"只输出选项，无解释",
	} {
		if !strings.Contains(inst, needle) {
			problems = append(problems, "instructions missing "+needle)
		}
	}
	criteria, _ := pack.Questions["ask"].(map[string]any)["criteria"].(map[string]string)
	if !strings.HasPrefix(criteria["none"], askNoneCriteriaLead) {
		problems = append(problems, "none criteria lead")
	}
	if strings.HasPrefix(criteria["none"], "负责") {
		problems = append(problems, "none criteria starts with the job")
	}
	for i := 0; i < len(pack.KeyToID); i++ {
		key := fmt.Sprintf("c%d", i)
		if !strings.Contains(inst, key+" ") {
			problems = append(problems, "instructions missing "+key)
		}
		text := criteria[key]
		if !strings.HasPrefix(text, "仅当最新句明确需要：") || !strings.Contains(text, "本职能做或未点名则勿选") || !strings.Contains(text, "勿因历史曾转而选") {
			problems = append(problems, key+" criteria shape")
		}
	}
	if !strings.Contains(inst, "none。") {
		problems = append(problems, "instructions missing none")
	}
	for _, peer := range peers {
		name := strings.TrimSpace(peer.Name)
		if name == "" {
			continue
		}
		for key, text := range criteria {
			if key == "none" {
				continue
			}
			if strings.Contains(text, name) {
				problems = append(problems, key+" contains display name "+name)
			}
		}
	}
	if !strings.Contains(pack.Question, "请处理用户刚说的："+latest) {
		problems = append(problems, "question is not the latest sentence")
	}
	return problems
}

func askEvalActual(pack askDecisionPack, ok bool, wantKey, mapped string) string {
	if !ok {
		return "无决策包"
	}
	cur := strings.TrimPrefix(askStateCurrentLine(pack.State), "当前：")
	if wantKey == "" {
		return "留下（当前=" + cur + "，choice=none）"
	}
	route := "留下"
	if mapped != "" {
		route = "交接 " + mapped
	}
	return fmt.Sprintf("%s（当前=%s，%s→%s，p=0.72）", route, cur, wantKey, pack.KeyToID[wantKey])
}

func layaChoice(choice, probability string) map[string]any {
	return map[string]any{"ask": map[string]any{
		"choice":        choice,
		"confidence":    "0.1457",
		"probabilities": map[string]any{choice: probability, "none": "0.2791"},
	}}
}

func instructionsText(pack askDecisionPack) string {
	ask, _ := pack.Questions["ask"].(map[string]any)
	inst, _ := ask["instructions"].(string)
	return inst
}

func criteriaText(pack askDecisionPack, key string) string {
	ask, _ := pack.Questions["ask"].(map[string]any)
	criteria, _ := ask["criteria"].(map[string]string)
	return criteria[key]
}

func askStateCurrentLine(state string) string {
	line, _, _ := strings.Cut(state, "\n")
	return line
}

func historyAfterDisclaimer(state string) string {
	_, rest, ok := strings.Cut(state, "（以下仅助解指代，勿作指派依据）\n会话：\n")
	if !ok {
		return ""
	}
	return rest
}
