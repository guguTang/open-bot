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

func TestDesignSynonymBucketHitsWireframe(t *testing.T) {
	ut := "画一个登录页线框，侧重点击态"
	if !userTextHitsRoleSynonym(ut) {
		t.Fatal("wireframe ask must hit design synonym bucket")
	}
	_, _, designer, members, agents := designerTrio()
	got := capableIDsFromRoleMatch(ut, members, agents, "")
	if len(got) != 1 || got[0] != designer {
		t.Fatalf("capable for wireframe → designer only, got %v", got)
	}
}

func TestSpecialtyMismatchChoiceAllRematchDesigner(t *testing.T) {
	writer, coder, designer, members, agents := designerTrio()
	ut := "画一个登录页线框，侧重点击态"
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			// Live Laya shape: choice=all + low conf; specialty rematch must recover designer.
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.03"},
				"pick": map[string]any{
					"type":         "choice",
					"choice":       "all",
					"probabilities": map[string]any{"all": "0.3886", "m0": "0.2399", "m1": "0.0896", "m2": "0.2819"},
					"confidence":   "0.07",
				},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, "", deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("choice=all low-conf must specialty-rematch designer, got %#v", got)
	}
	if got.Fallback == "all" || got.LeadFallback[writer] || got.LeadFallback[coder] || got.LeadFallback[designer] {
		t.Fatalf("specialty rematch must not LeadFallback/all, got %#v", got)
	}
	if got.AllowSecondFailOpen {
		t.Fatal("specialty rematch must close second-wave")
	}
}

func TestWhoCanDesignCensus(t *testing.T) {
	writer, _, designer, members, agents := designerTrio()
	ut := "谁会做 UI/UE 设计"
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.99"},
				"pick": map[string]any{
					"type":         "choice",
					"choice":       "all",
					"probabilities": map[string]any{"all": "0.5", "m0": "0.2", "m1": "0.1", "m2": "0.2"},
					"confidence":   "0.5",
				},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, "", deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("who-can design → designer only, got %#v", got)
	}
}

func TestSpecialtyDesignVsCoding(t *testing.T) {
	writer, coder, designer, members, agents := designerTrio()
	depsDesign := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.1"},
				"pick": map[string]any{
					"type": "choice", "choice": "m1",
					"probabilities": map[string]any{"all": "0.1", "m0": "0.1", "m1": "0.5", "m2": "0.3"},
					"confidence":    "0.5",
				},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, "出个设置页交互稿和组件规范", members, agents, writer, 1, "", depsDesign)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("交互稿 specialty wrong m1 must rematch designer, got %#v", got)
	}

	depsCode := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.1"},
				"pick": map[string]any{
					"type": "choice", "choice": "m2",
					"probabilities": map[string]any{"all": "0.1", "m0": "0.1", "m1": "0.3", "m2": "0.5"},
					"confidence":    "0.5",
				},
			}, nil
		},
	}
	got2 := runAutoPickByMode(db.AutoPickDecision, "写个html canvas 心情表情页", members, agents, writer, 1, "", depsCode)
	if len(got2.AgentIDs) != 1 || got2.AgentIDs[0] != coder {
		t.Fatalf("html/canvas specialty wrong m2 must rematch coder, got %#v", got2)
	}
}

func TestHeuristicDesignWireframe(t *testing.T) {
	_, _, designer, members, agents := designerTrio()
	got := autoPickHeuristic("画一个登录页线框，侧重点击态", members, agents, designer, 1, "")
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != designer {
		t.Fatalf("heuristic wireframe → designer, got %#v", got)
	}
}
