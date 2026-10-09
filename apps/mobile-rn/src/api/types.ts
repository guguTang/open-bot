/**
 * 与 `apps/web/src/api.ts` 对齐的契约类型。
 * 后端是 Go 的 `/v1/*`，这里是移动端的独立副本（不跨包共享，避免 Metro 解析 pnpm workspace 外的 TS 源码）。
 */

export type User = {
  id: string;
  username: string;
  email?: string;
  org_id?: string;
  role?: "platform_admin" | "org_admin" | "member" | string;
  created_at?: string;
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  system_prompt?: string;
  is_builtin?: boolean;
  computer_mode?: "team" | "private" | string;
  user_id?: string;
  /** 形象 v2 白名单：cloud|bean|drop|soft-hex|petal|puff（legacy id 由客户端映射）。 */
  avatar_shape?: string;
  /** 12 色主色板（#rrggbb）。 */
  avatar_color?: string;
  /** 优先电脑（user_machines.id）；空 = 用会话所在机器。 */
  machine_id?: string;
  /** 绑定的执行通道在线（服务端按心跳窗口计算）。 */
  online?: boolean;
  created_at?: string;
  updated_at?: string;
  /** 助手级主会话 id */
  conversation_id?: string;
  /** 侧边栏展示的最后一条消息摘要 */
  last_message?: string;
  conversation_updated_at?: string;
  /** 有 run 在飞（侧栏「回复中」圆点） */
  task_active?: boolean;
};

export type AgentInput = {
  name: string;
  description: string;
  system_prompt: string;
  computer_mode?: "team" | "private" | string;
  avatar_shape?: string;
  avatar_color?: string;
  /** 绑定已登记的电脑；PATCH 传 "" 解除绑定。 */
  machine_id?: string;
};

/** PATCH /v1/agents/{id}：省略或传空的字段保持原值。 */
export type AgentPatch = Partial<AgentInput>;

/* ------------------------------------------------------------------ 形象 / 在线 */

export type BotPresenceStatus = "idle" | "thinking" | "working" | "awaiting_approval" | "error";

export type BotPresenceEvent = {
  type?: "bot_presence" | string;
  conversation_id: string;
  agent_id: string;
  status: BotPresenceStatus | string;
  updated_at?: string;
};

/** 在线绿点：会话所在机器 → 优先电脑 → 任一在线；心跳 ≤90s 视为在线。与 bot_presence 相互独立。 */
export const BOT_ONLINE_THRESHOLD_SEC = 90;

export type BotOnlineEvent = {
  type?: "bot_online" | string;
  conversation_id?: string;
  agent_id: string;
  online: boolean;
  updated_at?: string;
};

/* ------------------------------------------------------------------ 技能 */

export type SkillSource = "builtin" | "custom";

export type SkillBotRef = { id: string; name: string };

export type Skill = {
  name: string;
  description: string;
  enabled: boolean;
  custom?: boolean;
  file_count?: number;
  files?: { path: string; content?: string }[];
  source?: SkillSource;
  read_only?: boolean;
  updated_at?: string;
  bot_count?: number;
  bots?: SkillBotRef[];
};

/** Bot 级技能白名单项：enabled 是「账号级 ∩ Bot 允许列表」后的实际生效值。 */
export type AgentSkill = {
  name: string;
  description: string;
  enabled: boolean;
  custom?: boolean;
  /** 账号级开关（设置 →「扩展能力包」）。 */
  account_enabled?: boolean;
};

/* ------------------------------------------------------------------ 消息 */

export type ReactionSummary = {
  emoji: string;
  count: number;
  me: boolean;
};

/** P0 白名单，需与后端 AllowedReactionEmojis 保持一致。 */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "❌", "👎"] as const;

/** 在助手回复上新增这几个表情会顺带弹出反馈弹窗（仅新增时；取消不触发）。 */
export const NEGATIVE_REACTION_EMOJIS = ["👎", "❌"] as const;

export type HandoffPayload = {
  from_bot: string;
  to_bot: string;
  purpose: string;
  status: "running" | "done" | "failed" | "rejected" | "awaiting_approval" | string;
  agent_message_id: string;
};

export type ReactionUpdatedEvent = {
  type?: string;
  conversation_id: string;
  message_id: string;
  emoji: string;
  count: number;
  me: boolean;
  action: "add" | "remove" | string;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "summary" | "handoff" | string;
  content: string;
  agent_id?: string;
  conversation_id?: string;
  created_at?: string;
  /** 线程回复的父消息 id。 */
  reply_to_id?: string;
  /** 线程根 id（Slack 式）；主时间线消息为空。 */
  thread_root_id?: string;
  reactions?: ReactionSummary[];
  agent_message_id?: string;
  /** Bot 回复对应的 runtime run id，可复制给用户报障。 */
  request_id?: string;
  handoff?: HandoffPayload;
  attachments?: AttachmentMeta[];
  /** 本机操作确认卡（host-confirms）载荷。 */
  host_confirm?: HostConfirmPayload;
};

export type HostConfirmPayload = {
  req_id: string;
  op: string;
  path: string;
  dest?: string;
  preview?: string;
  reason?: string;
  review_tier?: string;
  status?: "pending" | "allowed" | "denied" | string;
};

export type Conversation = {
  id: string;
  agent_id: string;
  title: string;
  channel_id?: string;
  created_at: string;
  updated_at?: string;
  messages?: Message[];
  /** 本会话内 Bot 的在线状态（服务端盖章）。 */
  participants?: ChannelMemberProfile[];
};

export type LLMConnection = {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  model: string;
  enable_tools: boolean;
  is_default: boolean;
  context_window?: number | null;
  api_key_set: boolean;
  api_key_hint?: string;
  created_at: string;
  updated_at: string;
};

export type LLMInput = {
  name: string;
  base_url: string;
  api_key?: string;
  model: string;
  enable_tools?: boolean;
  is_default?: boolean;
  /** tokens；留空 = 自动（按模型名启发式） */
  context_window?: number | null;
};

export type LLMToolsProbeResult = {
  mode: "native" | "markup" | "forced_only" | "none" | "error" | string;
  can_enable_tools: boolean;
  detail?: string;
  hint?: string;
  error?: string;
  http_status?: number;
};

export type AttachmentMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  /** 鉴权 GET 相对路径，例如 /v1/conversations/{id}/attachments/{id}。 */
  url?: string;
};

export type StatusEvent = {
  phase?: string;
  label?: string;
  tool?: string;
  [key: string]: unknown;
};

export type StreamHandlers = {
  onToken: (text: string) => void;
  onMeta?: (data: Record<string, unknown>) => void;
  onStatus?: (data: StatusEvent) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  /** 多助手群聊：新 bot 开始流式输出 */
  onAgentStart?: (info: {
    agent_id: string;
    agent_name?: string;
    index?: number;
    total?: number;
  }) => void;
  /** 会话 SSE 的 bot_online（助手级在线绿点，与 bot_presence 独立）。 */
  onBotOnline?: (evt: BotOnlineEvent) => void;
  /** 会话 SSE 的 bot_presence（思考 / 工作 / 等待批准 / 错误 五态）。 */
  onBotPresence?: (evt: BotPresenceEvent) => void;
};

export type ListMessagesResult = {
  messages: Message[];
  run_active?: boolean;
};

/* ------------------------------------------------------------------ 协作 */

export type ChannelMemberProfile = {
  id: string;
  name: string;
  online?: boolean;
  avatar_shape?: string;
  avatar_color?: string;
  last_message?: string;
};

export type Channel = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  members?: string[];
  member_profiles?: ChannelMemberProfile[];
  conversation_id?: string;
};

export type AgentBusMessage = {
  id: string;
  user_id: string;
  from_agent_id: string;
  to_agent_id?: string | null;
  channel_id?: string | null;
  priority: boolean;
  body: string;
  reply_to_id?: string | null;
  created_at: string;
  read_at?: string | null;
};

export type AgentBusWSEvent = {
  type: string;
  message?: AgentBusMessage;
};

export type CompactConfig = {
  max_messages: number;
  max_chars: number;
  keep_recent: number;
  token_mode?: boolean;
  default_context_window?: number;
  context_window?: number;
  reserve_output_tokens?: number;
  budget_ratio?: number;
  token_budget?: number;
  min_context_window?: number;
  max_context_window?: number;
};

/* ------------------------------------------------------------------ 用户设置（审核与时区） */

export type AutoReviewRule = {
  id: string;
  when: string;
  action: "ask_first" | "auto_allow";
};

export type UserSettings = {
  user_id?: string;
  timezone: string;
  auto_review_enabled: boolean;
  auto_review_rules: AutoReviewRule[];
  updated_at?: string;
};

/* ------------------------------------------------------------------ OIDC */

export type OIDCConfig = {
  enabled: boolean;
  endpoint?: string;
  client_id?: string;
  redirect_uri?: string;
};

/* ------------------------------------------------------------------ MCP */

export type MCPServer = {
  id: string;
  user_id: string;
  name: string;
  transport: "stdio" | "sse" | "http" | string;
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type MCPServerInput = {
  name: string;
  transport: "stdio" | "sse" | "http" | string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
};

export type MCPToolSummary = {
  name: string;
  description?: string;
};

export type MCPToolEntry = {
  name: string;
  description?: string;
  server_id?: string;
  server_name?: string;
  qualified_name?: string;
  error?: string;
};

/* ------------------------------------------------------------------ 例行任务 */

export type RoutineRun = {
  id: string;
  routine_id: string;
  status: string;
  result_text: string;
  created_at: string;
};

export type RoutineTrigger = {
  source: string;
  type: string;
  keywords?: string[];
  actions?: string[];
  repo?: string;
};

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  schedule_cron: string;
  enabled: boolean;
  agent_id: string;
  timezone?: string;
  conversation_id?: string;
  triggers_json?: string;
  triggers?: RoutineTrigger[];
  max_retries?: number;
  fail_count?: number;
  quiet_unchanged?: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_error?: string;
  created_at: string;
  updated_at: string;
  last_run?: RoutineRun | null;
};

export type RoutineInput = {
  name: string;
  prompt: string;
  schedule_cron: string;
  enabled?: boolean;
  agent_id?: string;
  timezone?: string;
  conversation_id?: string;
  triggers?: RoutineTrigger[];
  triggers_json?: string;
  max_retries?: number;
  quiet_unchanged?: boolean;
};

/* ------------------------------------------------------------------ 入站 Hook */

export type InboundHook = {
  id: string;
  user_id: string;
  provider: string;
  token: string;
  label: string;
  has_secret?: boolean;
  created_at: string;
  url_slack?: string;
  url_github?: string;
  hint?: string;
};

/* ------------------------------------------------------------------ 沙箱 */

export type Sandbox = {
  id: string;
  user_id: string;
  container_id: string;
  status: string;
  image: string;
  workdir_host: string;
  computer_mode?: string;
  desktop_port?: number;
  desktop_token?: string;
  checkpoint_path?: string;
  created_at: string;
  updated_at: string;
  last_error?: string;
};

export type SandboxExecResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
};

export type SandboxDirEntry = {
  name: string;
  is_dir: boolean;
  size: number;
};

/* ------------------------------------------------------------------ 密钥 */

export type BotSecretMeta = {
  id: string;
  user_id: string;
  agent_id: string;
  name: string;
  origin: string;
  auth_type: string;
  created_at: string;
  updated_at: string;
};

export type BotSecretRequest = {
  id: string;
  user_id: string;
  agent_id: string;
  conversation_id: string;
  name: string;
  origin: string;
  auth_type: string;
  reason: string;
  status: string;
  created_at: string;
};

export type BotSecretResolveInput = {
  value?: string;
  name?: string;
  origin?: string;
  auth_type?: string;
  agent_id?: string;
  dismiss?: boolean;
};

/* ------------------------------------------------------------------ 反馈与训练 */

export type FeedbackPolarity = "positive" | "negative";
export type FeedbackSource = "feedback_menu" | "reaction_followup";
export type LessonStatus = "pending" | "active" | "ignored";

export type MessageFeedback = {
  id: string;
  message_id: string;
  agent_id: string;
  conversation_id: string;
  polarity: FeedbackPolarity | string;
  reasons: string[];
  note?: string;
  source: FeedbackSource | string;
  created_at: string;
};

export type CreateFeedbackInput = {
  message_id: string;
  agent_id: string;
  conversation_id: string;
  polarity: FeedbackPolarity;
  reasons: string[];
  note?: string;
  source: FeedbackSource;
};

export type BotLesson = {
  id: string;
  agent_id: string;
  feedback_id?: string;
  title: string;
  body: string;
  tags: string[];
  status: LessonStatus | string;
  created_at: string;
  updated_at: string;
  confirmed_at?: string | null;
};

export type LessonPatch = {
  title?: string;
  body?: string;
  tags?: string[];
  status?: LessonStatus | string;
};

/* ------------------------------------------------------------------ 助手克隆 */

export type CloneAgentInput = {
  name?: string;
  description?: string;
  system_prompt?: string;
  system_prompt_append?: string;
  computer_mode?: "team" | "private";
  /** 复制 Bot 级记忆，默认 true。 */
  copy_memory?: boolean;
  /** 复制绑定的例行任务（创建为暂停态），默认 false。 */
  copy_routines?: boolean;
  enable_skills?: string[];
  disable_skills?: string[];
  /** 克隆后立刻交给副本的任务（跑在它自己的线程里）。 */
  follow_up?: string;
};

export type CloneAgentResult = {
  ok: boolean;
  agent: Agent;
  source_agent_id: string;
  conversation_id?: string;
  skills_copied: number;
  skills_inherit_account: boolean;
  memories_copied: number;
  routines_copied: number;
  routine_names?: string[];
  enabled_skills?: string[];
  follow_up_status?: string;
  warning?: string;
  skill_errors?: string[];
};

/* ------------------------------------------------------------------ 本机登记 */

export type Machine = {
  id: string;
  user_id: string;
  machine_key: string;
  label: string;
  platform: string;
  os: string;
  arch: string;
  app: string;
  app_version: string;
  status: "online" | "offline" | string;
  /** 「在这台电脑上执行」策略。 */
  exec_policy?: "allow" | "ask" | "deny" | string;
  /** 后端枚举 desktop|mobile：手机是「仅登录」设备，不能作为执行通道。 */
  device_type?: "desktop" | "mobile" | string;
  last_seen: string;
  created_at: string;
  updated_at?: string;
};

export type MachineInput = {
  machine_key: string;
  label?: string;
  platform?: string;
  os?: string;
  arch?: string;
  app?: string;
  app_version?: string;
};

/* ------------------------------------------------------------------ 客户端环境信封 */

/** 与 Go / Python RunRequest.client 对齐；RN 恒为原生客户端。 */
export type ClientPlatform = "web" | "macos" | "windows" | "linux" | "ios" | "android";

export type ClientApp = "browser" | "tauri" | "capacitor" | "expo";

export type ClientContext = {
  platform: ClientPlatform;
  app: ClientApp;
  os: string;
  arch: string;
  app_version: string;
  locale: string;
  capabilities: {
    host_tools: boolean;
    workspace_tools: boolean;
  };
};
