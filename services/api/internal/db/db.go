package db

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const DefaultDatabaseURL = "postgres://openbot:openbot@127.0.0.1:5432/openbot?sslmode=disable"

type DB struct {
	SQL *sql.DB
}

func DatabaseURL() string {
	if v := strings.TrimSpace(os.Getenv("DATABASE_URL")); v != "" {
		return v
	}
	return DefaultDatabaseURL
}

func Open(databaseURL string) (*DB, error) {
	if databaseURL == "" {
		databaseURL = DatabaseURL()
	}
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetConnMaxLifetime(time.Hour)
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	d := &DB{SQL: sqlDB}
	if err := d.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := d.SeedGlobalSkillsFromDisk(); err != nil {
		fmt.Printf("warn: seed global_skills from disk: %v\n", err)
	}
	return d, nil
}

func (d *DB) Close() error {
	return d.SQL.Close()
}

func (d *DB) migrate() error {
	_, err := d.SQL.Exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llm_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  enable_tools BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_connections_user ON llm_connections(user_id);

ALTER TABLE llm_connections ADD COLUMN IF NOT EXISTS context_window INT;
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT 'open-bot',
  title TEXT NOT NULL DEFAULT '新对话',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS user_skills (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, skill_name)
);

-- Per-bot skill allowlist (Grok-style: shared library + enable on current Bot).
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (agent_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_tier ON memories(user_id, tier);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_user ON channels(user_id);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, agent_id)
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL,
  to_agent_id TEXT,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  priority BOOLEAN NOT NULL DEFAULT FALSE,
  body TEXT NOT NULL DEFAULT '',
  reply_to_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_user ON agent_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_unread ON agent_messages(user_id) WHERE read_at IS NULL;

ALTER TABLE agent_messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_messages_reply_to ON agent_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT NOT NULL DEFAULT '',
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT NOT NULL DEFAULT '',
  env_json TEXT NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_user ON mcp_servers(user_id);

CREATE TABLE IF NOT EXISTS user_skill_files (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, skill_name)
);

-- Per-user skill package files (SKILL.md + references/ scripts/ …).
CREATE TABLE IF NOT EXISTS user_skill_package_files (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, skill_name, path)
);

CREATE INDEX IF NOT EXISTS idx_user_skill_package_files_user
  ON user_skill_package_files(user_id, skill_name);

CREATE TABLE IF NOT EXISTS global_skills (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Skill package files (SKILL.md + references/ scripts/ assets/ …). SKILL.md stays mirrored in body_markdown.
CREATE TABLE IF NOT EXISTS global_skill_files (
  skill_name TEXT NOT NULL REFERENCES global_skills(name) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (skill_name, path)
);

CREATE INDEX IF NOT EXISTS idx_global_skill_files_skill ON global_skill_files(skill_name);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  schedule_cron TEXT NOT NULL DEFAULT '0 9 * * *',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routines_enabled ON routines(enabled) WHERE enabled = TRUE;

CREATE TABLE IF NOT EXISTS routine_runs (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  result_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routine_runs_routine ON routine_runs(routine_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sandboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  container_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'stopped',
  image TEXT NOT NULL DEFAULT '',
  workdir_host TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sandboxes_user ON sandboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);

ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS computer_mode TEXT NOT NULL DEFAULT 'team';
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS desktop_port INT NOT NULL DEFAULT 0;
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS desktop_token TEXT NOT NULL DEFAULT '';
ALTER TABLE sandboxes ADD COLUMN IF NOT EXISTS checkpoint_path TEXT NOT NULL DEFAULT '';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS computer_mode TEXT NOT NULL DEFAULT 'team';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS machine_id TEXT NOT NULL DEFAULT '';
-- machine_id_source: '' (unbound / legacy unknown) | 'migrate' (written by backfill) | 'user' (CREATE/PATCH)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS machine_id_source TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_agents_machine ON agents(user_id, machine_id);

ALTER TABLE memories ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS peer_agent_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_memories_scope_agent ON memories (user_id, scope, agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_scope_channel ON memories (user_id, scope, channel_id);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_channel
  ON conversations(user_id, channel_id) WHERE channel_id IS NOT NULL AND channel_id <> '';

ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(conversation_id, agent_id);

-- Slack/Grok-style conversation threads (mirror agent_messages.reply_to_id).
-- reply_to_id: immediate parent message the user clicked「回复」on.
-- thread_root_id: root of the thread (parent id if parent is top-level; else inherit).
-- Top-level messages keep both NULL. Indexes support list-by-thread and parent lookup.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_root_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_thread_root ON messages(conversation_id, thread_root_id, created_at)
  WHERE thread_root_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_user_agent
  ON conversations(user_id, agent_id);


ALTER TABLE routines ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'open-bot';
ALTER TABLE routines ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE routines ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE routines ADD COLUMN IF NOT EXISTS conversation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE routines ADD COLUMN IF NOT EXISTS triggers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE routines ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 2;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS fail_count INT NOT NULL DEFAULT 0;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS quiet_unchanged BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE routines ADD COLUMN IF NOT EXISTS last_result_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS inbound_hooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbound_hooks_user ON inbound_hooks(user_id);
CREATE INDEX IF NOT EXISTS idx_inbound_hooks_token ON inbound_hooks(token);

CREATE TABLE IF NOT EXISTS bot_secrets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  ciphertext TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, agent_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bot_secrets_user ON bot_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_secrets_agent ON bot_secrets(user_id, agent_id);

CREATE TABLE IF NOT EXISTS bot_secret_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'bearer',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_secret_requests_user ON bot_secret_requests(user_id, status);

CREATE TABLE IF NOT EXISTS user_machines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  os TEXT NOT NULL DEFAULT '',
  arch TEXT NOT NULL DEFAULT '',
  app TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline',
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, machine_key)
);

CREATE INDEX IF NOT EXISTS idx_user_machines_user ON user_machines(user_id);
CREATE INDEX IF NOT EXISTS idx_user_machines_last_seen ON user_machines(user_id, last_seen DESC);
ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS file_op_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE user_machines ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'desktop';

CREATE TABLE IF NOT EXISTS conversation_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  attempt INT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  lease_until TIMESTAMPTZ,
  source_message_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_tasks_one_running
  ON conversation_tasks(conversation_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_queued
  ON conversation_tasks(status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_conversation_tasks_conv
  ON conversation_tasks(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_agent_message_id
  ON messages(agent_message_id) WHERE agent_message_id IS NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS request_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_messages_request_id
  ON messages(request_id) WHERE request_id <> '';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_shape TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar_user_set BOOLEAN NOT NULL DEFAULT FALSE;

-- Avatar v2: map geometric shape ids → organic silhouettes (idempotent, 1:1).
-- soft-delete: exception — remap applies to all rows incl. soft-deleted (keeps restored bots valid).
UPDATE agents SET avatar_shape = 'cloud' WHERE avatar_shape = 'circle';
UPDATE agents SET avatar_shape = 'puff' WHERE avatar_shape = 'rounded';
UPDATE agents SET avatar_shape = 'bean' WHERE avatar_shape = 'squircle';
UPDATE agents SET avatar_shape = 'soft-hex' WHERE avatar_shape = 'hex';
UPDATE agents SET avatar_shape = 'drop' WHERE avatar_shape = 'diamond';
UPDATE agents SET avatar_shape = 'petal' WHERE avatar_shape = 'soft-square';

-- Message feedback (explicit submit only; reactions never create rows here).
CREATE TABLE IF NOT EXISTS message_feedbacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  polarity TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'feedback_menu',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_feedbacks_agent ON message_feedbacks(user_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_feedbacks_message ON message_feedbacks(message_id);

-- Bot lessons: pending drafts from feedback; only status=active is injected by runtime.
CREATE TABLE IF NOT EXISTS bot_lessons (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  feedback_id TEXT REFERENCES message_feedbacks(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bot_lessons_agent ON bot_lessons(user_id, agent_id, status, updated_at DESC);
`)
	if err != nil {
		return err
	}
	if err := d.migrateOrgs(); err != nil {
		return err
	}
	if err := d.migrateAuditLogs(); err != nil {
		return err
	}
	if err := d.migrateSoftDelete(); err != nil {
		return err
	}
	if err := d.migrateA2ATasks(); err != nil {
		return err
	}
	if err := d.migrateUsageRuns(); err != nil {
		return err
	}
	if err := d.migrateMemoryRecalls(); err != nil {
		return err
	}
	if err := d.migrateUserSettings(); err != nil {
		return err
	}
	if err := d.migrateMessageAttachments(); err != nil {
		return err
	}
	if err := d.migrateAvatarV2(); err != nil {
		return err
	}
	if err := d.migrateAgentMachineID(); err != nil {
		return err
	}
	if err := d.migrateConversationLastMachineID(); err != nil {
		return err
	}
	// One-time: clear Bot auto-quotes (assistant.reply_to → user, empty thread_root).
	// See reply_to_migrate.go (marker clear_assistant_auto_reply_to_v1).
	if err := d.migrateClearAssistantAutoReplyTo(); err != nil {
		return err
	}
	// One-time: clear shallow auto thread_root from old ResolveThreadRoot-on-reply_to.
	if err := d.migrateClearAutoThreadRoot(); err != nil {
		return err
	}
	if err := d.migrateHarnessJournal(); err != nil {
		return err
	}
	return d.migrateVector()
}

// migrateSoftDelete adds deleted_at to users/agents and relaxes the global
// username/casdoor_sub uniqueness to "unique among live rows only", so a
// soft-deleted username can be registered again.
// Must run after migrateOrgs (it owns idx_users_casdoor_sub).
func (d *DB) migrateSoftDelete() error {
	_, err := d.SQL.Exec(`
ALTER TABLE users  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_active
  ON users (LOWER(username)) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS idx_users_casdoor_sub;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_casdoor_sub_active
  ON users (casdoor_sub) WHERE casdoor_sub IS NOT NULL AND casdoor_sub <> '' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_org_active ON users (org_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_user_active ON agents (user_id) WHERE deleted_at IS NULL;
`)
	return err
}

// migrateVector enables pgvector when available; otherwise memories stay keyword-only.
func (d *DB) migrateVector() error {
	if _, err := d.SQL.Exec(`CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
		fmt.Printf("warn: pgvector extension unavailable (%v); memory recall will use keywords\n", err)
		return nil
	}
	// bge-m3 default dim=1024
	if _, err := d.SQL.Exec(`ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(1024)`); err != nil {
		fmt.Printf("warn: memories.embedding column unavailable (%v)\n", err)
		return nil
	}
	_, _ = d.SQL.Exec(`CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`)
	return nil
}

func Now() time.Time {
	return time.Now().UTC()
}

func FormatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}
