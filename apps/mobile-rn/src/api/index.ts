import { detectClientContext } from "./client";
import { API_BASE } from "./config";
import { ApiError, expoFetch, filePart, request, toWebSocketBase, upload } from "./http";
import { readSSEStream } from "./sse";
import { getToken } from "./session";
import type {
  Agent,
  AgentBusMessage,
  AgentInput,
  AttachmentMeta,
  BotSecretMeta,
  BotSecretRequest,
  BotSecretResolveInput,
  Channel,
  CompactConfig,
  Conversation,
  LLMConnection,
  LLMInput,
  ListMessagesResult,
  Machine,
  MachineInput,
  MCPServer,
  MCPServerInput,
  MCPToolEntry,
  Message,
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
} from "./types";

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

export type { StatusEvent };
