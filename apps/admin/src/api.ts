const API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:18080").replace(
  /\/$/,
  "",
);

export const WEB_URL = (import.meta.env.VITE_WEB_URL || "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);

const TOKEN_KEY = "openbot_admin_token";
const USER_KEY = "openbot_admin_user";

export type User = {
  id: string;
  username: string;
  email?: string;
  org_id?: string;
  role?: "platform_admin" | "org_admin" | "member" | string;
  created_at?: string;
};

export type AdminMember = {
  id: string;
  username: string;
  email?: string;
  role: string;
  org_id?: string;
  created_at?: string;
};

export type AdminInvite = {
  id: string;
  org_id: string;
  username_or_email: string;
  role: string;
  status: string;
  created_at?: string;
};

export type OrgLLMSettings = {
  org_id: string;
  llm_name: string;
  llm_base_url: string;
  llm_model: string;
  llm_enable_tools: boolean;
  llm_context_window?: number | null;
  llm_max_tool_rounds?: number | null;
  api_key_set: boolean;
  api_key_hint?: string;
  feature_flags_json?: string;
  updated_at?: string;
};

export type UsageRunDay = {
  day?: string;
  org_id?: string;
  user_id?: string;
  username?: string;
  agent_id?: string;
  agent_name?: string;
  run_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type OrgUsage = {
  org_id: string;
  member_count: number;
  conversation_count: number;
  message_count: number;
  agent_count: number;
  run_count?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  by_day?: UsageRunDay[];
  by_user?: UsageRunDay[];
  by_bot?: UsageRunDay[];
};

export type PlatformOrgSummary = {
  org_id: string;
  slug: string;
  name: string;
  member_count: number;
  conversation_count: number;
  message_count: number;
  agent_count: number;
  run_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
};

export type AuditLog = {
  id: string;
  org_id: string;
  actor_user_id: string;
  actor_username?: string;
  action: string;
  target_type: string;
  target_id: string;
  meta_json: string;
  created_at: string;
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

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
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

export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const res = await fetch(`${API_BASE}/v1/admin/auth/oidc/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client": "admin" },
    credentials: "include",
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetOrg(): Promise<{ org: { id: string; slug: string; name: string }; me?: User }> {
  const res = await fetch(`${API_BASE}/v1/admin/org`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListMembers(): Promise<{ members: AdminMember[]; invites: AdminInvite[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/members`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminInviteMember(
  username: string,
  role: string,
): Promise<{ joined: boolean; user?: User; invite?: AdminInvite; role?: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/members/invite`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username, role }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPatchMember(id: string, role: string): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/v1/admin/members/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetOrgLLM(): Promise<OrgLLMSettings> {
  const res = await fetch(`${API_BASE}/v1/admin/org/llm`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPutOrgLLM(body: {
  name: string;
  base_url: string;
  api_key?: string;
  model: string;
  enable_tools: boolean;
  context_window?: number | null;
  max_tool_rounds?: number | null;
}): Promise<OrgLLMSettings> {
  const res = await fetch(`${API_BASE}/v1/admin/org/llm`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type LLMToolsProbeResult = {
  ok: boolean;
  can_enable_tools: boolean;
  supports_tools: boolean;
  mode: string;
  detail: string;
  hint?: string;
  error?: string;
};

export async function adminProbeOrgLLMTools(body: {
  base_url?: string;
  api_key?: string;
  model?: string;
}): Promise<LLMToolsProbeResult> {
  const res = await fetch(`${API_BASE}/v1/admin/org/llm/probe-tools`, {
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

export type DecisionSettings = {
  provider: string;
  base_url: string;
  model: string;
  api_key_set: boolean;
  api_key_hint?: string;
  updated_at?: string;
};

export async function adminGetDecision(): Promise<DecisionSettings> {
  const res = await fetch(`${API_BASE}/v1/admin/org/decision`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPutDecision(body: {
  provider: string;
  base_url: string;
  api_key?: string;
  model: string;
}): Promise<DecisionSettings> {
  const res = await fetch(`${API_BASE}/v1/admin/org/decision`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminTestDecision(body: {
  provider: string;
  base_url: string;
  api_key?: string;
  model: string;
}): Promise<{
  enabled: boolean;
  provider: string;
  model?: string;
  answers?: Record<string, { type?: string; noul?: number; choice?: string; score?: number }>;
}> {
  const res = await fetch(`${API_BASE}/v1/admin/org/decision/test`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetUsage(days = 30, orgId?: string): Promise<OrgUsage> {
  const q = new URLSearchParams({ days: String(days) });
  if (orgId) q.set("org_id", orgId);
  const headers: HeadersInit = { ...authHeaders() };
  if (orgId) (headers as Record<string, string>)["X-Admin-Org-Id"] = orgId;
  const res = await fetch(`${API_BASE}/v1/admin/usage?${q}`, { headers });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetFeatureFlags(): Promise<{ feature_flags_json: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/feature-flags`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPutFeatureFlags(feature_flags_json: string): Promise<{ feature_flags_json: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/feature-flags`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ feature_flags_json }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListAuditLogs(limit = 100): Promise<{ logs: AuditLog[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/audit-logs?limit=${limit}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


export type AdminUser = {
  id: string;
  username: string;
  email?: string;
  role: string;
  org_id?: string;
  created_at?: string;
};

export type AdminBot = {
  id: string;
  user_id: string;
  owner_username?: string;
  name: string;
  description?: string;
  system_prompt?: string;
  is_builtin?: boolean;
  computer_mode?: string;
  created_at?: string;
  updated_at?: string;
};

export type AdminTrace = {
  id: string;
  name?: string;
  userId?: string;
  userName?: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
  timestamp?: string;
  latency?: number | null;
  observationId?: string;
  type?: string;
  level?: string;
  projectId?: string;
  langfuse_url?: string;
};

export async function adminListUsers(): Promise<{ users: AdminUser[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/users`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminCreateUser(body: {
  username: string;
  password: string;
  email?: string;
  role?: string;
}): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/v1/admin/users`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPatchUser(
  id: string,
  body: { email?: string; role?: string; password?: string },
): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/v1/admin/users/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminDeleteUser(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function adminBatchDeleteUsers(ids: string[]): Promise<{
  deleted: { id: string; username: string; agent_ids: string[] }[];
  failed: { id: string; error: string }[];
}> {
  const res = await fetch(`${API_BASE}/v1/admin/users/batch-delete`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPurgeUserData(id: string): Promise<{
  ok: boolean;
  user_id: string;
  username: string;
  agent_ids: string[];
  counts: Record<string, number>;
  side_effects?: Record<string, string>;
  purged?: string[];
  kept?: string[];
}> {
  const res = await fetch(`${API_BASE}/v1/admin/users/${encodeURIComponent(id)}/purge-data`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ confirm: "purge-data" }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListBots(): Promise<{ bots: AdminBot[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/bots`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminCreateBot(body: {
  user_id: string;
  name: string;
  description?: string;
  system_prompt?: string;
  computer_mode?: string;
}): Promise<{ bot: AdminBot }> {
  const res = await fetch(`${API_BASE}/v1/admin/bots`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPatchBot(
  id: string,
  body: {
    name?: string;
    description?: string;
    system_prompt?: string;
    computer_mode?: string;
  },
): Promise<{ bot: AdminBot }> {
  const res = await fetch(`${API_BASE}/v1/admin/bots/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Copy a bot inside the org (same owner). Persona + skills; memory/routines opt-in, routines paused. */
export async function adminCloneBot(
  id: string,
  body: { name?: string; copy_memory?: boolean; copy_routines?: boolean } = {},
): Promise<{ bot: AdminBot; memories_copied?: number; routines_copied?: number }> {
  const res = await fetch(`${API_BASE}/v1/admin/bots/${encodeURIComponent(id)}/clone`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminDeleteBot(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/admin/bots/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function adminTracesStatus(): Promise<{
  enabled: boolean;
  ready?: boolean;
  public_ui_url?: string;
  base_url?: string;
  project_id?: string;
  reason?: string;
}> {
  const res = await fetch(`${API_BASE}/v1/admin/traces/status`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListTraces(params?: {
  limit?: number;
  page?: number;
  cursor?: string;
}): Promise<{
  enabled: boolean;
  reason?: string;
  traces: AdminTrace[];
  public_ui_url?: string;
  project_id?: string;
  meta?: { cursor?: string };
}> {
  const q = new URLSearchParams();
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.page) q.set("page", String(params.page));
  if (params?.cursor) q.set("cursor", params.cursor);
  const qs = q.toString();
  const res = await fetch(`${API_BASE}/v1/admin/traces${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type AdminMemory = {
  id: string;
  user_id: string;
  username?: string;
  scope: string;
  agent_id?: string;
  agent_name?: string;
  channel_id?: string;
  channel_name?: string;
  peer_agent_id?: string;
  peer_agent_name?: string;
  tier?: string;
  content: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
};

export type AdminAutoMemory = {
  id?: string;
  content: string;
  scope?: string;
  agent_id?: string;
  channel_id?: string;
  peer_agent_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type AdminCompaction = {
  id: string;
  content: string;
  created_at?: string;
  conversation_id?: string;
  title?: string;
  user_id?: string;
  username?: string;
  agent_id?: string;
  agent_name?: string;
  channel_id?: string;
  channel_name?: string;
  scope?: string;
};

export type AdminChannel = {
  id: string;
  user_id: string;
  username?: string;
  name: string;
  created_at?: string;
  member_ids?: string[];
  member_names?: string;
};

export type MemoryQuery = {
  scope?: string;
  user_id?: string;
  agent_id?: string;
  channel_id?: string;
  peer_agent_id?: string;
  tier?: string;
  limit?: number;
};

function memoryQuery(params: MemoryQuery): string {
  const q = new URLSearchParams();
  if (params.scope) q.set("scope", params.scope);
  if (params.user_id) q.set("user_id", params.user_id);
  if (params.agent_id) q.set("agent_id", params.agent_id);
  if (params.channel_id) q.set("channel_id", params.channel_id);
  if (params.peer_agent_id) q.set("peer_agent_id", params.peer_agent_id);
  if (params.tier) q.set("tier", params.tier);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export async function adminListMemories(params: MemoryQuery): Promise<{ memories: AdminMemory[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/memories${memoryQuery(params)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListAutoMemories(
  params: MemoryQuery,
): Promise<{ enabled: boolean; memories: AdminAutoMemory[]; reason?: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/memories/auto${memoryQuery(params)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListCompactions(
  params: MemoryQuery,
): Promise<{ compactions: AdminCompaction[]; note?: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/compactions${memoryQuery(params)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListChannels(): Promise<{ channels: AdminChannel[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/channels`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


export type AdminMemoryRecallItem = {
  source: string;
  scope?: string;
  tier?: string;
  content?: string;
  snippet?: string;
  memory_id?: string;
  agent_id?: string;
  channel_id?: string;
  peer_agent_id?: string;
  score?: number;
};

export type AdminMemoryRecall = {
  id: string;
  org_id?: string;
  user_id: string;
  username?: string;
  agent_id?: string;
  agent_name?: string;
  conversation_id?: string;
  message_id?: string;
  run_id?: string;
  langfuse_trace_id?: string;
  source?: string;
  scene?: string;
  explicit_count?: number;
  mem0_count?: number;
  item_count?: number;
  items?: AdminMemoryRecallItem[];
  created_at?: string;
};

export type MemoryRecallQuery = {
  user_id?: string;
  conversation_id?: string;
  agent_id?: string;
  run_id?: string;
  langfuse_trace_id?: string;
  from?: string;
  to?: string;
  limit?: number;
};

function memoryRecallQuery(params: MemoryRecallQuery): string {
  const q = new URLSearchParams();
  if (params.user_id) q.set("user_id", params.user_id);
  if (params.conversation_id) q.set("conversation_id", params.conversation_id);
  if (params.agent_id) q.set("agent_id", params.agent_id);
  if (params.run_id) q.set("run_id", params.run_id);
  if (params.langfuse_trace_id) q.set("langfuse_trace_id", params.langfuse_trace_id);
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export async function adminListMemoryRecalls(
  params: MemoryRecallQuery = {},
): Promise<{ recalls: AdminMemoryRecall[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/memory-recalls${memoryRecallQuery(params)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetMemoryRecall(id: string): Promise<{ recall: AdminMemoryRecall }> {
  const res = await fetch(`${API_BASE}/v1/admin/memory-recalls/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetCompactConfig(): Promise<{ compact?: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/v1/admin/compact-config`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type AdminSkillFile = {
  path: string;
  content?: string;
};

export type AdminSkillBotRef = {
  id: string;
  name: string;
};

export type AdminSkill = {
  name: string;
  description: string;
  body_markdown?: string;
  enabled: boolean;
  source?: "builtin" | "custom" | string;
  read_only?: boolean;
  bot_count?: number;
  bots?: AdminSkillBotRef[];
  files?: AdminSkillFile[];
  created_at?: string;
  updated_at?: string;
};

export type AdminBotSkill = {
  name: string;
  description: string;
  enabled: boolean;
  custom?: boolean;
  account_enabled?: boolean;
};

export type AdminUserSkill = {
  name: string;
  description: string;
  enabled: boolean;
  custom: boolean;
};

export async function adminListSkills(all = true): Promise<{ skills: AdminSkill[] }> {
  const q = all ? "?all=1" : "";
  const res = await fetch(`${API_BASE}/v1/admin/skills${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminGetSkill(name: string): Promise<AdminSkill> {
  const res = await fetch(`${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminUpsertSkill(body: {
  name: string;
  description: string;
  body_markdown: string;
  enabled?: boolean;
}): Promise<AdminSkill> {
  const res = await fetch(`${API_BASE}/v1/admin/skills`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminPatchSkill(
  name: string,
  body: { description?: string; body_markdown?: string; enabled?: boolean },
): Promise<AdminSkill> {
  const res = await fetch(`${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminUpsertSkillFile(
  name: string,
  path: string,
  content: string,
): Promise<AdminSkill> {
  const res = await fetch(`${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}/files`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminDeleteSkillFile(name: string, path: string): Promise<void> {
  const q = new URLSearchParams({ path });
  const res = await fetch(
    `${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}/files?${q.toString()}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}

export async function adminDeleteSkill(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function adminImportSkillZip(
  file: File,
  opts?: { name?: string; description?: string; enabled?: boolean },
): Promise<AdminSkill> {
  const form = new FormData();
  form.append("archive", file, file.name || "skill.zip");
  if (opts?.name?.trim()) form.append("name", opts.name.trim());
  if (opts?.description?.trim()) form.append("description", opts.description.trim());
  if (opts?.enabled === false) form.append("enabled", "false");
  const res = await fetch(`${API_BASE}/v1/admin/skills/import`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminExportSkillZip(name: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}/export`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(cd);
  const filename = match?.[1] || `${name}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function adminSaveSkillPackage(
  name: string,
  files: { path: string; content: string }[],
): Promise<AdminSkill> {
  const res = await fetch(`${API_BASE}/v1/admin/skills/${encodeURIComponent(name)}/package`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListBotSkills(botId: string): Promise<{ skills: AdminBotSkill[]; bot_id: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/bots/${encodeURIComponent(botId)}/skills`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminSetBotSkill(
  botId: string,
  name: string,
  enabled: boolean,
): Promise<AdminBotSkill> {
  const res = await fetch(
    `${API_BASE}/v1/admin/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}


export async function adminListUserSkills(userId: string): Promise<{ skills: AdminUserSkill[] }> {
  const res = await fetch(`${API_BASE}/v1/admin/users/${encodeURIComponent(userId)}/skills`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminSetUserSkill(
  userId: string,
  name: string,
  enabled: boolean,
): Promise<AdminUserSkill> {
  const res = await fetch(
    `${API_BASE}/v1/admin/users/${encodeURIComponent(userId)}/skills/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ enabled }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type AdminMachine = {
  id: string;
  user_id: string;
  machine_key: string;
  label: string;
  platform: string;
  os: string;
  arch: string;
  app: string;
  app_version: string;
  status: string;
  last_seen: string;
  created_at: string;
  updated_at: string;
  file_op_count: number;
  connected: boolean;
};

export async function adminListUserMachines(
  userId: string,
): Promise<{ machines: AdminMachine[]; user_id: string; username?: string }> {
  const res = await fetch(`${API_BASE}/v1/admin/users/${encodeURIComponent(userId)}/machines`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminDeleteUserMachine(userId: string, machineId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/v1/admin/users/${encodeURIComponent(userId)}/machines/${encodeURIComponent(machineId)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
}

export async function adminGetTrace(id: string): Promise<{
  enabled: boolean;
  reason?: string;
  trace: AdminTrace | null;
  observations?: unknown[];
  public_ui_url?: string;
  project_id?: string;
}> {
  const res = await fetch(`${API_BASE}/v1/admin/traces/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adminListPlatformOrgs(days = 30): Promise<{
  orgs: PlatformOrgSummary[];
  days: number;
  count: number;
}> {
  const res = await fetch(`${API_BASE}/v1/admin/platform/orgs?days=${days}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function adminCreatePlatformOrg(slug: string, name: string): Promise<{
  id: string;
  slug: string;
  name: string;
}> {
  const res = await fetch(`${API_BASE}/v1/admin/platform/orgs`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ slug, name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function getAdminScopeOrgId(): string | null {
  return localStorage.getItem("openbot_admin_scope_org") || null;
}

export function setAdminScopeOrgId(orgId: string | null) {
  if (!orgId) localStorage.removeItem("openbot_admin_scope_org");
  else localStorage.setItem("openbot_admin_scope_org", orgId);
}
