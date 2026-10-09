import { detectClientContext } from "./client";
import { API_BASE } from "./config";
import { ApiError, expoFetch, filePart, request, toWebSocketBase, upload } from "./http";
import { readSSEStream } from "./sse";
import { getToken } from "./session";
import type {
  Agent,
  AgentBusMessage,
  AgentInput,
  AgentPatch,
  AgentSkill,
  AttachmentMeta,
  AutoReviewRule,
  BotLesson,
  BotPresenceEvent,
  BotSecretMeta,
  BotSecretRequest,
  BotSecretResolveInput,
  Channel,
  CloneAgentInput,
  CloneAgentResult,
  CompactConfig,
  Conversation,
  CreateFeedbackInput,
  HostConfirmPayload,
  InboundHook,
  LLMConnection,
  LLMInput,
  LLMToolsProbeResult,
  LessonPatch,
  LessonStatus,
  ListMessagesResult,
  Machine,
  MachineInput,
  MCPServer,
  MCPServerInput,
  MCPToolEntry,
  Message,
  MessageFeedback,
  OIDCConfig,
  ReactionUpdatedEvent,
  Routine,
  RoutineInput,
  RoutineRun,
  Sandbox,
  SandboxDirEntry,
  SandboxExecResult,
  Skill,
  StatusEvent,
  StreamHandlers,
  User,
  UserSettings,
} from "./types";

export { BOT_ONLINE_THRESHOLD_SEC, NEGATIVE_REACTION_EMOJIS, REACTION_EMOJIS } from "./types";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/* ------------------------------------------------------------------ 鉴权 */

export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  return request("/v1/auth/login", {
    method: "POST",
    auth: false,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function register(
  username: string,
  password: string
): Promise<{ token: string; user: User }> {
  return request("/v1/auth/register", {
    method: "POST",
    auth: false,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchMe(): Promise<User> {
  return request("/v1/me");
}

/* ------------------------------------------------------------------ 助手 */

export async function listAgents(): Promise<Agent[]> {
  const data = await request<{ agents?: Agent[] }>("/v1/agents");
  return data.agents ?? [];
}

export async function createAgent(body: AgentInput): Promise<Agent> {
  return request("/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateAgent(id: string, body: AgentInput): Promise<Agent> {
  return request(`/v1/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await request(`/v1/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ Skills */

export async function listSkills(): Promise<Skill[]> {
  const data = await request<{ skills?: Skill[] }>("/v1/skills");
  return data.skills ?? [];
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<Skill> {
  return request(`/v1/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function uploadSkill(body: {
  name: string;
  description: string;
  body_markdown: string;
}): Promise<Skill> {
  return request("/v1/skills/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteSkill(name: string): Promise<void> {
  await request(`/v1/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ 会话 */

/** Grok 式主会话：每个助手一条线程，取不到就建。 */
export async function openPrimaryConversation(agentId: string): Promise<Conversation> {
  const data = await request<{ conversation: Conversation }>(
    `/v1/agents/${encodeURIComponent(agentId)}/conversation`
  );
  return data.conversation;
}

export async function createConversation(agentId: string): Promise<Conversation> {
  return request("/v1/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId, title: "新对话" }),
  });
}

export async function listConversations(): Promise<Conversation[]> {
  const data = await request<{ conversations?: Conversation[] }>("/v1/conversations");
  return data.conversations ?? [];
}

export async function deleteConversation(id: string): Promise<void> {
  await request(`/v1/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listMessagesWithStatus(conversationId: string): Promise<ListMessagesResult> {
  const data = await request<{ messages?: Message[]; run_active?: boolean }>(
    `/v1/conversations/${conversationId}/messages`
  );
  return { messages: data.messages ?? [], run_active: Boolean(data.run_active) };
}

export async function getConversationRunStatus(
  conversationId: string
): Promise<{ active: boolean }> {
  const data = await request<{ active?: boolean }>(`/v1/conversations/${conversationId}/run`);
  return { active: Boolean(data.active) };
}

export async function cancelConversationRun(conversationId: string): Promise<void> {
  // 幂等：无活跃 run 时后端也返回 204，旧版本服务器可能 404
  try {
    await request(`/v1/conversations/${conversationId}/cancel`, { method: "POST" });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 204 || err.status === 404)) return;
    throw err;
  }
}

/* ------------------------------------------------------------------ LLM 连接 */

export async function listLLMConnections(): Promise<LLMConnection[]> {
  const data = await request<{ connections?: LLMConnection[] }>("/v1/llm-connections");
  return data.connections ?? [];
}

export async function createLLMConnection(body: LLMInput): Promise<LLMConnection> {
  return request("/v1/llm-connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateLLMConnection(
  id: string,
  body: Partial<LLMInput>
): Promise<LLMConnection> {
  return request(`/v1/llm-connections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteLLMConnection(id: string): Promise<void> {
  await request(`/v1/llm-connections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setDefaultLLMConnection(id: string): Promise<LLMConnection> {
  return request(`/v1/llm-connections/${encodeURIComponent(id)}/default`, { method: "POST" });
}

/* ------------------------------------------------------------------ 附件 */

/**
 * 上传会话附件。RN 侧传的是本地 `uri`（来自系统选择器），不是 `File`。
 * 20MB 上限与 MIME 白名单由后端兜底，前端只做提前拦截以省一次往返。
 */
export async function uploadConversationAttachment(
  conversationId: string,
  file: { uri: string; name: string; mime: string }
): Promise<AttachmentMeta> {
  const form = new FormData();
  form.append("file", filePart(file.uri, file.name, file.mime));
  return upload(`/v1/conversations/${conversationId}/attachments`, form);
}

/* ------------------------------------------------------------------ 发消息（SSE） */

export type SendMessageExtras = {
  attachments?: AttachmentMeta[];
  /** 群聊 @点名：指定本轮由哪些助手应答 */
  agentIds?: string[];
  /** 引用回复：被回复消息 id */
  replyToId?: string;
  /** 线程回复的根消息 id */
  threadRootId?: string;
  /** DM 内 @其他 Bot 的转交上下文 */
  handoffContext?: unknown;
};

/**
 * 发消息并流式接收。`signal` 用来中止（对应 Web 的 AbortSignal）。
 *
 * 走的是 `POST` + `text/event-stream`，不是原生 EventSource —— 原生 EventSource 不支持
 * 自定义 Authorization header，也不支持请求体。
 */
export async function sendMessageStream(
  conversationId: string,
  content: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  extras?: SendMessageExtras
): Promise<void> {
  const token = await getToken();
  const body: Record<string, unknown> = { content };
  if (extras?.attachments?.length) body.attachments = extras.attachments;
  if (extras?.agentIds?.length) body.agent_ids = extras.agentIds;
  if (extras?.replyToId) body.reply_to_id = extras.replyToId;
  if (extras?.threadRootId) body.thread_root_id = extras.threadRootId;
  if (extras?.handoffContext) body.handoff_context = extras.handoffContext;
  // 客户端环境信封：让助手知道「我的手机」而不是笼统的 web 客户端
  body.client = detectClientContext();

  const res = await expoFetch(`${API_BASE}/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `发送失败（HTTP ${res.status}）`);
  }
  await readSSEStream(res.body, handlers);
}

/** 刷新 / 重连后重新挂回服务端仍在跑的 run；中止信号不会取消服务端任务。 */
export async function subscribeConversationEvents(
  conversationId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const token = await getToken();
  const res = await expoFetch(`${API_BASE}/v1/conversations/${conversationId}/events`, {
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });

  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `订阅失败（HTTP ${res.status}）`);
  }
  await readSSEStream(res.body, handlers);
}

/* ------------------------------------------------------------------ 协作（频道 / 总线） */

export async function fetchCompactConfig(): Promise<CompactConfig | null> {
  try {
    const data = await request<{ compact?: CompactConfig }>("/v1/compact-config");
    return data.compact ?? null;
  } catch {
    // Web 端这里是「读不到就返回 null」的只读展示，失败不该炸设置页
    return null;
  }
}

export async function listChannels(): Promise<Channel[]> {
  const data = await request<{ channels?: Channel[] }>("/v1/channels");
  return data.channels ?? [];
}

export async function createChannel(name: string, memberIds?: string[]): Promise<Channel> {
  return request("/v1/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, member_ids: memberIds ?? [] }),
  });
}

export async function deleteChannel(id: string): Promise<void> {
  await request(`/v1/channels/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function openChannelConversation(channelId: string): Promise<{
  channel: Channel;
  conversation: Conversation;
}> {
  return request(`/v1/channels/${encodeURIComponent(channelId)}/conversation`);
}

export async function addChannelMember(channelId: string, agentId: string): Promise<Channel> {
  return request(`/v1/channels/${encodeURIComponent(channelId)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  });
}

export async function postAgentBusMessage(body: {
  from_agent_id?: string;
  to_agent_id?: string;
  channel_id?: string;
  priority?: boolean;
  body: string;
}): Promise<AgentBusMessage> {
  return request("/v1/agent-bus/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listAgentBusInbox(opts?: {
  unread?: boolean;
  agent_id?: string;
}): Promise<AgentBusMessage[]> {
  const q = new URLSearchParams();
  if (opts?.unread) q.set("unread", "1");
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  const qs = q.toString();
  const data = await request<{ messages?: AgentBusMessage[] }>(
    `/v1/agent-bus/inbox${qs ? `?${qs}` : ""}`
  );
  return data.messages ?? [];
}

/**
 * 总线 WS 地址。Web 用浏览器 WebSocket，RN 用全局 WebSocket —— 但**别**用
 * `expo/fetch`，它只提供 fetch 语义，拿不到 upgrade 握手。
 */
export async function agentBusWebSocketUrl(): Promise<string> {
  const t = (await getToken()) ?? "";
  const wsBase = toWebSocketBase(API_BASE);
  const q = t ? `?token=${encodeURIComponent(t)}` : "";
  return `${wsBase}/v1/agent-bus/ws${q}`;
}

export async function markAgentBusRead(id: string): Promise<void> {
  await request(`/v1/agent-bus/messages/${encodeURIComponent(id)}/read`, { method: "POST" });
}

/* ------------------------------------------------------------------ MCP */

export async function listMCPServers(): Promise<MCPServer[]> {
  const data = await request<{ servers?: MCPServer[] }>("/v1/mcp-servers");
  return data.servers ?? [];
}

export async function createMCPServer(body: MCPServerInput): Promise<MCPServer> {
  return request("/v1/mcp-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateMCPServer(
  id: string,
  body: Partial<MCPServerInput>
): Promise<MCPServer> {
  return request(`/v1/mcp-servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteMCPServer(id: string): Promise<void> {
  await request(`/v1/mcp-servers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function testMCPServer(id: string): Promise<{
  ok: boolean;
  tool_names?: string[];
  tools?: { name: string; description?: string }[];
  error?: string;
  count?: number;
}> {
  return request(`/v1/mcp-servers/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function mcpListTools(serverId?: string): Promise<{
  tools: MCPToolEntry[];
  count: number;
}> {
  return request("/v1/mcp/list-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(serverId ? { server_id: serverId } : {}),
  });
}

export async function mcpCallTool(body: {
  server_id: string;
  tool: string;
  arguments?: Record<string, unknown>;
}): Promise<{ ok?: boolean; text?: string; error?: string; content?: string[] }> {
  return request("/v1/mcp/call-tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ 例行任务 */

export async function listRoutines(): Promise<Routine[]> {
  const data = await request<{ routines?: Routine[] }>("/v1/routines");
  return data.routines ?? [];
}

export async function createRoutine(body: RoutineInput): Promise<Routine> {
  return request("/v1/routines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateRoutine(id: string, body: Partial<RoutineInput>): Promise<Routine> {
  return request(`/v1/routines/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteRoutine(id: string): Promise<void> {
  await request(`/v1/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function runRoutine(id: string): Promise<{ routine: Routine; run: RoutineRun }> {
  return request(`/v1/routines/${encodeURIComponent(id)}/run`, { method: "POST" });
}

/* ------------------------------------------------------------------ 沙箱 */

export async function getSandbox(ensure?: boolean): Promise<Sandbox> {
  return request(`/v1/sandbox${ensure ? "?ensure=1" : ""}`);
}

export async function ensureSandbox(opts?: {
  desktop?: boolean;
  agent_id?: string;
  mode?: string;
}): Promise<Sandbox> {
  return request("/v1/sandbox/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      desktop: Boolean(opts?.desktop),
      agent_id: opts?.agent_id || undefined,
      mode: opts?.mode || undefined,
    }),
  });
}

/** noVNC 反代地址（JWT 走 query）。RN 没有内置浏览器，调用方需自行处理跳转。 */
export async function sandboxDesktopURL(extra?: { desktop_token?: string }): Promise<string> {
  const token = (await getToken()) ?? "";
  const q = new URLSearchParams();
  if (token) q.set("access_token", token);
  if (extra?.desktop_token) q.set("desktop_token", extra.desktop_token);
  const qs = q.toString();
  return `${API_BASE}/v1/sandbox/desktop${qs ? `?${qs}` : ""}`;
}

export async function stopSandbox(): Promise<Sandbox> {
  return request("/v1/sandbox/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function resetSandbox(): Promise<{ sandbox: Sandbox; warning?: string }> {
  return request("/v1/sandbox/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function execSandbox(body: {
  cmd: string;
  workdir?: string;
  timeout_sec?: number;
}): Promise<SandboxExecResult> {
  return request("/v1/sandbox/exec", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function readSandboxFile(
  path: string,
  opts?: { agent_id?: string }
): Promise<{ path: string; content: string }> {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  return request(`/v1/sandbox/files?${q.toString()}`);
}

export async function writeSandboxFile(
  path: string,
  content: string
): Promise<{ ok: boolean; path: string }> {
  return request("/v1/sandbox/files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
}

export async function listSandbox(path = "/workspace"): Promise<{
  path: string;
  entries: SandboxDirEntry[];
}> {
  return request(`/v1/sandbox/ls?path=${encodeURIComponent(path)}`);
}

export async function checkpointSandbox(): Promise<{
  checkpoint_path: string;
  sandbox: Sandbox;
}> {
  return request("/v1/sandbox/checkpoint", { method: "POST" });
}

/* ------------------------------------------------------------------ 密钥 */

export async function listBotSecrets(agentId?: string): Promise<BotSecretMeta[]> {
  const q = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : "";
  const data = await request<{ secrets?: BotSecretMeta[] }>(`/v1/bot-secrets${q}`);
  return data.secrets || [];
}

export async function createBotSecret(body: {
  name: string;
  value: string;
  origin?: string;
  auth_type?: string;
  agent_id?: string;
}): Promise<BotSecretMeta> {
  return request("/v1/bot-secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteBotSecret(id: string): Promise<void> {
  await request(`/v1/bot-secrets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listBotSecretRequests(): Promise<BotSecretRequest[]> {
  const data = await request<{ requests?: BotSecretRequest[] }>("/v1/bot-secret-requests");
  return data.requests || [];
}

export async function resolveBotSecretRequest(
  id: string,
  body: BotSecretResolveInput
): Promise<unknown> {
  return request(`/v1/bot-secret-requests/${encodeURIComponent(id)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ 本机登记 */

export async function listMachines(): Promise<Machine[]> {
  const data = await request<{ machines?: Machine[] }>("/v1/machines");
  return data.machines || [];
}

export async function registerMachine(input: MachineInput): Promise<Machine> {
  const data = await request<{ machine: Machine }>("/v1/machines/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.machine;
}

export async function heartbeatMachine(id: string): Promise<Machine> {
  const data = await request<{ machine: Machine }>(
    `/v1/machines/${encodeURIComponent(id)}/heartbeat`,
    { method: "POST" }
  );
  return data.machine;
}

export async function deleteMachine(id: string): Promise<void> {
  await request(`/v1/machines/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ OIDC（Casdoor） */

/** 探测后端是否启用了 OIDC。未启用时登录页不显示第三方入口。 */
export async function fetchOIDCConfig(): Promise<OIDCConfig> {
  return request("/v1/auth/oidc/config", { auth: false });
}

/**
 * 取 Casdoor 授权地址。`redirect=0` 表示让前端自己接管跳转
 * （浏览器 Web 端走 `/auth/callback`，RN 走 `WebBrowser.openAuthSessionAsync`）。
 */
export async function startOIDCLogin(): Promise<{ authorize_url: string; state: string }> {
  return request("/v1/auth/oidc/start?redirect=0", { auth: false });
}

/** 用授权码换本地 JWT。 */
export async function exchangeOIDCCode(
  code: string,
  state: string
): Promise<{ token: string; user: User }> {
  return request("/v1/auth/oidc/exchange", {
    method: "POST",
    auth: false,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
}

/* ------------------------------------------------------------------ 助手：克隆 / 岗位 / 引导 */

export async function cloneAgent(
  id: string,
  body: CloneAgentInput = {}
): Promise<CloneAgentResult> {
  return request(`/v1/agents/${encodeURIComponent(id)}/clone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listAgentSkills(agentId: string): Promise<AgentSkill[]> {
  const data = await request<{ skills?: AgentSkill[] }>(
    `/v1/agents/${encodeURIComponent(agentId)}/skills`
  );
  return data.skills ?? [];
}

export async function setAgentSkill(
  agentId: string,
  name: string,
  enabled: boolean
): Promise<AgentSkill> {
  return request(`/v1/agents/${encodeURIComponent(agentId)}/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export async function replaceAgentSkills(
  agentId: string,
  enabled: string[]
): Promise<AgentSkill[]> {
  const data = await request<{ skills?: AgentSkill[] }>(
    `/v1/agents/${encodeURIComponent(agentId)}/skills`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  );
  return data.skills ?? [];
}

/**
 * 首次引导卡落库：把 A–E 预设（或用户自定义方向）写进 Bot 的岗位描述 / 人设 / 默认技能。
 * Web 端在发第一条消息**之前**先调这里，RN 早期版本漏了这一步，
 * 导致手机上选的引导方向根本没进 Bot 配置。
 */
export async function applyAgentOnboarding(
  agentId: string,
  body: { focus?: string; description?: string; system_prompt?: string; skills?: string[] | null }
): Promise<Agent> {
  const data = await request<{ agent?: Agent }>(
    `/v1/agents/${encodeURIComponent(agentId)}/onboarding`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return (data.agent ?? data) as Agent;
}

/* ------------------------------------------------------------------ 技能包 */

/**
 * 上传 zip 技能包。与 Web 端同一个 `/v1/skills/upload` 端点，
 * 区别只在 multipart 字段名：zip 走 `archive`，正文走 JSON。
 * RN 侧 file 传本地 uri（`filePart` 负责包成 `{uri,name,type}`）。
 */
export async function uploadSkillPackage(file: {
  uri: string;
  name: string;
  mime: string;
}): Promise<Skill> {
  const form = new FormData();
  form.append("archive", filePart(file.uri, file.name || "skill.zip", file.mime));
  return upload("/v1/skills/upload", form);
}

/** 导出技能包为 zip，返回可下载的 URL（鉴权头由调用方补）。 */
export async function exportSkillZipURL(name: string): Promise<string> {
  return `${API_BASE}/v1/skills/${encodeURIComponent(name)}/export`;
}

/* ------------------------------------------------------------------ LLM tools 探测 */

export async function probeLLMTools(body: {
  base_url?: string;
  api_key?: string;
  model?: string;
  connection_id?: string;
}): Promise<LLMToolsProbeResult> {
  return request("/v1/llm/probe-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  return [head, result.detail, result.hint].filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ 附件地址 */

export function isImageAttachmentMime(mime?: string | null): boolean {
  return Boolean(mime && /^image\//i.test(mime.trim()));
}

/** 相对路径补全成绝对 API 地址（不带任何凭据）。 */
export function absolutizeApiUrl(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (/^(https?:|file:|data:)/i.test(u)) return u;
  if (u.startsWith("/")) return `${API_BASE}${u}`;
  return `${API_BASE}/${u}`;
}

/**
 * 附件的 `<Image>` 可直接用的地址。附件 GET 需要鉴权，这里把 JWT 拼到 query
 * （与 Web 端一致），因为 RN 的 `Image` 没法注入请求头。
 */
export async function attachmentDisplayUrl(
  attOrUrl: { url?: string } | string | null | undefined
): Promise<string | null> {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl?.url;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^(file:|data:)/i.test(trimmed)) return trimmed;
  const abs = absolutizeApiUrl(trimmed);
  if (!abs) return null;
  if (/[?&](access_token|token)=/.test(abs)) return abs;
  const token = await getToken();
  if (!token) return abs;
  const sep = abs.includes("?") ? "&" : "?";
  return `${abs}${sep}access_token=${encodeURIComponent(token)}`;
}

/** 去掉凭据的地址，可安全展示 / 复制给用户。 */
export function attachmentCopyUrl(
  attOrUrl: { url?: string } | string | null | undefined
): string | null {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl?.url;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^(file:|data:)/i.test(trimmed)) return trimmed;
  return absolutizeApiUrl(trimmed.split(/[?#]/)[0] || trimmed);
}

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

/** `image-YYYYMMDD-HHmmss` + 原扩展名。 */
export function imageDownloadFilename(name?: string, mime?: string, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `image-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${stamp}.${extFromNameOrMime(name, mime)}`;
}

/** 产物文件下载地址（鉴权头由 `lib/download.ts` 补，不走 query）。 */
export function sandboxFileDownloadURL(path: string, opts?: { agent_id?: string }): string {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  return `${API_BASE}/v1/sandbox/files/download?${q.toString()}`;
}

/* ------------------------------------------------------------------ 表情回应 */

export async function toggleReaction(
  messageId: string,
  emoji: string
): Promise<ReactionUpdatedEvent> {
  return request(`/v1/messages/${encodeURIComponent(messageId)}/reactions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
}

export async function deleteReaction(
  messageId: string,
  emoji: string
): Promise<ReactionUpdatedEvent> {
  return request(
    `/v1/messages/${encodeURIComponent(messageId)}/reactions?emoji=${encodeURIComponent(emoji)}`,
    { method: "DELETE" }
  );
}

/* ------------------------------------------------------------------ 聊天全局 WS */

/** `/v1/events/ws`：在线绿点、presence、跨端消息、反应变更。与单会话 SSE 互补。 */
export async function chatEventsWebSocketUrl(): Promise<string> {
  const t = (await getToken()) ?? "";
  const wsBase = toWebSocketBase(API_BASE);
  const q = t ? `?token=${encodeURIComponent(t)}` : "";
  return `${wsBase}/v1/events/ws${q}`;
}

/* ------------------------------------------------------------------ 本机操作确认 */

export async function createHostConfirm(
  conversationId: string,
  body: HostConfirmPayload
): Promise<Message> {
  return request(`/v1/conversations/${conversationId}/host-confirms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function decideHostConfirm(
  conversationId: string,
  messageId: string,
  status: "allowed" | "denied"
): Promise<Message> {
  return request(
    `/v1/conversations/${conversationId}/host-confirms/${encodeURIComponent(messageId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }
  );
}

/* ------------------------------------------------------------------ 中断标记 */

export const STOP_MARKER_TEXT = "（已停止）";

export function isStopMarkerContent(content: string | undefined | null): boolean {
  return /^[（(]?\s*已停止\s*[）)]?$/u.test((content ?? "").trim());
}

/** 只落库不触发回复（DM 内 @其他 Bot 转交时，用来在原会话留痕）。 */
export async function persistConversationMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  const data = await request<{ message?: Message }>(
    `/v1/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, persist_only: true }),
    }
  );
  return (data.message ?? data) as Message;
}

/* ------------------------------------------------------------------ 入站 Hook */

export async function listInboundHooks(): Promise<InboundHook[]> {
  const data = await request<{ hooks?: InboundHook[] }>("/v1/inbound-hooks");
  return data.hooks ?? [];
}

export async function createInboundHook(body: {
  provider: string;
  label?: string;
  secret?: string;
}): Promise<InboundHook> {
  return request("/v1/inbound-hooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteInboundHook(id: string): Promise<void> {
  await request(`/v1/inbound-hooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ------------------------------------------------------------------ 本机管理（补齐） */

export async function updateMachine(
  id: string,
  body: { label?: string; exec_policy?: "allow" | "ask" | "deny" | string }
): Promise<Machine> {
  const data = await request<{ machine?: Machine }>(`/v1/machines/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (data.machine ?? data) as Machine;
}

export async function updateMachineLabel(id: string, label: string): Promise<Machine> {
  return updateMachine(id, { label });
}

/* ------------------------------------------------------------------ 用户设置（审核与时区） */

export async function fetchUserSettings(): Promise<UserSettings> {
  return request("/v1/me/settings");
}

export async function updateUserSettings(body: {
  timezone?: string;
  auto_review_enabled?: boolean;
  auto_review_rules?: AutoReviewRule[];
}): Promise<UserSettings> {
  return request("/v1/me/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ 消息反馈与训练 */

export async function createMessageFeedback(body: CreateFeedbackInput): Promise<MessageFeedback> {
  return request("/v1/message-feedbacks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function listAgentFeedbacks(agentId: string): Promise<MessageFeedback[]> {
  const data = await request<{ feedbacks?: MessageFeedback[] }>(
    `/v1/agents/${encodeURIComponent(agentId)}/feedbacks`
  );
  return data.feedbacks ?? [];
}

export async function listAgentLessons(
  agentId: string,
  status?: LessonStatus | string
): Promise<BotLesson[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await request<{ lessons?: BotLesson[] }>(
    `/v1/agents/${encodeURIComponent(agentId)}/lessons${q}`
  );
  return data.lessons ?? [];
}

export async function listActiveAgentLessons(agentId: string): Promise<BotLesson[]> {
  const data = await request<{ lessons?: BotLesson[] }>(
    `/v1/agents/${encodeURIComponent(agentId)}/lessons/active`
  );
  return data.lessons ?? [];
}

export async function updateLesson(id: string, body: LessonPatch): Promise<BotLesson> {
  return request(`/v1/lessons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteLesson(id: string): Promise<void> {
  await request(`/v1/lessons/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type {
  AgentPatch,
  AgentSkill,
  AutoReviewRule,
  BotLesson,
  BotPresenceEvent,
  CloneAgentInput,
  CloneAgentResult,
  CreateFeedbackInput,
  HostConfirmPayload,
  InboundHook,
  LLMToolsProbeResult,
  LessonPatch,
  LessonStatus,
  MessageFeedback,
  OIDCConfig,
  ReactionUpdatedEvent,
  UserSettings,
};

export type { StatusEvent };
