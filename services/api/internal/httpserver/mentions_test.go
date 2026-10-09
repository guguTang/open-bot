package httpserver

import (
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestParseMentionTokens(t *testing.T) {
	got := parseMentionTokens("hi @open-bot and @通用助手, also @open-bot again")
	if len(got) != 2 {
		t.Fatalf("expected 2 unique tokens, got %#v", got)
	}
}

func TestResolveMentionedAgents(t *testing.T) {
	members := []string{"open-bot", "general", "custom-1"}
	agents := []*db.Agent{
		{ID: "open-bot", Name: "open-bot"},
		{ID: "general", Name: "通用助手"},
		{ID: "custom-1", Name: "码农助手"},
	}
	got := resolveMentionedAgents([]string{"通用助手", "custom-1"}, members, agents)
	if len(got) != 2 || got[0] != "general" || got[1] != "custom-1" {
		t.Fatalf("unexpected %#v", got)
	}
	got2 := resolveMentionedAgents([]string{"Open-Bot"}, members, agents)
	if len(got2) != 1 || got2[0] != "open-bot" {
		t.Fatalf("id case fold failed: %#v", got2)
	}
	gotAll := resolveMentionedAgents([]string{"everyone"}, members, agents)
	if len(gotAll) != 3 {
		t.Fatalf("everyone expected 3 members, got %#v", gotAll)
	}
}

func TestMentionIncludesEveryone(t *testing.T) {
	if !mentionIncludesEveryone("ping @everyone please") {
		t.Fatal("expected everyone")
	}
	if mentionIncludesEveryone("ping @open-bot") {
		t.Fatal("should not match")
	}
}

func TestResolveMentionedAgentsExactWinsOverSubstring(t *testing.T) {
	// AlphaBot listed first; exact name "Bot" must win over substring Contains.
	members := []string{"alpha-bot", "bot"}
	agents := []*db.Agent{
		{ID: "alpha-bot", Name: "AlphaBot"},
		{ID: "bot", Name: "Bot"},
	}
	got := resolveMentionedAgents([]string{"Bot"}, members, agents)
	if len(got) != 1 || got[0] != "bot" {
		t.Fatalf("exact name should win, got %#v", got)
	}
	// Substring that matches two names without an exact hit: only unique contains resolves.
	got2 := resolveMentionedAgents([]string{"Helper"}, members, []*db.Agent{
		{ID: "alpha-bot", Name: "AlphaHelper"},
		{ID: "bot", Name: "BetaHelper"},
	})
	if len(got2) != 0 {
		t.Fatalf("ambiguous substring should not resolve, got %#v", got2)
	}
	got3 := resolveMentionedAgents([]string{"Helper"}, members, []*db.Agent{
		{ID: "alpha-bot", Name: "AlphaHelper"},
		{ID: "bot", Name: "Bot"},
	})
	if len(got3) != 1 || got3[0] != "alpha-bot" {
		t.Fatalf("unique substring should resolve, got %#v", got3)
	}
}


func TestIsGroupPassReply(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"[PASS]", true},
		{"PASS", true},
		{"pass", true},
		{"  [pass]  ", true},
		{"【PASS】", true},
		{"(PASS)", true},
		{"", true},
		{"你好，我是助手", false},
		{"PASS 一下再说", false},
	}
	for _, c := range cases {
		if got := isGroupPassReply(c.in); got != c.want {
			t.Fatalf("isGroupPassReply(%q)=%v want %v", c.in, got, c.want)
		}
	}
}

func TestResolveGroupSendTargetsNoAtAllCandidates(t *testing.T) {
	members := []string{"open-bot", "general", "custom-1"}
	agents := []*db.Agent{
		{ID: "open-bot", Name: "open-bot"},
		{ID: "general", Name: "通用助手"},
		{ID: "custom-1", Name: "码农助手"},
	}
	// 「大家介绍自己」and plain greetings: no @ → all candidates (each may PASS).
	for _, content := range []string{"大家介绍自己", "你好", "今天天气怎么样"} {
		got := resolveGroupSendTargets(members, agents, nil, content, nil, "open-bot")
		if len(got) != 3 {
			t.Fatalf("%q should candidacy-all, got %#v", content, got)
		}
	}
}

func TestResolveGroupSendTargetsSpecificAtAllMentioned(t *testing.T) {
	members := []string{"open-bot", "general", "custom-1"}
	agents := []*db.Agent{
		{ID: "open-bot", Name: "open-bot"},
		{ID: "general", Name: "通用助手"},
		{ID: "custom-1", Name: "码农助手"},
	}
	got := resolveGroupSendTargets(members, agents, nil, "@通用助手 介绍一下", nil, "open-bot")
	if len(got) != 1 || got[0] != "general" {
		t.Fatalf("@某人 should be that agent, got %#v", got)
	}
	// Multiple @ → all mentioned (not first-only single-stage).
	got2 := resolveGroupSendTargets(members, agents, nil, "@通用助手 @码农助手 你们好", nil, "open-bot")
	if len(got2) != 2 || got2[0] != "general" || got2[1] != "custom-1" {
		t.Fatalf("multi @ should keep both, got %#v", got2)
	}
}

func TestResolveGroupSendTargetsEveryoneUnchanged(t *testing.T) {
	members := []string{"open-bot", "general", "custom-1"}
	agents := []*db.Agent{
		{ID: "open-bot", Name: "open-bot"},
		{ID: "general", Name: "通用助手"},
		{ID: "custom-1", Name: "码农助手"},
	}
	got := resolveGroupSendTargets(members, agents, nil, "ping @everyone please", nil, "open-bot")
	if len(got) != 3 {
		t.Fatalf("@everyone expected 3, got %#v", got)
	}
	gotAll := resolveGroupSendTargets(members, agents, nil, "@all 介绍自己", nil, "open-bot")
	if len(gotAll) != 3 {
		t.Fatalf("@all expected 3, got %#v", gotAll)
	}
}

func TestGroupForcedAgentSet(t *testing.T) {
	members := []string{"open-bot", "general", "custom-1"}
	agents := []*db.Agent{
		{ID: "open-bot", Name: "open-bot"},
		{ID: "general", Name: "通用助手"},
		{ID: "custom-1", Name: "码农助手"},
	}
	forced := groupForcedAgentSet("大家介绍自己", members, agents)
	if len(forced) != 0 {
		t.Fatalf("no @ should force none, got %#v", forced)
	}
	forced2 := groupForcedAgentSet("@通用助手 你好", members, agents)
	if !forced2["general"] || forced2["open-bot"] || len(forced2) != 1 {
		t.Fatalf("specific @ force %#v", forced2)
	}
	forced3 := groupForcedAgentSet("@everyone hi", members, agents)
	if len(forced3) != 3 || !forced3["custom-1"] {
		t.Fatalf("@everyone force all, got %#v", forced3)
	}
}

func TestResolveGroupSendTargetsReplyParentNotHardFilter(t *testing.T) {
	members := []string{"open-bot", "general", "custom-1"}
	agents := []*db.Agent{
		{ID: "open-bot", Name: "open-bot"},
		{ID: "general", Name: "通用助手"},
		{ID: "custom-1", Name: "码农助手"},
	}
	parent := &db.Message{Role: "assistant", AgentID: "custom-1"}
	got := resolveGroupSendTargets(members, agents, nil, "继续", parent, "open-bot")
	if len(got) != 3 {
		t.Fatalf("reply-parent without @ still all candidates, got %#v", got)
	}
}
