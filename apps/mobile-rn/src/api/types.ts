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
  created_at?: string;
  updated_at?: string;
  /** 助手级主会话 id */
  conversation_id?: string;
  /** 侧边栏展示的最后一条消息摘要 */
  last_message?: string;
  conversation_updated_at?: string;
};

export type AgentInput = {
  name: string;
  description: string;
  system_prompt: string;
};

export type Skill = {
  name: string;
  description: string;
  enabled: boolean;
  custom?: boolean;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  agent_id?: string;
  created_at?: string;
};

export type Conversation = {
  id: string;
  agent_id: string;
  title: string;
  channel_id?: string;
  created_at: string;
  updated_at?: string;
  messages?: Message[];
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

export type AttachmentMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
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
};

export type ListMessagesResult = {
  messages: Message[];
  run_active?: boolean;
};

/* ------------------------------------------------------------------ 协作 */

export type Channel = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  members?: string[];
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

export type Routine = {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  schedule_cron: string;
  enabled: boolean;
  last_run_at?: string | null;
  created_at: string;
  updated_at: string;
  last_run?: RoutineRun | null;
};

export type RoutineInput = {
  name: string;
  prompt: string;
  schedule_cron: string;
  enabled?: boolean;
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
