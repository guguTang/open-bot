package db

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// migrateHarnessJournal creates durable run journal tables (LangGraph harness).
func (d *DB) migrateHarnessJournal() error {
	_, err := d.SQL.Exec(`
CREATE TABLE IF NOT EXISTS harness_threads (
  thread_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  org_id TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  langfuse_trace_id TEXT NOT NULL DEFAULT '',
  owner_thread_id TEXT NOT NULL DEFAULT '',
  background BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_harness_threads_conv ON harness_threads(conversation_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_harness_threads_status ON harness_threads(status, updated_at DESC)
  WHERE status IN ('running', 'interrupted', 'waiting_approval');
CREATE INDEX IF NOT EXISTS idx_harness_threads_request ON harness_threads(conversation_id, request_id);

CREATE TABLE IF NOT EXISTS harness_entries (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL DEFAULT '',
  seq BIGINT NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  projected_message_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_entries_thread_seq ON harness_entries(thread_id, seq);
CREATE INDEX IF NOT EXISTS idx_harness_entries_conv ON harness_entries(conversation_id, seq);

CREATE TABLE IF NOT EXISTS harness_docs (
  thread_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, kind)
);
`)
	return err
}

type HarnessEntry struct {
	ID                 string
	OrgID              string
	UserID             string
	ConversationID     string
	ThreadID           string
	Seq                int64
	Kind               string
	Payload            json.RawMessage
	ProjectedMessageID string
	CreatedAt          time.Time
}

// UpsertHarnessThread records or updates a durable run thread.
func (d *DB) UpsertHarnessThread(
	threadID, conversationID, userID, orgID, agentID, requestID, status, langfuseTraceID string,
	ownerThreadID string, background bool,
) error {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return errors.New("thread_id required")
	}
	now := Now()
	_, err := d.SQL.Exec(`
INSERT INTO harness_threads (
  thread_id, conversation_id, user_id, org_id, agent_id, request_id, status,
  langfuse_trace_id, owner_thread_id, background, created_at, updated_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
ON CONFLICT (thread_id) DO UPDATE SET
  conversation_id = EXCLUDED.conversation_id,
  user_id = COALESCE(NULLIF(EXCLUDED.user_id, ''), harness_threads.user_id),
  org_id = COALESCE(NULLIF(EXCLUDED.org_id, ''), harness_threads.org_id),
  agent_id = COALESCE(NULLIF(EXCLUDED.agent_id, ''), harness_threads.agent_id),
  request_id = COALESCE(NULLIF(EXCLUDED.request_id, ''), harness_threads.request_id),
  status = EXCLUDED.status,
  langfuse_trace_id = COALESCE(NULLIF(EXCLUDED.langfuse_trace_id, ''), harness_threads.langfuse_trace_id),
  owner_thread_id = COALESCE(NULLIF(EXCLUDED.owner_thread_id, ''), harness_threads.owner_thread_id),
  background = EXCLUDED.background,
  updated_at = EXCLUDED.updated_at
`, threadID, conversationID, userID, orgID, agentID, requestID, status,
		langfuseTraceID, ownerThreadID, background, now)
	return err
}

// AppendHarnessEntry inserts an immutable journal entry (idempotent on id).
// When seq <= 0, assigns next seq for the thread atomically.
func (d *DB) AppendHarnessEntry(
	id, orgID, userID, conversationID, threadID, kind string,
	seq int64, payload any,
) (*HarnessEntry, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		id = uuid.NewString()
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	now := Now()
	var e HarnessEntry
	if seq <= 0 {
		err = d.SQL.QueryRow(`
WITH next AS (
  SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM harness_entries WHERE thread_id = $5
)
INSERT INTO harness_entries (
  id, org_id, user_id, conversation_id, thread_id, seq, kind, payload, created_at
) SELECT $1,$2,$3,$4,$5, next.seq, $6,$7::jsonb,$8 FROM next
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING id, org_id, user_id, conversation_id, thread_id, seq, kind, payload, projected_message_id, created_at
`, id, orgID, userID, conversationID, threadID, kind, string(raw), now).Scan(
			&e.ID, &e.OrgID, &e.UserID, &e.ConversationID, &e.ThreadID, &e.Seq, &e.Kind,
			&e.Payload, &e.ProjectedMessageID, &e.CreatedAt,
		)
	} else {
		err = d.SQL.QueryRow(`
INSERT INTO harness_entries (
  id, org_id, user_id, conversation_id, thread_id, seq, kind, payload, created_at
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
RETURNING id, org_id, user_id, conversation_id, thread_id, seq, kind, payload, projected_message_id, created_at
`, id, orgID, userID, conversationID, threadID, seq, kind, string(raw), now).Scan(
			&e.ID, &e.OrgID, &e.UserID, &e.ConversationID, &e.ThreadID, &e.Seq, &e.Kind,
			&e.Payload, &e.ProjectedMessageID, &e.CreatedAt,
		)
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// PutHarnessDoc upserts a typed document for a thread.
func (d *DB) PutHarnessDoc(threadID, kind string, data any) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	now := Now()
	_, err = d.SQL.Exec(`
INSERT INTO harness_docs (thread_id, kind, version, data, updated_at)
VALUES ($1,$2,1,$3::jsonb,$4)
ON CONFLICT (thread_id, kind) DO UPDATE SET
  version = harness_docs.version + 1,
  data = EXCLUDED.data,
  updated_at = EXCLUDED.updated_at
`, threadID, kind, string(raw), now)
	return err
}

// ProjectHarnessEntryToMessage upserts a user-visible message from a journal entry.
// Idempotent: if projected_message_id already set, returns that message id.
func (d *DB) ProjectHarnessEntryToMessage(entryID, conversationID, role, content, agentID, requestID string) (string, error) {
	entryID = strings.TrimSpace(entryID)
	if entryID == "" {
		return "", errors.New("entry_id required")
	}
	var existing string
	err := d.SQL.QueryRow(
		`SELECT projected_message_id FROM harness_entries WHERE id = $1`, entryID,
	).Scan(&existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if strings.TrimSpace(existing) != "" {
		return existing, nil
	}
	msg, err := d.AddMessageWithOpts(conversationID, role, content, AddMessageOpts{
		AgentID:   agentID,
		RequestID: requestID,
	})
	if err != nil {
		return "", err
	}
	_, err = d.SQL.Exec(
		`UPDATE harness_entries SET projected_message_id = $2 WHERE id = $1`,
		entryID, msg.ID,
	)
	if err != nil {
		return msg.ID, err
	}
	return msg.ID, nil
}

// ListResumableHarnessThreads returns threads that should auto-resume.
func (d *DB) ListResumableHarnessThreads(limit int) ([]string, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.SQL.Query(`
SELECT thread_id FROM harness_threads
WHERE status IN ('running', 'interrupted')
ORDER BY updated_at ASC
LIMIT $1
`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ActiveHarnessThreadForConversation returns the newest busy thread for a conversation,
// including the agent that owns the durable run (for group @-routing).
func (d *DB) ActiveHarnessThreadForConversation(conversationID string) (threadID, requestID, status, agentID string, err error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return "", "", "", "", errors.New("conversation_id required")
	}
	err = d.SQL.QueryRow(`
SELECT thread_id, request_id, status, agent_id FROM harness_threads
WHERE conversation_id = $1 AND status IN ('running', 'interrupted', 'waiting_approval')
ORDER BY updated_at DESC
LIMIT 1
`, conversationID).Scan(&threadID, &requestID, &status, &agentID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", "", "", nil
	}
	return threadID, requestID, status, agentID, err
}
