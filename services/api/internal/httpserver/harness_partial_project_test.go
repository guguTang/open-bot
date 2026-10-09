package httpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/tangxin/open-bot/services/api/internal/db"
)

// Mid-turn assistant_partial projections must not occupy request_id, so the
// HTTP finish path's FindAssistantByRequestID / saveAssistantThreaded dedupe
// targets only the final assistant row for the run.
func TestHarnessEntryPartialOmitsRequestID(t *testing.T) {
	d, err := db.Open("")
	if err != nil {
		t.Skip(err)
	}
	defer d.Close()

	userID := uuid.NewString()
	username := "partial-req-" + userID[:8]
	if _, err := d.SQL.Exec(
		`INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`,
		userID, username,
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = d.SQL.Exec(`DELETE FROM users WHERE id = $1`, userID)
	})

	agent, err := d.CreateAgent(userID, "PartialReqBot", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := d.CreateConversation(userID, agent.ID, "partial-req")
	if err != nil {
		t.Fatal(err)
	}

	s := &Server{db: d, events: newChatHub()}
	requestID := uuid.NewString()
	threadID := uuid.NewString()

	post := func(kind, content string) string {
		t.Helper()
		body, _ := json.Marshal(map[string]any{
			"entry_id":        uuid.NewString(),
			"org_id":          "",
			"user_id":         userID,
			"conversation_id": conv.ID,
			"thread_id":       threadID,
			"request_id":      requestID,
			"agent_id":        agent.ID,
			"kind":            kind,
			"role":            "assistant",
			"content":         content,
			"project":         true,
			"payload":         map[string]any{"role": "assistant", "content": content},
		})
		req := httptest.NewRequest(http.MethodPost, "/internal/harness/entries", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		s.handleInternalHarnessEntry(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		var out struct {
			MessageID string `json:"message_id"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.MessageID == "" {
			t.Fatal("expected projected message_id")
		}
		return out.MessageID
	}

	partialID := post("assistant_partial", "先做一步…")
	finalID := post("assistant", "最终结论")

	var partialReq, finalReq string
	if err := d.SQL.QueryRow(
		`SELECT COALESCE(request_id,'') FROM messages WHERE id = $1`, partialID,
	).Scan(&partialReq); err != nil {
		t.Fatal(err)
	}
	if err := d.SQL.QueryRow(
		`SELECT COALESCE(request_id,'') FROM messages WHERE id = $1`, finalID,
	).Scan(&finalReq); err != nil {
		t.Fatal(err)
	}
	if partialReq != "" {
		t.Fatalf("assistant_partial must omit request_id, got %q", partialReq)
	}
	if finalReq != requestID {
		t.Fatalf("final assistant request_id=%q want %q", finalReq, requestID)
	}

	found, err := d.FindAssistantByRequestID(conv.ID, requestID)
	if err != nil {
		t.Fatal(err)
	}
	if found.ID != finalID {
		t.Fatalf("FindAssistantByRequestID=%s want final=%s", found.ID, finalID)
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
	if len(assistants) != 2 {
		t.Fatalf("assistant count=%d want 2", len(assistants))
	}
	if assistants[0].ID != partialID || assistants[1].ID != finalID {
		t.Fatalf("order want partial then final, got %+v", assistants)
	}
}
