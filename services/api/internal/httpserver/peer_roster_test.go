package httpserver

import (
	"strings"
	"testing"

	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestPeerRosterSkipsSelfAndBlankDescription(t *testing.T) {
	agents := []*db.Agent{
		{ID: "self", Name: "我", Description: "负责统筹"},
		{ID: "blank", Name: "无名", Description: "  "},
		{ID: "coder", Name: "码农助手", Description: "负责写代码与排障"},
	}
	block, allow := peerRosterBlock("self", agents)
	if !allow {
		t.Fatal("expected a roster")
	}
	if strings.Contains(block, "我（self）") || strings.Contains(block, "无名") {
		t.Fatalf("roster leaked self or blank: %s", block)
	}
	if !strings.Contains(block, "码农助手（coder）：负责写代码与排障") {
		t.Fatalf("missing peer: %s", block)
	}
	if !strings.Contains(block, "不在当前群里") {
		t.Fatalf("roster should describe out-of-group peers: %s", block)
	}
}

func TestPeerRosterCapsAtTwelve(t *testing.T) {
	agents := make([]*db.Agent, 0, 14)
	for i := 0; i < 14; i++ {
		agents = append(agents, &db.Agent{
			ID:          string(rune('a'+i)) + "id",
			Name:        "助手",
			Description: "会做事",
		})
	}
	block, allow := peerRosterBlock("nobody", agents)
	if !allow {
		t.Fatal("expected a roster")
	}
	if got := strings.Count(block, "\n- "); got != peerRosterMax {
		t.Fatalf("want %d peers, got %d\n%s", peerRosterMax, got, block)
	}
}

func TestPeerRosterDepthDisablesAsk(t *testing.T) {
	agents := []*db.Agent{{ID: "coder", Name: "码农", Description: "写代码"}}
	system, allow := peerRosterSystem("self", "人设", agents, 1)
	if allow || strings.Contains(system, "同事名单") {
		t.Fatalf("child turn must not invite ask_agent: allow=%v system=%s", allow, system)
	}
	if system != "人设" {
		t.Fatalf("child system changed: %s", system)
	}
}

func TestPeerRosterExcludesSameChannelMembers(t *testing.T) {
	agents := []*db.Agent{
		{ID: "self", Name: "我", Description: "负责统筹"},
		{ID: "coder", Name: "代码", Description: "写代码"},
		{ID: "outsider", Name: "外人", Description: "查资料"},
	}
	block, allow := peerRosterBlock("self", agents, "coder")
	if !allow {
		t.Fatal("outsider should keep the roster alive")
	}
	if strings.Contains(block, "代码（coder）") {
		t.Fatalf("same-channel peer must be excluded: %s", block)
	}
	if !strings.Contains(block, "外人（outsider）") {
		t.Fatalf("out-of-group peer must remain: %s", block)
	}
	_, allowAllIn := peerRosterBlock("self", agents, "coder", "outsider")
	if allowAllIn {
		t.Fatal("excluding every peer must disable ask_agent")
	}
}
