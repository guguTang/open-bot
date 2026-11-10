package db

import (
	"database/sql"
	"fmt"
	"strings"
)

// UserDataPurgeResult summarizes a hard purge of one user's business data.
// The users row itself is never deleted (password / role / org / email stay).
type UserDataPurgeResult struct {
	AgentIDs []string         `json:"agent_ids"`
	Counts   map[string]int64 `json:"counts"`
}

// PurgeUserData hard-deletes all business data owned by userID in one transaction.
// soft-delete: hard purge — deletes agents (including soft-deleted) and other
// user-scoped rows; keeps the users account row (password/role/org/email).
func (d *DB) PurgeUserData(userID string) (*UserDataPurgeResult, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrNotFound
	}

	tx, err := d.SQL.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var live string
	err = tx.QueryRow(`
SELECT id FROM users
WHERE id = $1 AND deleted_at IS NULL AND LOWER(username) <> LOWER($2)
`, userID, A2ASystemUsername).Scan(&live)
	if err == sql.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	agentIDs, err := listUserAgentIDsTx(tx, userID)
	if err != nil {
		return nil, err
	}

	counts := map[string]int64{}
	execCount := func(key, q string, args ...any) error {
		res, err := tx.Exec(q, args...)
		if err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
		n, _ := res.RowsAffected()
		counts[key] = n
		return nil
	}

	// A2A push configs for this user's tasks, then tasks.
	if err := execCount("a2a_push_configs", `
DELETE FROM a2a_push_configs
WHERE task_id IN (SELECT id FROM a2a_tasks WHERE user_id = $1)
`, userID); err != nil {
		return nil, err
	}
	if err := execCount("a2a_tasks", `DELETE FROM a2a_tasks WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Conversation graph (messages cascade from conversations).
	if err := execCount("conversation_tasks", `DELETE FROM conversation_tasks WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Durable harness journal (group/DM runs). No FK to users — delete before
	// conversations so we can also match threads by conversation_id.
	if err := execCount("harness_docs", `
DELETE FROM harness_docs
WHERE thread_id IN (
  SELECT thread_id FROM harness_threads WHERE user_id = $1
  UNION
  SELECT thread_id FROM harness_threads
  WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = $1)
)
`, userID); err != nil {
		return nil, err
	}
	if err := execCount("harness_entries", `
DELETE FROM harness_entries
WHERE user_id = $1
   OR conversation_id IN (SELECT id FROM conversations WHERE user_id = $1)
   OR thread_id IN (SELECT thread_id FROM harness_threads WHERE user_id = $1)
`, userID); err != nil {
		return nil, err
	}
	if err := execCount("harness_threads", `
DELETE FROM harness_threads
WHERE user_id = $1
   OR conversation_id IN (SELECT id FROM conversations WHERE user_id = $1)
`, userID); err != nil {
		return nil, err
	}

	// Feedback lessons survive conversation cascade (feedback_id ON DELETE SET NULL).
	if err := execCount("bot_lessons", `DELETE FROM bot_lessons WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	// Always-allow tool prefs (no cascade from business tables).
	if err := execCount("user_tool_allowlist", `DELETE FROM user_tool_allowlist WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	if err := execCount("conversations", `DELETE FROM conversations WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Bus / channels (channel_members cascade from channels).
	if err := execCount("agent_messages", `DELETE FROM agent_messages WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("channels", `DELETE FROM channels WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Per-agent skill allowlist (no FK), then hard-delete all agents incl. soft-deleted.
	if err := execCount("agent_skills", `
DELETE FROM agent_skills
WHERE agent_id IN (SELECT id FROM agents WHERE user_id = $1)
`, userID); err != nil {
		return nil, err
	}
	if err := execCount("agents", `DELETE FROM agents WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Memories + recall/usage telemetry.
	if err := execCount("memories", `DELETE FROM memories WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("memory_recalls", `DELETE FROM memory_recalls WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("usage_calls", `DELETE FROM usage_calls WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("usage_runs", `DELETE FROM usage_runs WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Routines (routine_runs cascade).
	if err := execCount("routines", `DELETE FROM routines WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Secrets / MCP / machines / sandbox row / hooks / personal LLM.
	if err := execCount("bot_secret_requests", `DELETE FROM bot_secret_requests WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("bot_secrets", `DELETE FROM bot_secrets WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("mcp_servers", `DELETE FROM mcp_servers WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("user_settings", `DELETE FROM user_settings WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("user_machines", `DELETE FROM user_machines WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("sandboxes", `DELETE FROM sandboxes WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("inbound_hooks", `DELETE FROM inbound_hooks WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("llm_connections", `DELETE FROM llm_connections WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Skills uploads / toggles.
	if err := execCount("user_skill_package_files", `DELETE FROM user_skill_package_files WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("user_skill_files", `DELETE FROM user_skill_files WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	if err := execCount("user_skills", `DELETE FROM user_skills WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}

	// Invites this user created; leave invites targeting them alone.
	if err := execCount("org_invites_created", `DELETE FROM org_invites WHERE invited_by = $1`, userID); err != nil {
		return nil, err
	}

	// Keep users row: password_hash, role, org_id, email, casdoor_sub, deleted_at untouched.
	var still string
	if err := tx.QueryRow(`SELECT id FROM users WHERE id = $1`, userID).Scan(&still); err != nil {
		return nil, fmt.Errorf("users row missing after purge: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &UserDataPurgeResult{AgentIDs: agentIDs, Counts: counts}, nil
}

func listUserAgentIDsTx(tx *sql.Tx, userID string) ([]string, error) {
	// soft-delete: include deleted — purge must wipe soft-deleted bots too.
	rows, err := tx.Query(`SELECT id FROM agents WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
