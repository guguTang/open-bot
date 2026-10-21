package httpserver

import (
	"context"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestAutoPickDecisionWhoCanWriteCodeOnlyCoder(t *testing.T) {
	// Production 2026-10-12 11:41 CST needed only coder 33. Prompt now teaches SystemOne
	// to pick that mN (not choice=all). Mock the desired model output; mapping must trust
	// choice+count+probs (no role-match remap). Capable picks: LeadFallback (forbid PASS)
	// + AllowSecondFailOpen=false so a [PASS] cannot silence or second-wave dump 22+44.
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
				"count": map[string]any{"type": "noul", "noul": 0.05},
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

func TestIsWhoCanIntentWriteCode(t *testing.T) {
	if !isWhoCanIntent("谁会写代码") {
		t.Fatal(`want who-can for "谁会写代码"`)
	}
}

func TestIsWhoCanIntentWhoCanCoding(t *testing.T) {
	if !isWhoCanIntent("who can coding") {
		t.Fatal(`want who-can for "who can coding"`)
	}
	if !userTextHitsRoleSynonym("who can coding") {
		t.Fatal(`"coding" must hit coding role synonym bucket (not only substring "code")`)
	}
}

// Channel 333 17:38 CST: members ORDER BY agent_id → 文章=m0, 代码=m1.
// SystemOne chose writer m0 @0.53 for 「who can coding」; must rematch to coder via
// Member capability profiles (who_can_profile_match), not accept the wrong mN.
func TestAutoPickDecisionWhoCanCodingRejectsWriter(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6" // sorts before coder → m0
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"  // m1
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。远程 SSH 先 load_skill host-ssh。"},
	}
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			// Production 17:38 shape: primary writer, weak mass on coder, conf above floor.
			return map[string]any{
				"pick": map[string]any{
					"type":   "choice",
					"choice": "m0",
					"probabilities": map[string]any{
						"all": 0.3096, "m0": 0.5318, "m1": 0.1586,
					},
					"confidence": 0.53,
				},
				"count": map[string]any{"type": "noul", "noul": 1.0}, // model said count=2
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, "who can coding", members, agents, writer, 1, "", deps)
	if got.Method != "decision" {
		t.Fatalf("method=%s want decision (profile rematch, not fail-open)", got.Method)
	}
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("want only coder 代码, got %#v", got.AgentIDs)
	}
	if got.AllowSecondFailOpen {
		t.Fatalf("who-can capable pick must not AllowSecondFailOpen")
	}
	if !got.LeadFallback[coder] {
		t.Fatalf("coder must be LeadFallback after rematch, got %#v", got.LeadFallback)
	}
	if got.LeadFallback[writer] {
		t.Fatalf("writer must not be LeadFallback after rematch, got %#v", got.LeadFallback)
	}
}

func TestCapableIDsFromRoleMatchWhoCanCoding(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。"},
	}
	got := capableIDsFromRoleMatch("who can coding", members, agents, "")
	if len(got) != 1 || got[0] != coder {
		t.Fatalf("want only coder, got %#v", got)
	}
}

// Writer blurb contains 「先给草稿」; ask 「…先给骨架…html/canvas」 used to score both
// bots via generic bigram 「先给」, so specialty_mismatch never fired and wrong m0(文章)
// stuck. Synonym-bucket filter keeps only the coding profile.
func TestCapableIDsHTMLCanvasIgnoresXianGeiResidue(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。"},
	}
	ut := "给我写个html页面，选择不同的心情。生成不同的表情，用canvas，不要用svg。先给骨架即可，别太长。"
	if !userTextHitsRoleSynonym(ut) {
		t.Fatal("html/canvas ask must hit coding synonym")
	}
	got := capableIDsFromRoleMatch(ut, members, agents, "")
	if len(got) != 1 || got[0] != coder {
		t.Fatalf("want only coder (ignore 先给 residue on writer), got %#v", got)
	}
	if !specialtyPicksIncapable([]string{writer}, got) {
		t.Fatal("writer-only map must be specialty-incapable vs coder capable set")
	}
}

func TestSpecialtyMismatchHTMLCanvasWrongM0WithXianGei(t *testing.T) {
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
				"count": map[string]any{"type": "noul", "noul": "0.99"},
				"pick": map[string]any{
					"type": "choice", "choice": "m0",
					"probabilities": map[string]any{"all": "0.2373", "m0": "0.4288", "m1": "0.3339"},
					"confidence": "0.43",
				},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, "", deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("wrong m0 must specialty-mismatch fail-open to coder, got %#v", got)
	}
	if got.Fallback == "all" || got.LeadFallback[writer] || got.LeadFallback[coder] {
		t.Fatalf("specialty recover must not LeadFallback/all, got %#v", got)
	}
	if got.AllowSecondFailOpen {
		t.Fatal("specialty path must close second-wave")
	}
}

// peek c5c3d672 shape: short follow-up has no coding needles; intent join binds html/canvas
// prior. Wrong choice=m0(文章) must specialty_mismatch_profile_match → coder.
func TestSpecialtyMismatchFollowUpUsesJoinedIntent(t *testing.T) {
	writer := "b82b2fbe-c621-4943-aff0-f59e7fc075b6"
	coder := "cb6df594-f972-4a7c-8efd-daeb6dcb7ece"
	members := []string{writer, coder}
	agents := []*db.Agent{
		{ID: writer, Name: "文章", Description: "负责写东西与改稿：邮件、文档、文案。尊重用户语气；定稿外发前先给草稿。"},
		{ID: coder, Name: "代码", Description: "负责写代码与排障：改项目、查 bug、联调。小步验证；危险操作需确认。"},
	}
	ut := "修改下，换成动物的表情"
	syn := "User: 给我写个html页面，选择不同的心情。生成不同的表情，用canvas，不要用svg。先给骨架即可，别太长。 | Last answered by: 代码 — 写代码与排障…"
	if userTextHitsRoleSynonym(ut) {
		t.Fatal("raw follow-up must not hit specialty synonym (no needle spam on short ask)")
	}
	probe := specialtyProbeText(ut, syn)
	if !userTextHitsRoleSynonym(probe) {
		t.Fatalf("joined intent probe must hit coding synonym, got %q", probe)
	}
	deps := &autoPickDecisionDeps{
		Provider: "laya",
		Decide: func(ctx context.Context, state any, questions map[string]any) (map[string]any, error) {
			return map[string]any{
				"count": map[string]any{"type": "noul", "noul": "0.99"},
				"pick": map[string]any{
					"type": "choice", "choice": "m0",
					"probabilities": map[string]any{"all": "0.15", "m0": "0.48", "m1": "0.37"},
					"confidence": "0.48",
				},
			}, nil
		},
	}
	got := runAutoPickByMode(db.AutoPickDecision, ut, members, agents, writer, 1, syn, deps)
	if len(got.AgentIDs) != 1 || got.AgentIDs[0] != coder {
		t.Fatalf("follow-up wrong m0 must rematch to coder via joined intent, got %#v", got)
	}
	if got.AllowSecondFailOpen {
		t.Fatal("follow-up specialty rematch must close second-wave")
	}
}
