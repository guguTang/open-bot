package httpserver

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestResolveHandoffConversationPrefersChannelThenPrimary(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()
	org, err := d.EnsureDefaultOrg()
	if err != nil {
		t.Fatal(err)
	}
	uid := uuid.NewString()
	if _, err := d.SQL.Exec(`INSERT INTO users (id, username, password_hash, org_id, role, created_at)
VALUES ($1,$2,'x',$3,$4,$5)`, uid, "handoff-"+uid[:8], org.ID, db.RoleMember, db.Now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, uid) })

	from, err := d.CreateAgent(uid, "产品经理", "需求/PRD", "")
	if err != nil {
		t.Fatal(err)
	}
	to, err := d.CreateAgent(uid, "编程工程师", "写代码", "")
	if err != nil {
		t.Fatal(err)
	}

	ch, err := d.CreateChannel(uid, "handoff-ch")
	if err != nil {
		t.Fatal(err)
	}
	_ = d.AddChannelMember(uid, ch.ID, from.ID)
	_ = d.AddChannelMember(uid, ch.ID, to.ID)
	gconv, err := d.EnsureChannelConversation(uid, ch.ID, from.ID, ch.Name)
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d}

	got, err := s.resolveHandoffConversation(uid, gconv.ID, "", from.ID)
	if err != nil || got.ID != gconv.ID {
		t.Fatalf("explicit: got=%v err=%v", got, err)
	}

	got, err = s.resolveHandoffConversation(uid, "", ch.ID, from.ID)
	if err != nil || got.ID != gconv.ID {
		t.Fatalf("channel: got=%v err=%v want=%s", got, err, gconv.ID)
	}

	got, err = s.resolveHandoffConversation(uid, "", "", from.ID)
	if err != nil || got == nil {
		t.Fatalf("primary: %v", err)
	}
	if strings.TrimSpace(got.ChannelID) != "" {
		t.Fatalf("primary should be DM, got channel=%q", got.ChannelID)
	}
	if strings.HasPrefix(got.Title, "协作唤醒") {
		t.Fatalf("must not pick wake thread: %q", got.Title)
	}

	if _, err := d.CreateConversation(uid, from.ID, "协作唤醒 ← "+to.ID); err != nil {
		t.Fatal(err)
	}
	got2, err := s.resolveHandoffConversation(uid, "", "", from.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got2.ID != got.ID {
		t.Fatalf("wake must not steal primary: before=%s after=%s title=%q", got.ID, got2.ID, got2.Title)
	}
}

func TestShouldProjectHandoffSkipsBusReplies(t *testing.T) {
	to := "target"
	reply := "parent"
	msg := &db.AgentBusMessage{ToAgentID: &to, ReplyToID: &reply}
	if shouldProjectHandoff(msg) {
		t.Fatal("reply must not project")
	}
	msg.ReplyToID = nil
	if !shouldProjectHandoff(msg) {
		t.Fatal("direct to_agent must project")
	}
}

func TestFormatGroupMemberRosterIncludesIDs(t *testing.T) {
	members := []string{"coder", "writer"}
	agents := []*db.Agent{
		{ID: "coder", Name: "码农助手", Description: "负责写代码与排障"},
		{ID: "writer", Name: "写手", Description: "负责写东西与改稿"},
	}
	roster := formatGroupMemberRoster(members, agents, "coder")
	if !strings.Contains(roster, "码农助手（你）（coder）") && !strings.Contains(roster, "（coder）") {
		t.Fatalf("roster missing id: %q", roster)
	}
	if !strings.Contains(roster, "写手（writer）") {
		t.Fatalf("peer id missing: %q", roster)
	}
	prompt := groupParticipationExtraSystem(false, agents[0], members, agents)
	if !strings.Contains(prompt, "send_to_agent") {
		t.Fatalf("group prompt should teach send_to_agent handoff: %q", prompt)
	}
	if !strings.Contains(prompt, "ask_agent") {
		t.Fatalf("group prompt should forbid ask_agent for peers: %q", prompt)
	}
}

func TestUpdateHandoffStatusDetailSetsError(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()
	org, err := d.EnsureDefaultOrg()
	if err != nil {
		t.Fatal(err)
	}
	uid := uuid.NewString()
	if _, err := d.SQL.Exec(`INSERT INTO users (id, username, password_hash, org_id, role, created_at)
VALUES ($1,$2,'x',$3,$4,$5)`, uid, "handoff-err-"+uid[:8], org.ID, db.RoleMember, db.Now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, uid) })

	from, err := d.CreateAgent(uid, "产品经理", "需求", "")
	if err != nil {
		t.Fatal(err)
	}
	to, err := d.CreateAgent(uid, "文案编辑", "写文案", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.GetOrCreatePrimaryConversation(uid, from.ID)
	if err != nil {
		t.Fatal(err)
	}
	agentMsgID := uuid.NewString()
	_, _, err = d.AddHandoffNote(conv.ID, "", db.HandoffPayload{
		FromBot: from.Name, ToBot: to.Name, Purpose: "probe", Status: "running", AgentMessageID: agentMsgID,
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := d.UpdateHandoffStatusDetail(agentMsgID, "failed", "upstream HTTP 400: flagged")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Handoff == nil || updated.Handoff.Status != "failed" || updated.Handoff.Error != "upstream HTTP 400: flagged" {
		t.Fatalf("want failed+error, got %#v", updated.Handoff)
	}
	cleared, err := d.UpdateHandoffStatusDetail(agentMsgID, "done", "")
	if err != nil {
		t.Fatal(err)
	}
	if cleared.Handoff.Status != "done" || cleared.Handoff.Error != "" {
		t.Fatalf("done should clear error: %#v", cleared.Handoff)
	}
}

func TestProjectHandoffReplyPrefersCardConversation(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()
	org, err := d.EnsureDefaultOrg()
	if err != nil {
		t.Fatal(err)
	}
	uid := uuid.NewString()
	if _, err := d.SQL.Exec(`INSERT INTO users (id, username, password_hash, org_id, role, created_at)
VALUES ($1,$2,'x',$3,$4,$5)`, uid, "handoff-reply-"+uid[:8], org.ID, db.RoleMember, db.Now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, uid) })

	from, err := d.CreateAgent(uid, "编程工程师", "写代码", "")
	if err != nil {
		t.Fatal(err)
	}
	to, err := d.CreateAgent(uid, "文案编辑", "写文案", "")
	if err != nil {
		t.Fatal(err)
	}
	primary, err := d.GetOrCreatePrimaryConversation(uid, from.ID)
	if err != nil {
		t.Fatal(err)
	}
	side, err := d.CreateConversation(uid, from.ID, "side-dm")
	if err != nil {
		t.Fatal(err)
	}
	agentMsgID := uuid.NewString()
	_, _, err = d.AddHandoffNote(side.ID, "", db.HandoffPayload{
		FromBot: from.Name, ToBot: to.Name, Purpose: "title", Status: "running", AgentMessageID: agentMsgID,
	})
	if err != nil {
		t.Fatal(err)
	}
	toID := to.ID
	msg := &db.AgentBusMessage{ID: agentMsgID, UserID: uid, FromAgentID: from.ID, ToAgentID: &toID, Body: "title", Priority: true}
	s := &Server{db: d}
	s.projectHandoffReply(uid, msg, "智能协作，一触即达")
	sideMsgs, err := d.ListMessages(uid, side.ID)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range sideMsgs {
		if m.Role == "assistant" && m.AgentID == to.ID && strings.Contains(m.Content, "智能协作") {
			found = true
		}
	}
	if !found {
		t.Fatalf("reply must land on card conversation %s, not primary %s", side.ID, primary.ID)
	}
}
