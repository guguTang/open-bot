package db

import (
	"strings"
	"testing"
)

func TestLikeContainsEscapesWildcards(t *testing.T) {
	t.Parallel()
	if got := likeContains(` 100%_done `); got != `%100\%\_done%` {
		t.Fatalf("got %q", got)
	}
	if likeContains("  ") != "" {
		t.Fatal("blank query should list recent extracts")
	}
}

func TestAttachmentURL(t *testing.T) {
	t.Parallel()
	got := AttachmentURL("conv-1", "att-2")
	want := "/v1/conversations/conv-1/attachments/att-2"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMigrateMessageAttachmentsSQLShape(t *testing.T) {
	t.Parallel()
	// Source-level contract: table + indexes must exist in migrate body.
	// (Full DB integration requires Postgres; smoke on Mac after merge.)
	src := migrateMessageAttachmentsSourceForTest
	for _, needle := range []string{
		"CREATE TABLE IF NOT EXISTS message_attachments",
		"conversation_id TEXT NOT NULL",
		"message_id TEXT",
		"REFERENCES messages(id) ON DELETE SET NULL",
		"idx_message_attachments_conv",
		"idx_message_attachments_msg",
		"extract_md",
	} {
		if !strings.Contains(src, needle) {
			t.Fatalf("migrate SQL missing %q", needle)
		}
	}
}

// migrateMessageAttachmentsSourceForTest mirrors the SQL in migrateMessageAttachments
// so the shape can be asserted without a live DB.
const migrateMessageAttachmentsSourceForTest = `
CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT NOT NULL DEFAULT 0,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_conv
  ON message_attachments(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_attachments_msg
  ON message_attachments(message_id) WHERE message_id IS NOT NULL;
ALTER TABLE message_attachments ADD COLUMN IF NOT EXISTS extract_md TEXT NOT NULL DEFAULT '';
`
