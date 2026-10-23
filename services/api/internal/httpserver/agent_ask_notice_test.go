package httpserver

import (
	"testing"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestEnsureAskNoticeSkippedForSameGroupMember(t *testing.T) {
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
VALUES ($1,$2,'x',$3,$4,$5)`, uid, "ask-notice-"+uid[:8], org.ID, db.RoleMember, db.Now()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = d.SQL.Exec(`DELETE FROM users WHERE id=$1`, uid) })

	lead, err := d.CreateAgent(uid, "主助理", "统筹", "")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := d.CreateAgent(uid, "设计", "做设计", "")
	if err != nil {
		t.Fatal(err)
	}
	outsider, err := d.CreateAgent(uid, "外人", "不在群里", "")
	if err != nil {
		t.Fatal(err)
	}
	ch, err := d.CreateChannel(uid, "通知测试群")
	if err != nil {
		t.Fatal(err)
	}
	_ = d.AddChannelMember(uid, ch.ID, lead.ID)
	_ = d.AddChannelMember(uid, ch.ID, peer.ID)
	groupConv, err := d.EnsureChannelConversation(uid, ch.ID, lead.ID, ch.Name)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{db: d, events: newChatHub(), convEvents: newConversationEventHub()}

	countNotices := func(convID string) int {
		msgs, err := d.ListMessages(uid, convID)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, m := range msgs {
			if m.Role == "ask_notice" {
				n++
			}
		}
		return n
	}

	// Same-group peer: no gray 「消息通知了」 line — reply path still posts the bubble.
	s.ensureAskNoticeOnParent(uid, groupConv.ID, peer.ID, peer.Name, "key-same-group")
	if got := countNotices(groupConv.ID); got != 0 {
		t.Fatalf("same-group ask must skip ask_notice, got %d", got)
	}
	if !s.agentInParentChannel(uid, groupConv.ID, peer.ID) {
		t.Fatal("peer should be detected as channel member")
	}
	if s.agentInParentChannel(uid, groupConv.ID, outsider.ID) {
		t.Fatal("outsider must not count as channel member")
	}

	// Outsider asked from the group: keep the notice so the user sees who was pinged.
	s.ensureAskNoticeOnParent(uid, groupConv.ID, outsider.ID, outsider.Name, "key-outsider")
	if got := countNotices(groupConv.ID); got != 1 {
		t.Fatalf("outsider ask should insert one ask_notice, got %d", got)
	}

	// DM parent: keep notice even when asking any peer (no channel membership).
	dm, err := d.GetOrCreatePrimaryConversation(uid, lead.ID)
	if err != nil {
		t.Fatal(err)
	}
	s.ensureAskNoticeOnParent(uid, dm.ID, peer.ID, peer.Name, "key-dm")
	if got := countNotices(dm.ID); got != 1 {
		t.Fatalf("DM ask should keep ask_notice, got %d", got)
	}
}
