package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MessageAttachment is a conversation file persisted on upload and linked to a
// message on send. URL is a relative auth path filled by helpers / API.
type MessageAttachment struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id,omitempty"`
	MessageID      string    `json:"message_id,omitempty"`
	UserID         string    `json:"-"`
	Name           string    `json:"name"`
	Mime           string    `json:"mime"`
	Size           int64     `json:"size"`
	Path           string    `json:"path"`
	URL            string    `json:"url,omitempty"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
	// ExtractMD is the parsed text. Omitted from JSON so chat payloads stay the user's words.
	ExtractMD string `json:"-"`
}

// AttachmentURL returns the authenticated GET path for a conversation attachment.
func AttachmentURL(conversationID, attachmentID string) string {
	return fmt.Sprintf("/v1/conversations/%s/attachments/%s", conversationID, attachmentID)
}

// migrateMessageAttachments creates the message_attachments table (idempotent).
func (d *DB) migrateMessageAttachments() error {
	_, err := d.SQL.Exec(`
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
CREATE INDEX IF NOT EXISTS idx_message_attachments_user_extract
  ON message_attachments(user_id, created_at DESC) WHERE extract_md <> '';
`)
	return err
}

// CreateMessageAttachment inserts a row after the file is written to disk.
func (d *DB) CreateMessageAttachment(a MessageAttachment) (*MessageAttachment, error) {
	a.ID = strings.TrimSpace(a.ID)
	a.ConversationID = strings.TrimSpace(a.ConversationID)
	a.UserID = strings.TrimSpace(a.UserID)
	a.Name = strings.TrimSpace(a.Name)
	a.Mime = strings.TrimSpace(a.Mime)
	a.Path = strings.TrimSpace(a.Path)
	if a.ID == "" || a.ConversationID == "" || a.UserID == "" || a.Path == "" {
		return nil, fmt.Errorf("attachment id, conversation_id, user_id, path required")
	}
	if a.Name == "" {
		a.Name = "file"
	}
	if a.Mime == "" {
		a.Mime = "application/octet-stream"
	}
	if a.CreatedAt.IsZero() {
		a.CreatedAt = Now()
	}
	_, err := d.SQL.Exec(
		`INSERT INTO message_attachments
		   (id, conversation_id, user_id, message_id, name, mime, size, path, created_at)
		 VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8)`,
		a.ID, a.ConversationID, a.UserID, a.Name, a.Mime, a.Size, a.Path, a.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	a.URL = AttachmentURL(a.ConversationID, a.ID)
	return &a, nil
}

// GetMessageAttachment returns one attachment owned by the user in the conversation.
func (d *DB) GetMessageAttachment(userID, conversationID, attachmentID string) (*MessageAttachment, error) {
	row := d.SQL.QueryRow(
		`SELECT id, conversation_id, COALESCE(message_id,''), user_id, name, mime, size, path, created_at
		 FROM message_attachments
		 WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
		attachmentID, conversationID, userID,
	)
	var a MessageAttachment
	if err := row.Scan(&a.ID, &a.ConversationID, &a.MessageID, &a.UserID, &a.Name, &a.Mime, &a.Size, &a.Path, &a.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	a.URL = AttachmentURL(a.ConversationID, a.ID)
	return &a, nil
}

// LinkAttachmentsToMessage binds previously uploaded attachment rows to a message.
// Only unlinked rows owned by the user in this conversation are updated.
// Idempotent if already linked to the same message.
func (d *DB) LinkAttachmentsToMessage(userID, conversationID, messageID string, attachmentIDs []string) ([]MessageAttachment, error) {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return nil, fmt.Errorf("message_id required")
	}
	seen := make(map[string]struct{}, len(attachmentIDs))
	var ids []string
	for _, id := range attachmentIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}

	tx, err := d.SQL.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var linked []MessageAttachment
	for _, id := range ids {
		res, err := tx.Exec(
			`UPDATE message_attachments
			 SET message_id = $1
			 WHERE id = $2 AND conversation_id = $3 AND user_id = $4
			   AND (message_id IS NULL OR message_id = '')`,
			messageID, id, conversationID, userID,
		)
		if err != nil {
			return nil, err
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			row := tx.QueryRow(
				`SELECT id, conversation_id, COALESCE(message_id,''), user_id, name, mime, size, path, created_at
				 FROM message_attachments
				 WHERE id = $1 AND conversation_id = $2 AND user_id = $3`,
				id, conversationID, userID,
			)
			var a MessageAttachment
			if err := row.Scan(&a.ID, &a.ConversationID, &a.MessageID, &a.UserID, &a.Name, &a.Mime, &a.Size, &a.Path, &a.CreatedAt); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return nil, fmt.Errorf("attachment %s not found in conversation", id)
				}
				return nil, err
			}
			if a.MessageID != "" && a.MessageID != messageID {
				return nil, fmt.Errorf("attachment %s already linked to another message", id)
			}
			a.URL = AttachmentURL(a.ConversationID, a.ID)
			linked = append(linked, a)
			continue
		}
		row := tx.QueryRow(
			`SELECT id, conversation_id, COALESCE(message_id,''), user_id, name, mime, size, path, created_at
			 FROM message_attachments WHERE id = $1`,
			id,
		)
		var a MessageAttachment
		if err := row.Scan(&a.ID, &a.ConversationID, &a.MessageID, &a.UserID, &a.Name, &a.Mime, &a.Size, &a.Path, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.URL = AttachmentURL(a.ConversationID, a.ID)
		linked = append(linked, a)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return linked, nil
}

// ListAttachmentsByMessageIDs returns attachments keyed by message_id.
func (d *DB) ListAttachmentsByMessageIDs(userID, conversationID string, messageIDs []string) (map[string][]MessageAttachment, error) {
	out := make(map[string][]MessageAttachment)
	seen := make(map[string]struct{}, len(messageIDs))
	var ids []string
	for _, id := range messageIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return out, nil
	}

	placeholders := make([]string, len(ids))
	args := make([]any, 0, 2+len(ids))
	args = append(args, conversationID, userID)
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+3)
		args = append(args, id)
	}
	q := fmt.Sprintf(
		`SELECT id, conversation_id, COALESCE(message_id,''), user_id, name, mime, size, path, created_at
		 FROM message_attachments
		 WHERE conversation_id = $1 AND user_id = $2
		   AND message_id IN (%s)
		 ORDER BY created_at ASC, id ASC`,
		strings.Join(placeholders, ","),
	)
	rows, err := d.SQL.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a MessageAttachment
		if err := rows.Scan(&a.ID, &a.ConversationID, &a.MessageID, &a.UserID, &a.Name, &a.Mime, &a.Size, &a.Path, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.URL = AttachmentURL(a.ConversationID, a.ID)
		out[a.MessageID] = append(out[a.MessageID], a)
	}
	return out, rows.Err()
}

// SetAttachmentExtract stores parsed markdown for one upload. The chat message stays the user's words.
func (d *DB) SetAttachmentExtract(userID, conversationID, attachmentID, markdown string) error {
	userID = strings.TrimSpace(userID)
	conversationID = strings.TrimSpace(conversationID)
	attachmentID = strings.TrimSpace(attachmentID)
	if userID == "" || conversationID == "" || attachmentID == "" {
		return fmt.Errorf("user, conversation, and attachment required")
	}
	res, err := d.SQL.Exec(
		`UPDATE message_attachments SET extract_md = $1
		 WHERE id = $2 AND conversation_id = $3 AND user_id = $4`,
		markdown, attachmentID, conversationID, userID,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SearchAttachmentExtracts finds this user's parsed uploads across conversations.
// attachmentID wins when set. An empty query returns the newest extracts.
func (d *DB) SearchAttachmentExtracts(userID, query, attachmentID string, limit int) ([]MessageAttachment, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("user_id required")
	}
	if limit <= 0 || limit > 5 {
		limit = 3
	}
	attachmentID = strings.TrimSpace(attachmentID)
	if attachmentID != "" {
		row := d.SQL.QueryRow(
			`SELECT id, conversation_id, COALESCE(message_id,''), user_id, name, mime, size, path, created_at, extract_md
			 FROM message_attachments
			 WHERE user_id = $1 AND id = $2 AND extract_md <> ''`,
			userID, attachmentID,
		)
		a, err := scanAttachmentExtract(row)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, nil
			}
			return nil, err
		}
		return []MessageAttachment{a}, nil
	}
	args := []any{userID}
	q := `SELECT id, conversation_id, COALESCE(message_id,''), user_id, name, mime, size, path, created_at, extract_md
		 FROM message_attachments
		 WHERE user_id = $1 AND extract_md <> ''`
	if pat := likeContains(query); pat != "" {
		args = append(args, pat)
		q += fmt.Sprintf(" AND (name ILIKE $2 ESCAPE '\\' OR extract_md ILIKE $2 ESCAPE '\\')")
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", len(args))
	rows, err := d.SQL.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MessageAttachment
	for rows.Next() {
		var a MessageAttachment
		if err := rows.Scan(&a.ID, &a.ConversationID, &a.MessageID, &a.UserID, &a.Name, &a.Mime, &a.Size, &a.Path, &a.CreatedAt, &a.ExtractMD); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func scanAttachmentExtract(row *sql.Row) (MessageAttachment, error) {
	var a MessageAttachment
	err := row.Scan(&a.ID, &a.ConversationID, &a.MessageID, &a.UserID, &a.Name, &a.Mime, &a.Size, &a.Path, &a.CreatedAt, &a.ExtractMD)
	return a, err
}

func likeContains(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}
	q = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	return "%" + q + "%"
}
