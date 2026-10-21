package httpserver

import (
	"context"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Langfuse peek cf23a7b79efcff16 / trace 3359d06ad6b8597f75eed8d39ee08ca2
// utterance 「大家好」; SystemOne choice=all noul≈0.99; only 文章 replied in prod
// because Go client hit 8s timeout while decide finished in ~7.3s → heuristic lead-only.
func TestReproLangfuseCF23DaJiaHao(t *testing.T) {
	writer := &db.Agent{ID: "b82b2fbe-c621-4943-aff0-f59e7fc075b6", Name: "文章", SystemPrompt: "负责写东西与改稿"}
	coder := &db.Agent{ID: "cb6df594-f972-4a7c-8efd-daeb6dcb7ece", Name: "代码", SystemPrompt: "负责写代码与排障"}
	members := []string{writer.ID, coder.ID}
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.9924"},
				"pick": map[string]any{
					"type":          "choice",
					"choice":        "all",
					"probabilities": map[string]any{"all": "0.8471", "m0": "0.1053", "m1": "0.0476"},
					"confidence":    "0.5244",
				},
			}, nil
		},
	}
	got := runAutoPickByMode("decision", "大家好", members, []*db.Agent{writer, coder}, writer.ID, 1, "大家好", deps)
	t.Logf("got=%#v", got)
	if got.Method != "decision" {
		t.Fatalf("method=%s want decision", got.Method)
	}
	if len(got.AgentIDs) != 2 {
		t.Fatalf("want both members, got %v", got.AgentIDs)
	}
	if !got.LeadFallback[writer.ID] || !got.LeadFallback[coder.ID] {
		t.Fatalf("LeadFallback want both, got %#v", got.LeadFallback)
	}
	if got.AllowSecondFailOpen {
		t.Fatalf("all-hands must not AllowSecondFailOpen")
	}
	if got.Fallback != "all" {
		t.Fatalf("fallback=%q want all", got.Fallback)
	}
}

func TestReproLangfuseCF23DecideTimeoutFailOpenAll(t *testing.T) {
	writer := &db.Agent{ID: "b82b2fbe-c621-4943-aff0-f59e7fc075b6", Name: "文章", SystemPrompt: "负责写东西与改稿"}
	coder := &db.Agent{ID: "cb6df594-f972-4a7c-8efd-daeb6dcb7ece", Name: "代码", SystemPrompt: "负责写代码与排障"}
	members := []string{writer.ID, coder.ID}
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return nil, context.DeadlineExceeded
		},
	}
	got := runAutoPickByMode("decision", "大家好", members, []*db.Agent{writer, coder}, writer.ID, 1, "", deps)
	if got.Method != "decision->heuristic" || got.Fallback != "all" || len(got.AgentIDs) != 2 {
		t.Fatalf("timeout must fail-open all (not lead-only), got %#v", got)
	}
	if got.AllowSecondFailOpen {
		t.Fatalf("no second-wave on all fail-open: %#v", got)
	}
	if got.LeadFallback[writer.ID] || got.LeadFallback[coder.ID] {
		t.Fatalf("broad decide-fail must not LeadFallback (PASS ok), got %#v", got.LeadFallback)
	}
}

func TestReproUnderpickFullRosterCountExpand(t *testing.T) {
	// choice=m0 + count=N must NOT expand (full_roster_count_expand removed).
	// Only explicit choice=all means everyone — see TestAutoPickDecisionNoCountExpandUnderpick.
	writer := &db.Agent{ID: "writer", Name: "文章", Description: "负责写东西与改稿"}
	coder := &db.Agent{ID: "coder", Name: "代码", Description: "负责写代码与排障"}
	members := []string{"writer", "coder"}
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"pick": map[string]any{
					"type":   "choice",
					"choice": "m0",
					"probabilities": map[string]any{
						"all": 0.2446, "m0": 0.5023, "m1": 0.2531,
					},
					"confidence": 0.55,
				},
				"count": map[string]any{"type": "noul", "noul": 0.9778},
			}, nil
		},
	}
	got := runAutoPickByMode("decision", "在座的各位都是辣鸡", members, []*db.Agent{writer, coder}, "writer", 1, "", deps)
	if got.Method != "decision" || len(got.AgentIDs) != 1 || got.AgentIDs[0] != "writer" {
		t.Fatalf("underpick mN must NOT count-expand, got %#v", got)
	}
	if got.Fallback == "all" {
		t.Fatalf("must not Fallback=all from underpick, got %#v", got)
	}
}
