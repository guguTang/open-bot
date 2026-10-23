package httpserver

import (
	"context"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func designerTrio() (writer, coder, designer string, members []string, agents []*db.Agent) {
	writer = "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder = "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	designer = "fa17ef20-36af-4e9c-aeb9-7b2e0699d591"
	members = []string{writer, coder, designer}
	agents = []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。"},
		{ID: designer, Name: "设计", Description: "负责 UI/UE 设计：信息架构、交互流程、视觉稿与组件规范。先澄清目标与约束，再出线框/稿；只出方案，不直接改仓库落地。"},
	}
	return
}

// Model pick of designer is trusted — no synonym rematch correction.
func TestDesignDecisionTrustsModelPick(t *testing.T) {
	writer, _, designer, members, agents := designerTrio()
	ut := "画一个登录页线框，侧重点击态"
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.0"},
				"pick": map[string]any{
					"type":          "choice",
					"choice":        "m2",
					"probabilities": map[string]any{"all": "0.1", "m0": "0.1", "m1": "0.1", "m2": "0.7"},
					"confidence":    "0.7",
				},
				"intent": map[string]any{"type": "choice", "choice": "new_ask", "probabilities": map[string]any{"new_ask": 0.85}, "confidence": 0.85},
				"bound":  map[string]any{"type": "choice", "choice": "none", "probabilities": map[string]any{"none": 0.9}},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, "", deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("want model pick designer m2, got %#v", got)
	}
}

func TestWhoCanDesignCensusViaIntent(t *testing.T) {
	writer, _, designer, members, agents := designerTrio()
	ut := "谁会做 UI/UE 设计"
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.0"},
				"pick": map[string]any{
					"type":          "choice",
					"choice":        "m2",
					"probabilities": map[string]any{"all": "0.1", "m0": "0.1", "m1": "0.1", "m2": "0.7"},
					"confidence":    "0.7",
				},
				"intent": map[string]any{"type": "choice", "choice": "who_can", "probabilities": map[string]any{"who_can": 0.9}, "confidence": 0.9},
				"bound":  map[string]any{"type": "choice", "choice": "none", "probabilities": map[string]any{"none": 0.9}},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, "", deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("who-can design → designer only, got %#v", got)
	}
	if got.AllowSecondFailOpen || !got.LeadFallback[designer] {
		t.Fatalf("who-can intent must LeadFallback designer, got %#v", got)
	}
}

func TestHeuristicDesignWireframe(t *testing.T) {
	_, _, designer, members, agents := designerTrio()
	got := autoPickHeuristic("画一个登录页线框，侧重点击态", members, agents, designer, 1, "")
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("heuristic wireframe → designer, got %#v", got)
	}
}
