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
