export const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:18080").replace(
  /\/$/,
  "",
);

export const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL || "http://127.0.0.1:5174").replace(
  /\/$/,
  "",
);

const TOKEN_KEY = "openbot_token";
const USER_KEY = "openbot_user";

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
  /** Whitelisted v2: cloud|bean|drop|soft-hex|petal|puff (legacy ids mapped client-side). */
  avatar_shape?: string;
  /** Whitelisted 12-color palette (#rrggbb). */
  avatar_color?: string;
  /** 优先电脑 (user_machines.id). Empty = session host, else any online. */
  machine_id?: string;
  /** Bound machine exec channel Connected + last_seen within BOT_ONLINE_THRESHOLD_SEC (server-computed). */
  online?: boolean;
  created_at?: string;
  updated_at?: string;
  /** Primary thread id (assistant-level). */
  conversation_id?: string;
  /** Last user/assistant message snippet for sidebar. */
  last_message?: string;
  conversation_updated_at?: string;
  task_active?: boolean;
};

export type AgentInput = {
  name: string;
  description: string;
  system_prompt: string;
  computer_mode?: "team" | "private" | string;
  avatar_shape?: string;
  avatar_color?: string;
  /** Bind to a registered host machine; "" clears on PATCH. */
  machine_id?: string;
};

/** PATCH /v1/agents/{id}: omitted / empty fields keep current values. */
export type AgentPatch = Partial<AgentInput>;

/** bot_presence frame (conversation SSE + chat WS). */
export type BotPresenceStatus = "idle" | "thinking" | "working" | "awaiting_approval" | "error";
export type BotPresenceEvent = {
  type?: "bot_presence" | string;
  conversation_id: string;
  agent_id: string;
  status: BotPresenceStatus | string;
  updated_at?: string;
};

/**
 * Bot online (green dot): session host → 优先电脑 → 任一在线; Connected ∧ heartbeat ≤90s.
 * ListAgents uses 优先电脑→任一在线; conversation participants use session host when set.
 * Client consumes `online` + `bot_online`; never polls machines. Independent of bot_presence.
 */

export const BOT_ONLINE_THRESHOLD_SEC = 90;
export type BotOnlineEvent = {
  type?: "bot_online" | string;
  /** Present on conversation SSE; session-flip pushes update the active chat green dot. */
  conversation_id?: string;
  agent_id: string;
  online: boolean;
  updated_at?: string;
};

export type AgentSkill = {
  name: string;
  description: string;
  /** Effective for this Bot (account-level ∩ Bot allowlist). */
  enabled: boolean;
  custom?: boolean;
  /** Account-level toggle from settings「技能」. */
  account_enabled?: boolean;
};

export type SkillSource = "builtin" | "custom";

export type SkillBotRef = { id: string; name: string };

export type Skill = {
  name: string;
  description: string;
  enabled: boolean;
  custom?: boolean;
  file_count?: number;
  files?: { path: string; content?: string }[];
  /** 内置 / 自建 (GET /v1/skills). */
  source?: SkillSource;
  read_only?: boolean;
  updated_at?: string;
  /** Bots of this account whose effective skill set includes this skill. */
  bot_count?: number;
  bots?: SkillBotRef[];
};

/** Editor payload: GET/PUT /v1/skills/{name}/package. */
export type SkillPackage = {
  name: string;
  description: string;
  enabled: boolean;
  custom: boolean;
  source: SkillSource;
  read_only: boolean;
  updated_at?: string;
  file_count: number;
  files: SkillFile[];
};

export type SkillFile = {
  path: string;
  content: string;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  me: boolean;
};

/** P0 whitelist — keep in sync with API AllowedReactionEmojis */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "❌", "👎"] as const;
/** Adding one of these on a bot reply opens the feedback dialog (reaction alone never creates a lesson). */
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
  role: "user" | "assistant" | "handoff" | string;
  content: string;
  agent_id?: string;
  conversation_id?: string;
  created_at?: string;
  /** Immediate parent when this message is a thread reply. */
  reply_to_id?: string;
  /** Thread root id (Slack-style); empty for main-timeline messages. */
  thread_root_id?: string;
  reactions?: ReactionSummary[];
  agent_message_id?: string;
  /** Runtime run id for Bot replies (omitted on historical / non-run messages). */
  request_id?: string;
  handoff?: HandoffPayload;
};

export type Conversation = {
  id: string;
  agent_id: string;
  title: string;
  channel_id?: string;
  created_at: string;
  updated_at?: string;
  messages?: Message[];
  /** Session-aware online for bots in this conversation (server-stamped). */
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

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function apiExtraHeaders(): HeadersInit {
  // ngrok free interstitial breaks Capacitor/WebView JSON unless skipped.
  if (/ngrok/i.test(API_BASE)) {
    return { "ngrok-skip-browser-warning": "1" };
  }
  return {};
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...apiExtraHeaders(),
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: string; message?: string };
    return j.error || j.message || text || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export async function register(username: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/auth/register`, {
    method: "POST",
    headers: { ...apiExtraHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: "POST",
    headers: { ...apiExtraHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMe(): Promise<User> {
  const res = await fetch(`${API_BASE}/v1/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

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

export async function fetchUserSettings(): Promise<UserSettings> {
  const res = await fetch(`${API_BASE}/v1/me/settings`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateUserSettings(body: {
  timezone?: string;
  auto_review_enabled?: boolean;
  auto_review_rules?: AutoReviewRule[];
}): Promise<UserSettings> {
  const res = await fetch(`${API_BASE}/v1/me/settings`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


export async function listAgents(): Promise<Agent[]> {
  const res = await fetch(`${API_BASE}/v1/agents`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.agents ?? [];
}

export async function createAgent(body: AgentInput): Promise<Agent> {
  const res = await fetch(`${API_BASE}/v1/agents`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateAgent(id: string, body: AgentPatch): Promise<Agent> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/agents/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export type CloneAgentInput = {
  name?: string;
  description?: string;
  system_prompt?: string;
  system_prompt_append?: string;
  computer_mode?: "team" | "private";
  /** Copy bot-scope memories (default true in UI / clone_agent tool). */
  copy_memory?: boolean;
  /** Copy routines bound to this bot — created paused (default false). */
  copy_routines?: boolean;
  enable_skills?: string[];
  disable_skills?: string[];
  /** Task handed to the copy right after cloning (runs in its own thread). */
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

/** Duplicate a bot (persona + skills; memory/routines opt-in). */
export async function cloneAgent(id: string, body: CloneAgentInput = {}): Promise<CloneAgentResult> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(id)}/clone`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function listAgentSkills(agentId: string): Promise<AgentSkill[]> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/skills`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.skills ?? [];
}

export async function setAgentSkill(
  agentId: string,
  name: string,
  enabled: boolean,
): Promise<AgentSkill> {
  const res = await fetch(
    `${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function replaceAgentSkills(
  agentId: string,
  enabled: string[],
): Promise<AgentSkill[]> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/skills`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.skills ?? [];
}

export async function applyAgentOnboarding(
  agentId: string,
  body: {
    focus?: string;
    description?: string;
    system_prompt?: string;
    skills?: string[] | null;
  },
): Promise<Agent> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/onboarding`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.agent as Agent;
}

/** Persist assistant reply as a custom skill package (SKILL.md). Off by default in UI. */
export async function saveSkillFromText(opts: {
  name: string;
  description?: string;
  body_markdown: string;
}): Promise<Skill> {
  return uploadSkill({
    name: opts.name,
    description: opts.description || "",
    body_markdown: opts.body_markdown,
  });
}

export async function listSkills(): Promise<Skill[]> {
  const res = await fetch(`${API_BASE}/v1/skills`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.skills ?? [];
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<Skill> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


export async function uploadSkill(body: {
  name: string;
  description: string;
  body_markdown: string;
}): Promise<Skill> {
  const res = await fetch(`${API_BASE}/v1/skills/upload`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function uploadSkillPackage(opts: {
  name?: string;
  description?: string;
  files?: SkillFile[];
  archive?: File;
  folderFiles?: File[];
}): Promise<Skill> {
  const { name, description, files, archive, folderFiles } = opts;
  if (archive || (folderFiles && folderFiles.length > 0)) {
    const form = new FormData();
    if (name?.trim()) form.append("name", name.trim());
    if (description?.trim()) form.append("description", description.trim());
    if (archive) {
      form.append("archive", archive, archive.name || "skill.zip");
    } else if (folderFiles) {
      for (const f of folderFiles) {
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        form.append("files", f, rel);
      }
    }
    const res = await fetch(`${API_BASE}/v1/skills/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  }
  const res = await fetch(`${API_BASE}/v1/skills/upload`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name,
      description,
      files,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getSkillPackage(name: string): Promise<SkillPackage> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}/package`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as SkillPackage;
  return { ...data, files: data.files ?? [] };
}

/** Create an empty custom skill (server writes a SKILL.md template) or one from files. 409 if name taken. */
export async function createSkill(body: {
  name: string;
  description?: string;
  files?: SkillFile[];
}): Promise<SkillPackage> {
  const res = await fetch(`${API_BASE}/v1/skills`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as SkillPackage;
  return { ...data, files: data.files ?? [] };
}

/** Whole-package write-back for a custom skill (editor save). */
export async function saveSkillPackage(name: string, files: SkillFile[]): Promise<SkillPackage> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}/package`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as SkillPackage;
  return { ...data, files: data.files ?? [] };
}

export async function exportSkillZip(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}/export`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  triggerBrowserDownload(await res.blob(), `${name}.zip`);
}

export async function deleteSkill(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}


export async function createConversation(agentId: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/v1/conversations`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ agent_id: agentId, title: "新对话" }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Get or create the single primary thread for (user, agent) — Grok-style bot-level chat. */
export async function openPrimaryConversation(agentId: string): Promise<Conversation> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/conversation`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.conversation as Conversation;
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/v1/conversations`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.conversations ?? [];
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export type ListMessagesResult = {
  messages: Message[];
  run_active?: boolean;
  task_active?: boolean;
};

export async function listMessages(conversationId: string): Promise<Message[]> {
  const res = await listMessagesWithStatus(conversationId);
  return res.messages;
}

export async function listMessagesWithStatus(
  conversationId: string,
): Promise<ListMessagesResult> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/messages`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return {
    messages: data.messages ?? [],
    run_active: Boolean(data.run_active),
    task_active: Boolean(data.task_active),
  };
}

export async function getConversationRunStatus(
  conversationId: string,
): Promise<{ active: boolean }> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/run`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return { active: Boolean(data.active) };
}

export async function listLLMConnections(): Promise<LLMConnection[]> {
  const res = await fetch(`${API_BASE}/v1/llm-connections`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.connections ?? [];
}

export type LLMInput = {
  name: string;
  base_url: string;
  api_key?: string;
  model: string;
  enable_tools?: boolean;
  is_default?: boolean;
  /** tokens; omit/null/empty = auto (model heuristic) */
  context_window?: number | null;
};

export async function createLLMConnection(body: LLMInput): Promise<LLMConnection> {
  const res = await fetch(`${API_BASE}/v1/llm-connections`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateLLMConnection(id: string, body: Partial<LLMInput>): Promise<LLMConnection> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteLLMConnection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function setDefaultLLMConnection(id: string): Promise<LLMConnection> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/${id}/default`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type LLMToolsProbeResult = {
  ok: boolean;
  can_enable_tools: boolean;
  supports_tools: boolean;
  mode: "native" | "markup" | "forced_only" | "none" | "error" | string;
  detail: string;
  hint?: string;
  error?: string;
  http_status?: number;
};

export async function probeLLMTools(body: {
  base_url?: string;
  api_key?: string;
  model?: string;
  connection_id?: string;
}): Promise<LLMToolsProbeResult> {
  const res = await fetch(`${API_BASE}/v1/llm/probe-tools`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function formatLLMToolsProbe(result: LLMToolsProbeResult): string {
  const modeLabel: Record<string, string> = {
    native: "原生 function calling",
    markup: "文本工具协议",
    forced_only: "仅强制 tool_choice",
    none: "不支持 tools",
    error: "检测失败",
  };
  const label = modeLabel[result.mode] || result.mode;
  const head = result.can_enable_tools ? `可用（${label}）` : `不可用（${label}）`;
  const bits = [head, result.detail];
  if (result.hint) bits.push(result.hint);
  return bits.filter(Boolean).join(" ");
}

export type AttachmentMeta = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  /** Relative auth GET path from upload / ListMessages, e.g. /v1/conversations/{id}/attachments/{id}. */
  url?: string;
};

export type StatusEvent = {
  phase?: string;
  label?: string;
  tool?: string;
  thread_id?: string;
  waiting_approval?: boolean;
  [key: string]: unknown;
};

export type StreamTokenInfo = { agent_id?: string };
export type StreamErrorInfo = { agent_id?: string };

export type StreamHandlers = {
  /** text plus optional agent_id so parallel group candidates route to the right bubble */
  onToken: (text: string, info?: StreamTokenInfo) => void;
  onMeta?: (data: Record<string, unknown>) => void;
  onStatus?: (data: StatusEvent) => void;
  onError?: (message: string, info?: StreamErrorInfo) => void;
  onDone?: (data?: Record<string, unknown>) => void;
  /** Group multi-agent: called when a new bot starts streaming. */
  onAgentStart?: (info: { agent_id: string; agent_name?: string; index?: number; total?: number }) => void;
  /** Conversation SSE `bot_online` (agent-global green dot; independent of bot_presence). */
  onBotOnline?: (evt: BotOnlineEvent) => void;
};

export function isImageAttachmentMime(mime?: string | null): boolean {
  return Boolean(mime && /^image\//i.test(mime.trim()));
}

/** Absolute API URL (no token). Relative paths are joined to API_BASE. */
export function absolutizeApiUrl(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (/^(https?:|blob:|data:)/i.test(u)) return u;
  if (u.startsWith("//")) return `${typeof location !== "undefined" ? location.protocol : "https:"}${u}`;
  if (u.startsWith("/")) return `${API_BASE}${u}`;
  return `${API_BASE}/${u}`;
}

/**
 * Build an <img>-safe URL for an attachment (or markdown auth path).
 * - blob:/data: returned as-is (optimistic local preview)
 * - relative/absolute attachment GET gets ?access_token= from getToken()
 * Does not log the token.
 */
export function attachmentDisplayUrl(attOrUrl: { url?: string } | string | null | undefined): string | null {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl?.url;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
  const abs = absolutizeApiUrl(trimmed);
  if (!abs) return null;
  if (/[?&]access_token=/.test(abs) || /[?&]token=/.test(abs)) return abs;
  const token = getToken();
  if (!token) return abs;
  const sep = abs.includes("?") ? "&" : "?";
  return `${abs}${sep}access_token=${encodeURIComponent(token)}`;
}

/** Path without secrets — safe to copy / show in UI. */
export function attachmentCopyUrl(attOrUrl: { url?: string } | string | null | undefined): string | null {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl?.url;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
  return absolutizeApiUrl(trimmed.split(/[?#]/)[0] || trimmed);
}

/** Relative path looks like authenticated attachment GET. */
export function isAttachmentAuthUrl(url: string): boolean {
  return /\/v1\/conversations\/[^/]+\/attachments\/[^/?#]+/i.test(url || "");
}

function extFromNameOrMime(name?: string, mime?: string): string {
  const fromName = (name || "").match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
  };
  return map[(mime || "").toLowerCase()] || "png";
}

/** `image-YYYYMMDD-HHmmss` + original extension (design v2 §2.2). */
export function imageDownloadFilename(name?: string, mime?: string, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `image-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${stamp}.${extFromNameOrMime(name, mime)}`;
}

/** Fetch attachment bytes with Bearer (preferred for download) or fall back to display URL. */
export async function fetchAttachmentBlob(attOrUrl: { url?: string } | string): Promise<Blob> {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl.url;
  if (!raw) throw new Error("no attachment url");
  if (/^(blob:|data:)/i.test(raw)) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`blob fetch ${res.status}`);
    return res.blob();
  }
  const abs = absolutizeApiUrl(raw.split(/[?#]/)[0] || raw);
  const token = getToken();
  const res = await fetch(abs, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}

export async function uploadConversationAttachment(
  conversationId: string,
  file: File,
): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/attachments`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function cancelConversationRun(conversationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Idempotent: 204 even when no run is active; ignore 404 for older servers.
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(await readError(res));
  }
}

/** Queue follow_up / steer / reject on a busy durable run. */
export async function steerConversationRun(
  conversationId: string,
  requestId: string,
  text: string,
  mode: "follow_up" | "steer" | "reject" = "follow_up",
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/steer`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, text, mode, when_busy: mode }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Resume a waiting_approval interrupt. */
export async function approveConversationRun(
  conversationId: string,
  requestId: string,
  approve: boolean,
  reason = "",
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/approve`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: requestId, approve, reason }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  handlers: StreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let sawDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const rawLine of parts) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const dataStr = line.slice(5).trim();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataStr) as Record<string, unknown>;
        } catch {
          data = { raw: dataStr };
        }
        if (eventName === "token" && typeof data.text === "string") {
          const tokenInfo: StreamTokenInfo = {};
          if (typeof data.agent_id === "string" && data.agent_id) {
            tokenInfo.agent_id = data.agent_id;
          }
          handlers.onToken(data.text, tokenInfo);
        } else if (eventName === "meta") {
          if (data.phase === "agent_start" && typeof data.agent_id === "string") {
            handlers.onAgentStart?.({
              agent_id: data.agent_id,
              agent_name: typeof data.agent_name === "string" ? data.agent_name : undefined,
              index: typeof data.index === "number" ? data.index : undefined,
              total: typeof data.total === "number" ? data.total : undefined,
            });
          }
          handlers.onMeta?.(data);
        } else if (eventName === "status") {
          handlers.onStatus?.(data as StatusEvent);
        } else if (eventName === "bot_online") {
          if (typeof data.agent_id === "string" && data.agent_id) {
            handlers.onBotOnline?.(data as unknown as BotOnlineEvent);
          }
        } else if (eventName === "error") {
          const msg =
            typeof data.message === "string"
              ? data.message
              : typeof data.raw === "string"
                ? data.raw
                : JSON.stringify(data);
          const errInfo: StreamErrorInfo = {};
          if (typeof data.agent_id === "string" && data.agent_id) {
            errInfo.agent_id = data.agent_id;
          }
          handlers.onError?.(msg, errInfo);
        } else if (eventName === "done") {
          sawDone = true;
          handlers.onDone?.(data);
        }
      } else if (line === "") {
        eventName = "message";
      }
    }
  }
  if (!sawDone) handlers.onDone?.();
}

export type HandoffContextMsg = {
  role: "user" | "assistant" | "system" | "summary" | string;
  content: string;
};

export async function sendMessageStream(
  conversationId: string,
  content: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  attachments?: AttachmentMeta[],
  agentIds?: string[],
  client?: import("./lib/clientEnv").ClientContext,
  handoffContext?: HandoffContextMsg[],
  replyToId?: string,
  /** Sidebar thread post only (thread panel open). Mainline 「回复」 must omit this. */
  threadRootId?: string,
): Promise<void> {
  const body: Record<string, unknown> = { content };
  if (attachments && attachments.length > 0) {
    body.attachments = attachments;
  }
  if (agentIds && agentIds.length > 0) {
    body.agent_ids = agentIds;
  }
  if (client) {
    body.client = client;
  }
  if (handoffContext && handoffContext.length > 0) {
    body.handoff_context = handoffContext;
  }
  if (replyToId) {
    body.reply_to_id = replyToId;
  }
  if (threadRootId) {
    body.thread_root_id = threadRootId;
  }
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await readError(res));
  }
  await readSSEStream(res.body, handlers);
}

/** Store a user message without starting an agent run (e.g. @handoff record on source bot). */
export async function persistConversationMessage(
  conversationId: string,
  content: string,
): Promise<Message> {
  const res = await fetch(`${API_BASE}/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content, persist_only: true }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.message as Message;
}

export async function toggleReaction(
  messageId: string,
  emoji: string,
): Promise<ReactionUpdatedEvent> {
  const res = await fetch(`${API_BASE}/v1/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteReaction(messageId: string, emoji: string): Promise<ReactionUpdatedEvent> {
  const res = await fetch(
    `${API_BASE}/v1/messages/${encodeURIComponent(messageId)}/reactions?emoji=${encodeURIComponent(emoji)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


/** Rejoin an in-flight server run after refresh / reconnect. Does not cancel on abort. */
export async function subscribeConversationEvents(
  conversationId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/events`, {
    method: "GET",
    headers: authHeaders({ Accept: "text/event-stream" }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await readError(res));
  }
  await readSSEStream(res.body, handlers);
}


export type Channel = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  members?: string[];
  member_profiles?: ChannelMemberProfile[];
  conversation_id?: string;
  task_active?: boolean;
};

export type ChannelMemberProfile = {
  agent_id: string;
  name?: string;
  avatar_shape: string;
  avatar_color: string;
  /** Server-computed bot online (see BOT_ONLINE_THRESHOLD_SEC). */
  online?: boolean;
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

export async function fetchCompactConfig(): Promise<CompactConfig | null> {
  const res = await fetch(`${API_BASE}/v1/compact-config`, { headers: authHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.compact as CompactConfig) ?? null;
}

export async function listChannels(): Promise<Channel[]> {
  const res = await fetch(`${API_BASE}/v1/channels`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.channels ?? [];
}

export async function createChannel(name: string, memberIds?: string[]): Promise<Channel> {
  const res = await fetch(`${API_BASE}/v1/channels`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, member_ids: memberIds ?? [] }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteChannel(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/channels/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function openChannelConversation(channelId: string): Promise<{
  channel: Channel;
  conversation: Conversation;
}> {
  const res = await fetch(`${API_BASE}/v1/channels/${channelId}/conversation`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function addChannelMember(channelId: string, agentId: string): Promise<Channel> {
  const res = await fetch(`${API_BASE}/v1/channels/${channelId}/members`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function postAgentBusMessage(body: {
  from_agent_id?: string;
  to_agent_id?: string;
  channel_id?: string;
  priority?: boolean;
  body: string;
}): Promise<AgentBusMessage> {
  const res = await fetch(`${API_BASE}/v1/agent-bus/messages`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function listAgentBusInbox(opts?: {
  unread?: boolean;
  agent_id?: string;
}): Promise<AgentBusMessage[]> {
  const q = new URLSearchParams();
  if (opts?.unread) q.set("unread", "1");
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  const qs = q.toString();
  const res = await fetch(`${API_BASE}/v1/agent-bus/inbox${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.messages ?? [];
}

export function agentBusWebSocketUrl(token?: string | null): string {
  const t = (token ?? getToken() ?? "").trim();
  const wsBase = API_BASE.replace(/^http/i, (scheme) =>
    scheme.toLowerCase() === "https" ? "wss" : "ws",
  );
  const q = t ? `?token=${encodeURIComponent(t)}` : "";
  return `${wsBase}/v1/agent-bus/ws${q}`;
}

export function hostExecWebSocketUrl(machineId: string, token?: string | null): string {
  const t = (token ?? getToken() ?? "").trim();
  const wsBase = API_BASE.replace(/^http/i, (scheme) =>
    scheme.toLowerCase() === "https" ? "wss" : "ws",
  );
  const q = t ? `?token=${encodeURIComponent(t)}` : "";
  return `${wsBase}/v1/machines/${encodeURIComponent(machineId)}/exec${q}`;
}

export function chatEventsWebSocketUrl(token?: string | null): string {
  const t = (token ?? getToken() ?? "").trim();
  const wsBase = API_BASE.replace(/^http/i, (scheme) =>
    scheme.toLowerCase() === "https" ? "wss" : "ws",
  );
  const q = t ? `?token=${encodeURIComponent(t)}` : "";
  return `${wsBase}/v1/events/ws${q}`;
}

export type ChatTaskStatus = {
  type: "task_status";
  conversation_id: string;
  agent_id?: string;
  channel_id?: string;
  status: string;
  label?: string;
};

export type ChatServerEvent =
  | { type: "conversation_message"; message: Message }
  | ChatTaskStatus;

export async function createHostConfirm(
  conversationId: string,
  body: { req_id: string; op: string; path: string; dest?: string; preview?: string; reason?: string; review_tier?: string },
): Promise<Message> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/host-confirms`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as Message;
}

export async function decideHostConfirm(
  conversationId: string,
  messageId: string,
  status: "allowed" | "denied",
): Promise<Message> {
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/host-confirms/${messageId}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as Message;
}

/** Content the client / server uses to mark an interrupted Bot turn (「（已停止）」 and variants). */
export const STOP_MARKER_TEXT = "（已停止）";
export function isStopMarkerContent(content: string | undefined | null): boolean {
  const t = (content ?? "").trim();
  return /^[（(]?\s*已停止\s*[）)]?$/u.test(t);
}

type MergeableMessage = Message & { streaming?: boolean; stopped?: boolean };

/**
 * Fold a server message into the local list.
 * - Same id updates in place.
 * - A server stop marker (「已停止」) adopts the earliest still-local sealed stop bubble
 *   (the one stopCurrentRun stamped), never the next turn's empty streaming placeholder.
 * - Otherwise a local bubble with the same / prefix text takes the server id.
 * - Empty *streaming* assistant placeholders never fuzzy-match incoming messages: they belong to
 *   the run that is streaming into them, and only that run's `message_saved` (stampSavedMessage)
 *   gives them a server id. Letting them absorb arbitrary messages made an interrupted turn's
 *   stop marker land on the next turn's placeholder → two 「已停止」 in the UI, one in the DB.
 * - New rows insert before trailing streaming assistants and by created_at among sealed rows so
 *   mid-turn projected acks/stage updates stay before the final reply (not appended after it).
 */
export function mergeIncomingMessage<T extends MergeableMessage>(
  prev: T[],
  msg: Message,
): T[] {
  if (!msg?.id) return prev;
  if (prev.some((m) => m.id === msg.id)) {
    return prev.map((m) => (m.id === msg.id ? ({ ...m, ...msg, streaming: false } as T) : m));
  }
  // Keep trailing streaming assistant placeholders last (tokens / stampSavedMessage own them).
  const beforeTrailingStreaming = () => {
    let at = prev.length;
    while (at > 0 && prev[at - 1].streaming && prev[at - 1].role === "assistant") at -= 1;
    return at;
  };
  // Mid-turn journal projections (assistant_partial) arrive over WS while the final
  // reply still streams into a trailing placeholder. Appending would put early ack /
  // stage updates AFTER the final once that placeholder is stamped. Insert before
  // trailing streams, and among sealed rows by created_at so late WS deliveries
  // still keep chronological order (early ack → stage → final).
  const insertKeepingStreamLast = (row: T): T[] => {
    const streamAt = beforeTrailingStreaming();
    const sealed = prev.slice(0, streamAt);
    const trailing = prev.slice(streamAt);
    const incomingAt = msg.created_at ? Date.parse(msg.created_at) : Number.NaN;
    let insertAt = sealed.length;
    if (!Number.isNaN(incomingAt)) {
      for (let i = 0; i < sealed.length; i++) {
        const raw = sealed[i].created_at;
        const t = raw ? Date.parse(String(raw)) : Number.NaN;
        if (!Number.isNaN(t) && t > incomingAt) {
          insertAt = i;
          break;
        }
      }
    }
    const next = sealed.slice();
    next.splice(insertAt, 0, row);
    return trailing.length ? next.concat(trailing) : next;
  };
  if (msg.role === "host_confirm") {
    return insertKeepingStreamLast({ ...msg, streaming: false } as T);
  }
  const adopt = (i: number) =>
    prev.map((item, j) =>
      j === i ? ({ ...item, ...msg, streaming: false } as T) : item,
    );
  const incomingStop = msg.role === "assistant" && isStopMarkerContent(msg.content);
  if (incomingStop) {
    // Earliest first: with several interrupted turns, server stop rows arrive in order.
    const i = prev.findIndex(
      (m) =>
        m.role === "assistant" &&
        !m.streaming &&
        m.id.startsWith("local-") &&
        (m.stopped || isStopMarkerContent(m.content)),
    );
    if (i >= 0) return adopt(i);
  }
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m.role !== msg.role) continue;
    // Rule: an empty streaming placeholder is never a fuzzy-match target; look past it.
    if (m.streaming && m.role === "assistant" && !(m.content ?? "").trim()) continue;
    const local = Boolean(m.streaming) || m.id.startsWith("local-");
    if (!local) break;
    const same =
      m.content === msg.content ||
      (m.content === "" && !m.streaming) ||
      (m.content !== "" && msg.content.startsWith(m.content));
    if (!same) break;
    return adopt(i);
  }
  return insertKeepingStreamLast({ ...msg, streaming: false } as T);
}

export type AgentBusWSEvent = {
  type: string;
  message?: AgentBusMessage;
};

export async function markAgentBusRead(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/agent-bus/messages/${id}/read`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}


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

export async function listMCPServers(): Promise<MCPServer[]> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.servers ?? [];
}

export async function createMCPServer(body: MCPServerInput): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateMCPServer(
  id: string,
  body: Partial<MCPServerInput>,
): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteMCPServer(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function testMCPServer(
  id: string,
): Promise<{
  ok: boolean;
  tool_names?: string[];
  tools?: MCPToolSummary[];
  error?: string;
  count?: number;
}> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers/${id}/test`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function mcpListTools(serverId?: string): Promise<{
  tools: Array<{
    name: string;
    description?: string;
    server_id?: string;
    server_name?: string;
    qualified_name?: string;
    error?: string;
  }>;
  count: number;
}> {
  const res = await fetch(`${API_BASE}/v1/mcp/list-tools`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(serverId ? { server_id: serverId } : {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function mcpCallTool(body: {
  server_id: string;
  tool: string;
  arguments?: Record<string, unknown>;
}): Promise<{
  ok?: boolean;
  text?: string;
  error?: string;
  content?: string[];
}> {
  const res = await fetch(`${API_BASE}/v1/mcp/call-tool`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


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
};

export async function listInboundHooks(): Promise<InboundHook[]> {
  const res = await fetch(`${API_BASE}/v1/inbound-hooks`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.hooks ?? [];
}

export async function createInboundHook(body: {
  provider: string;
  label?: string;
  secret?: string;
}): Promise<InboundHook & { hint?: string }> {
  const res = await fetch(`${API_BASE}/v1/inbound-hooks`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteInboundHook(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/inbound-hooks/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function listRoutines(): Promise<Routine[]> {
  const res = await fetch(`${API_BASE}/v1/routines`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.routines ?? [];
}

export async function createRoutine(body: RoutineInput): Promise<Routine> {
  const res = await fetch(`${API_BASE}/v1/routines`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateRoutine(
  id: string,
  body: Partial<RoutineInput>,
): Promise<Routine> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteRoutine(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function runRoutine(
  id: string,
): Promise<{ routine: Routine; run: RoutineRun }> {
  const res = await fetch(`${API_BASE}/v1/routines/${id}/run`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


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

export async function getSandbox(ensure?: boolean): Promise<Sandbox> {
  const q = ensure ? "?ensure=1" : "";
  const res = await fetch(`${API_BASE}/v1/sandbox${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function ensureSandbox(opts?: {
  desktop?: boolean;
  agent_id?: string;
  mode?: string;
}): Promise<Sandbox> {
  const res = await fetch(`${API_BASE}/v1/sandbox/ensure`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      desktop: Boolean(opts?.desktop),
      agent_id: opts?.agent_id || undefined,
      mode: opts?.mode || undefined,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Proxied noVNC URL (JWT via access_token query + cookie). */
export function sandboxDesktopURL(extra?: { desktop_token?: string }): string {
  const token = getToken() || "";
  const q = new URLSearchParams();
  if (token) q.set("access_token", token);
  if (extra?.desktop_token) q.set("desktop_token", extra.desktop_token);
  const qs = q.toString();
  return `${API_BASE}/v1/sandbox/desktop${qs ? `?${qs}` : ""}`;
}

export async function stopSandbox(): Promise<Sandbox> {
  const res = await fetch(`${API_BASE}/v1/sandbox/stop`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function resetSandbox(): Promise<{ sandbox: Sandbox; warning?: string }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/reset`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function execSandbox(body: {
  cmd: string;
  workdir?: string;
  timeout_sec?: number;
}): Promise<SandboxExecResult> {
  const res = await fetch(`${API_BASE}/v1/sandbox/exec`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  triggerBrowserDownload(new Blob([text], { type: mime }), filename || "download");
}

export async function downloadSandboxFile(
  path: string,
  opts?: { agent_id?: string },
): Promise<void> {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  const res = await fetch(`${API_BASE}/v1/sandbox/files/download?${q.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const quoted = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  const name = quoted?.[1] || path.split("/").filter(Boolean).pop() || "download";
  triggerBrowserDownload(blob, name);
}

export async function readSandboxFile(
  path: string,
  opts?: { agent_id?: string },
): Promise<{ path: string; content: string }> {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  const res = await fetch(`${API_BASE}/v1/sandbox/files?${q.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function writeSandboxFile(path: string, content: string): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/files`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function listSandbox(path = "/workspace"): Promise<{
  path: string;
  entries: SandboxDirEntry[];
}> {
  const res = await fetch(`${API_BASE}/v1/sandbox/ls?path=${encodeURIComponent(path)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


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

export async function listBotSecrets(agentId?: string): Promise<BotSecretMeta[]> {
  const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  const res = await fetch(`${API_BASE}/v1/bot-secrets${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.secrets || [];
}

export async function createBotSecret(body: {
  name: string;
  value: string;
  origin?: string;
  auth_type?: string;
  agent_id?: string;
}): Promise<BotSecretMeta> {
  const res = await fetch(`${API_BASE}/v1/bot-secrets`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteBotSecret(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/bot-secrets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function listBotSecretRequests(): Promise<BotSecretRequest[]> {
  const res = await fetch(`${API_BASE}/v1/bot-secret-requests`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.requests || [];
}

export async function resolveBotSecretRequest(
  id: string,
  body: { value?: string; name?: string; origin?: string; auth_type?: string; agent_id?: string; dismiss?: boolean },
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/v1/bot-secret-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function checkpointSandbox(): Promise<{ checkpoint_path: string; sandbox: Sandbox }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/checkpoint`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


// ---------------------------------------------------------------------------
// Registered host machines (ListMachines-like)
// ---------------------------------------------------------------------------

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
  /** desktop | mobile | browser — optional on old servers; client always sends on register. */
  device_type?: "desktop" | "mobile" | "browser" | string;
  status: "online" | "offline" | string;
  last_seen: string;
  file_op_count?: number;
  /** allow | ask | deny — bot may run host ops on this machine (Auto-review still applies). */
  exec_policy?: "allow" | "ask" | "deny" | string;
  connected?: boolean;
  created_at: string;
  updated_at?: string;
};

export async function listMachines(): Promise<Machine[]> {
  const res = await fetch(`${API_BASE}/v1/machines`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machines?: Machine[] };
  return data.machines || [];
}

export async function registerMachine(input: {
  machine_key: string;
  label?: string;
  platform?: string;
  os?: string;
  arch?: string;
  app?: string;
  app_version?: string;
  /** Client sends; old servers ignore unknown fields. */
  device_type?: "desktop" | "mobile" | "browser";
}): Promise<Machine> {
  const res = await fetch(`${API_BASE}/v1/machines/register`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machine: Machine };
  return data.machine;
}

export async function heartbeatMachine(id: string): Promise<Machine> {
  const res = await fetch(`${API_BASE}/v1/machines/${encodeURIComponent(id)}/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machine: Machine };
  return data.machine;
}

export async function updateMachineLabel(id: string, label: string): Promise<Machine> {
  return updateMachine(id, { label });
}

export async function updateMachine(
  id: string,
  body: { label?: string; exec_policy?: "allow" | "ask" | "deny" | string },
): Promise<Machine> {
  const res = await fetch(`${API_BASE}/v1/machines/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machine: Machine };
  return data.machine;
}

export async function deleteMachine(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/machines/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function fetchOIDCConfig(): Promise<{
  enabled: boolean;
  endpoint?: string;
  client_id?: string;
  redirect_uri?: string;
}> {
  const res = await fetch(`${API_BASE}/v1/auth/oidc/config`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startOIDCLogin(): Promise<{ authorize_url: string; state: string }> {
  const res = await fetch(`${API_BASE}/v1/auth/oidc/start?redirect=0`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function exchangeOIDCCode(
  code: string,
  state: string,
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/auth/oidc/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

// ---- Message feedback + bot lessons (training) ----

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

export type CreateFeedbackInput = {
  message_id: string;
  agent_id: string;
  conversation_id: string;
  polarity: FeedbackPolarity;
  reasons: string[];
  note?: string;
  source: FeedbackSource;
};

export async function createMessageFeedback(body: CreateFeedbackInput): Promise<MessageFeedback> {
  const res = await fetch(`${API_BASE}/v1/message-feedbacks`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function listAgentFeedbacks(agentId: string): Promise<MessageFeedback[]> {
  const res = await fetch(`${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/feedbacks`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.feedbacks ?? [];
}

export async function listAgentLessons(
  agentId: string,
  status?: LessonStatus | string,
): Promise<BotLesson[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(
    `${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/lessons${q}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.lessons ?? [];
}

export async function listActiveAgentLessons(agentId: string): Promise<BotLesson[]> {
  const res = await fetch(
    `${API_BASE}/v1/agents/${encodeURIComponent(agentId)}/lessons/active`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.lessons ?? [];
}

export type LessonPatch = {
  title?: string;
  body?: string;
  tags?: string[];
  status?: LessonStatus | string;
};

export async function updateLesson(id: string, body: LessonPatch): Promise<BotLesson> {
  const res = await fetch(`${API_BASE}/v1/lessons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteLesson(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/lessons/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}
