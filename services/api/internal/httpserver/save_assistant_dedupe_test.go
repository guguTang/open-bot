package httpserver

import (
	"testing"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Durable harness projects the assistant via journal (project=True) before the
// HTTP finish path runs. saveAssistantThreaded must reuse that row so one turn
// does not leave two identical assistant messages in DB/UI.
func TestSaveAssistantThreadedReusesProjectedByRequestID(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	userID := uuid.NewString()
	username := "dedupe-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
		userID, username,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agent, err := d.CreateAgent(userID, "DedupeBot", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.CreateConversation(userID, agent.ID, "dedupe")
	if err != nil {
		t.Fatal(err)
	}

	requestID := uuid.NewString()
	text := "同一条回复不应入库两次"
	projected, err := d.AddMessageWithOpts(conv.ID, "assistant", text, db.AddMessageOpts{
		AgentID:   agent.ID,
		RequestID: requestID,
	})
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d, events: newChatHub()}
	var savedIDs []string
	emit := func(event string, data any) {
		if event != "meta" {
			return
		}
		m, _ := data.(map[string]any)
		if m == nil {
			return
		}
		if phase, _ := m["phase"].(string); phase != "message_saved" {
			return
		}
		if id, ok := m["message_id"].(string); ok {
			savedIDs = append(savedIDs, id)
		}
	}

	got := s.saveAssistantThreaded(userID, conv.ID, agent.ID, text, "", "", requestID, emit)
	if got == nil {
		t.Fatal("expected reused message")
	}
	if got.ID != projected.ID {
		t.Fatalf("reused id=%s want projected=%s", got.ID, projected.ID)
	}
	if len(savedIDs) != 1 || savedIDs[0] != projected.ID {
		t.Fatalf("message_saved ids=%v want [%s]", savedIDs, projected.ID)
	}

	msgs, err := d.ListMessages(userID, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	var assistants []db.Message
	for _, m := range msgs {
		if m.Role == "assistant" {
			assistants = append(assistants, m)
		}
	}
	if len(assistants) != 1 {
		t.Fatalf("assistant count=%d want 1 (got %+v)", len(assistants), assistants)
	}
	if assistants[0].Content != text {
		t.Fatalf("content=%q", assistants[0].Content)
	}
}

func TestSaveAssistantThreadedInsertsWhenNoProjection(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	userID := uuid.NewString()
	username := "dedupe2-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
		userID, username,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agent, err := d.CreateAgent(userID, "DedupeBot2", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.CreateConversation(userID, agent.ID, "dedupe2")
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d, events: newChatHub()}
	requestID := uuid.NewString()
	text := "首次落库"
	got := s.saveAssistantThreaded(userID, conv.ID, agent.ID, text, "", "", requestID, nil)
	if got == nil {
		t.Fatal("expected insert")
	}
	if got.RequestID != requestID {
		t.Fatalf("request_id=%q want %q", got.RequestID, requestID)
	}

	// Second call with same request_id must not insert again.
	again := s.saveAssistantThreaded(userID, conv.ID, agent.ID, text, "", "", requestID, nil)
	if again == nil || again.ID != got.ID {
		t.Fatalf("second save should reuse id=%s got=%v", got.ID, again)
	}

	msgs, err := d.ListMessages(userID, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, m := range msgs {
		if m.Role == "assistant" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("assistant count=%d want 1", n)
	}
}
