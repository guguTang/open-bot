package httpserver

import (
	"context"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestAutoPickDecisionWhoCanWriteCodeOnlyCoder(t *testing.T) {
	// Model intent=who_can + pick=coder. No phrase tables / synonym rematch —
	// LeadFallback + closed second-wave come from the intent head.
	coder := "635d1077-5611-41bb-9fcf-2a4454d43d5a"
	r22 := "bfcea5bc-91b6-4bf7-b31a-ea45f2fcb0bf"
	r44 := "f634df70-8e30-4f71-9415-c7f80a8c0ec3"
	members := []string{coder, r22, r44}
	agents := []*db.Agent{
		{ID: coder, Name: "33", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。远程 SSH 先 load_skill host-ssh。"},
		{ID: r22, Name: "22", Description: "负责查资料与总结：搜索、阅读、整理要点。输出需可核对；重要结论注明来源或依据。"},
		{ID: r44, Name: "44", Description: "负责查资料与总结：搜索、阅读、整理要点。输出需可核对；重要结论注明来源或依据。"},
	}
	synopsis := "我（44）和 22 都能帮你查资料、阅读并整理总结。你把主题和想要的深度告诉我就行。 | 谁会写代码"
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"pick": map[string]any{
					"type":   "choice",
					"choice": "m0",
					"probabilities": map[string]any{
						"all": 0.05, "m0": 0.85, "m1": 0.05, "m2": 0.05,
					},
					"confidence": 0.82,
				},
				"count":  map[string]any{"type": "noul", "noul": 0.05},
				"intent": map[string]any{"type": "choice", "choice": "who_can", "probabilities": map[string]any{"who_can": 0.9, "new_ask": 0.1}, "confidence": 0.9},
				"bound":  map[string]any{"type": "choice", "choice": "none", "probabilities": map[string]any{"none": 0.95}},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, "谁会写代码", members, agents, coder, 1, synopsis, deps)
	if got.Method != "decision" {
		t.Fatalf("method=%s want decision", got.Method)
	}
	if got.Fallback == "all" {
		t.Fatalf("who-can must not fallback=all, got %#v", got)
	}
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("want only coder 33, got %#v", got.AgentIDs)
	}
	if got.AllowSecondFailOpen {
		t.Fatalf("who-can capable pick must not AllowSecondFailOpen (PASS must not dump peers)")
	}
	if !got.LeadFallback[coder] {
		t.Fatalf("coder must be LeadFallback so participation forbids PASS, got %#v", got.LeadFallback)
	}
	if got.LeadFallback[r22] || got.LeadFallback[r44] {
		t.Fatalf("researchers must not be LeadFallback, got %#v", got.LeadFallback)
	}
}

// Wrong model pick is trusted — no synonym / profile rematch correction path.
func TestAutoPickDecisionWhoCanTrustsModelPick(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。远程 SSH 先 load_skill host-ssh。"},
	}
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"pick": map[string]any{
					"type":   "choice",
					"choice": "m1",
					"probabilities": map[string]any{
						"all": 0.1, "m0": 0.15, "m1": 0.75,
					},
					"confidence": 0.75,
				},
				"count":  map[string]any{"type": "noul", "noul": 0.0},
				"intent": map[string]any{"type": "choice", "choice": "who_can", "probabilities": map[string]any{"who_can": 0.85}, "confidence": 0.85},
				"bound":  map[string]any{"type": "choice", "choice": "none", "probabilities": map[string]any{"none": 0.9}},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, "who can coding", members, agents, writer, 1, "", deps)
	if got.Method != "decision" {
		t.Fatalf("method=%s want decision", got.Method)
	}
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("want coder from model pick m1, got %#v", got.AgentIDs)
	}
	if got.AllowSecondFailOpen || !got.LeadFallback[coder] {
		t.Fatalf("who-can intent must close second-wave + LeadFallback, got %#v", got)
	}
}

// Specialty trusts the model pick — no synonym_mismatch rematch.
func TestSpecialtyTrustsModelPickHTMLCanvas(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。"},
	}
	ut := "给我写个html页面，选择不同的心情。生成不同的表情，用canvas，不要用svg。先给骨架即可，别太长。"
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.0"},
				"pick": map[string]any{
					"type": "choice", "choice": "m1",
					"probabilities": map[string]any{"all": "0.1", "m0": "0.2", "m1": "0.7"},
					"confidence":    "0.7",
				},
				"intent": map[string]any{"type": "choice", "choice": "new_ask", "probabilities": map[string]any{"new_ask": 0.8}, "confidence": 0.8},
				"bound":  map[string]any{"type": "choice", "choice": "none", "probabilities": map[string]any{"none": 0.9}},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, "", deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("want model pick coder m1, got %#v", got)
	}
}

// peek c5c3d672 shape: short follow-up after the coder answered an html/canvas ask.
func TestFollowUpIntentKeepsCoderOverWrongPick(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。"},
	}
	msgs := []db.Message{
		{ID: "u1", Role: "user", Content: "给我写个html页面，选择不同的心情。生成不同的表情，用canvas，不要用svg。"},
		{ID: "a1", Role: "assistant", AgentID: coder, Content: "<html>…</html>"},
		{ID: "u2", Role: "user", Content: "修改下，换成动物的表情"},
	}
	tc := buildAutoPickTurnContext(msgs, nil, members, autoPickTurnContextMax)
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count":  map[string]any{"type": "noul", "noul": "0.99"},
				"pick":   map[string]any{"type": "choice", "choice": "m0", "probabilities": map[string]any{"all": "0.15", "m0": "0.48", "m1": "0.37"}, "confidence": "0.48"},
				"intent": map[string]any{"type": "choice", "choice": "follow_up", "probabilities": map[string]any{"follow_up": "0.8", "new_ask": "0.2"}},
				"bound":  map[string]any{"type": "choice", "choice": "t1", "probabilities": map[string]any{"t1": "0.9", "none": "0.1"}},
			}, nil
		},
	}
	got := runAutoPickByModeWithTurns(db.AutoPickDecision, "修改下，换成动物的表情", members, agents, writer, 1, "", deps, tc)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("follow-up bound to coder turn must stay on coder, got %#v", got)
	}
	if got.AllowSecondFailOpen || !got.LeadFallback[coder] {
		t.Fatalf("sticky follow-up must close second-wave and forbid [PASS], got %#v", got)
	}
}
