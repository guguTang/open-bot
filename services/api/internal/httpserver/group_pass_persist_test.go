package httpserver

import (
	"testing"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

func TestSaveAssistantThreadedSkipsPassContent(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	userID := uuid.NewString()
	username := "pass-save-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
		userID, username,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agent, err := d.CreateAgent(userID, "PassBot", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.CreateConversation(userID, agent.ID, "pass-save")
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d, events: newChatHub()}
	var emitted int
	emit := func(event string, data any) { emitted++ }

	for _, text := range []string{"[PASS]", "PASS", "【PASS】", "`[PASS]`", "**[PASS]**"} {
		got := s.saveAssistantThreaded(userID, conv.ID, agent.ID, text, "", "", uuid.NewString(), emit)
		if got != nil {
			t.Fatalf("saveAssistantThreaded(%q) must be nil, got id=%s", text, got.ID)
		}
	}
	if emitted != 0 {
		t.Fatalf("PASS must not emit message_saved, emitted=%d", emitted)
	}

	msgs, err := d.ListMessages(userID, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range msgs {
		if m.Role == "assistant" {
			t.Fatalf("no assistant rows expected after PASS saves, got %+v", m)
		}
	}
}

func TestDropProjectedGroupPassRemovesJournalRow(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	userID := uuid.NewString()
	username := "pass-drop-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
		userID, username,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agent, err := d.CreateAgent(userID, "PassDropBot", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.CreateConversation(userID, agent.ID, "pass-drop")
	if err != nil {
		t.Fatal(err)
	}

	requestID := uuid.NewString()
	projected, err := d.AddMessageWithOpts(conv.ID, "assistant", "[PASS]", db.AddMessageOpts{
		AgentID:   agent.ID,
		RequestID: requestID,
	})
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d, events: newChatHub()}
	s.dropProjectedGroupPass(conv.ID, requestID)

	if _, err := d.GetMessage(userID, conv.ID, projected.ID); err == nil {
		t.Fatal("projected PASS row should be deleted")
	} else if err != db.ErrNotFound {
		// GetMessage may wrap; also accept list empty
		msgs, lerr := d.ListMessages(userID, conv.ID)
		if lerr != nil {
			t.Fatal(lerr)
		}
		for _, m := range msgs {
			if m.ID == projected.ID {
				t.Fatalf("PASS row still present: %+v", m)
			}
		}
	}

	// Forced / normal reply still persists.
	ok := s.saveAssistantThreaded(userID, conv.ID, agent.ID, "你好，我在。", "", "", uuid.NewString(), nil)
	if ok == nil {
		t.Fatal("normal assistant text must persist")
	}
}

func TestProjectHarnessEntrySkipsPass(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	userID := uuid.NewString()
	username := "pass-proj-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
		userID, username,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agent, err := d.CreateAgent(userID, "PassProjBot", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.CreateConversation(userID, agent.ID, "pass-proj")
	if err != nil {
		t.Fatal(err)
	}

	entry, err := d.AppendHarnessEntry(
		uuid.NewString(), "", userID, conv.ID, uuid.NewString(),
		"assistant", 0, map[string]any{"content": "[PASS]"},
	)
	if err != nil {
		t.Fatal(err)
	}
	msgID, err := d.ProjectHarnessEntryToMessage(
		entry.ID, conv.ID, "assistant", "[PASS]", agent.ID, uuid.NewString(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if msgID != "" {
		t.Fatalf("PASS must not project, got message_id=%s", msgID)
	}
	msgs, err := d.ListMessages(userID, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range msgs {
		if m.Role == "assistant" {
			t.Fatalf("unexpected assistant after PASS project: %+v", m)
		}
	}

	// Non-PASS still projects.
	entry2, err := d.AppendHarnessEntry(
		uuid.NewString(), "", userID, conv.ID, entry.ThreadID,
		"assistant", 0, map[string]any{"content": "正常回复"},
	)
	if err != nil {
		t.Fatal(err)
	}
	msgID2, err := d.ProjectHarnessEntryToMessage(
		entry2.ID, conv.ID, "assistant", "正常回复", agent.ID, uuid.NewString(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if msgID2 == "" {
		t.Fatal("normal assistant must project")
	}
}
