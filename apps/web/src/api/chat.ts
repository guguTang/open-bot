import { API_BASE, authHeaders, getToken, readError } from "./client";
import type { BotOnlineEvent } from "./agents";

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

/** Clickable citation from retrieval tools (http_fetch, MCP search, etc.). */
export type MessageSource = {
  url: string;
  title?: string;
};

/** Keep only real http(s) URLs; dedupe by lowercase URL without trailing slash. */
export function normalizeMessageSources(raw: unknown): MessageSource[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MessageSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = String((item as MessageSource).url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const title = String((item as MessageSource).title || "").trim().slice(0, 200);
    out.push(title ? { url, title } : { url });
    if (out.length >= 20) break;
  }
  return out;
}

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
  /** Citation links when this reply used retrieval; omitted when none. */
  sources?: MessageSource[];
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

export async function cancelConversationRun(
  conversationId: string,
  opts?: { requestId?: string },
): Promise<void> {
  const rid = (opts?.requestId || "").trim();
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/cancel`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      ...(rid ? { "Content-Type": "application/json" } : {}),
    },
    ...(rid ? { body: JSON.stringify({ request_id: rid }) } : {}),
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

/** HITL 审批三态 — shared by /approve and host-confirms. */
export type ApprovalDecision = "allow_once" | "always_allow" | "deny";

export type ApproveScope = {
  tool?: string;
  tool_group?: string;
};

export type ToolAllowlistEntry = {
  id?: string;
  tool?: string;
  tool_group: string;
  label?: string;
  granted_at?: string;
};

function approveBoolFromDecision(decision: ApprovalDecision): boolean {
  return decision !== "deny";
}

/**
 * POST /v1/conversations/{id}/approve — resume tool approval interrupt (三态).
 * Sends both `decision` (new) and `approve` bool (legacy servers).
 */
export async function approveConversation(
  conversationId: string,
  body: {
    request_id: string;
    decision: ApprovalDecision;
    approve?: boolean;
    reason?: string;
    scope?: ApproveScope;
  },
): Promise<unknown> {
  const decision = body.decision;
  const approve = body.approve ?? approveBoolFromDecision(decision);
  const payload: Record<string, unknown> = {
    request_id: body.request_id,
    decision,
    approve,
    reason: body.reason || "",
  };
  if (body.scope) payload.scope = body.scope;
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/approve`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return null;
}

/** Resume a waiting_approval interrupt (legacy signature + optional decision/scope). */
export async function approveConversationRun(
  conversationId: string,
  requestId: string,
  approve: boolean,
  reason = "",
  opts?: { decision?: ApprovalDecision; scope?: ApproveScope },
): Promise<Record<string, unknown>> {
  const decision: ApprovalDecision =
    opts?.decision ?? (approve ? "allow_once" : "deny");
  const result = await approveConversation(conversationId, {
    request_id: requestId,
    decision,
    approve,
    reason,
    scope: opts?.scope,
  });
  return (result ?? {}) as Record<string, unknown>;
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
  client?: import("../lib/clientEnv").ClientContext,
  handoffContext?: HandoffContextMsg[],
  replyToId?: string,
  /** Sidebar thread post only (thread panel open). Mainline 「回复」 must omit this. */
  threadRootId?: string,
  /** follow_up | steer | reject | replace — replace = interrupt supersede. */
  whenBusy?: string,
  /** Job card (or a custom answer on it). This turn stays with the current bot. */
  onboarding?: boolean,
  /** Phase 6: micro-app dual-gate context for model-side host_* tools. */
  microAppId?: string,
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
  if (whenBusy) {
    body.when_busy = whenBusy;
  }
  if (onboarding) {
    body.onboarding = true;
  }
  if (microAppId && microAppId.trim()) {
    body.micro_app_id = microAppId.trim();
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

/**
 * Remove a member from a channel.
 * DELETE /v1/channels/{id}/members/{agentId}
 * 404 channel/member missing; 400 群里至少保留一位成员 / 不能移除主助理;
 * success returns updated Channel (same shape as add).
 */
export async function removeChannelMember(channelId: string, agentId: string): Promise<Channel> {
  const res = await fetch(
    `${API_BASE}/v1/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(agentId)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  // 204 / empty body → stub without members so UI can patch locally then refresh.
  if (res.status === 204) {
    return { id: channelId, user_id: "", name: "", created_at: "" };
  }
  const text = await res.text();
  if (!text.trim()) {
    return { id: channelId, user_id: "", name: "", created_at: "" };
  }
  return JSON.parse(text) as Channel;
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

/**
 * Decide a host_confirm card. Sends `status` (legacy) plus `decision` / `approve`
 * so backends that grow 三态 on host-confirms need no second client change.
 */
export async function decideHostConfirm(
  conversationId: string,
  messageId: string,
  status: "allowed" | "denied",
  opts?: { decision?: ApprovalDecision; scope?: ApproveScope; reason?: string },
): Promise<Message> {
  const decision: ApprovalDecision =
    opts?.decision ?? (status === "allowed" ? "allow_once" : "deny");
  const payload: Record<string, unknown> = {
    status,
    decision,
    approve: approveBoolFromDecision(decision),
  };
  if (opts?.scope) payload.scope = opts.scope;
  if (opts?.reason) payload.reason = opts.reason;
  const res = await fetch(`${API_BASE}/v1/conversations/${conversationId}/host-confirms/${messageId}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as Message;
}

const TOOL_ALLOWLIST_GET_CANDIDATES = [
  "/v1/me/tool-allowlist",
  "/v1/settings/tool-allowlist",
  "/v1/user/tool-allowlist",
];

/**
 * List Always-allow entries. Tries known paths; returns [] if none exist yet
 * (backend may still be shipping). Callers may merge an optimistic local cache.
 */
export async function listToolAllowlist(): Promise<ToolAllowlistEntry[]> {
  for (const path of TOOL_ALLOWLIST_GET_CANDIDATES) {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
      if (res.status === 404) continue;
      if (!res.ok) continue;
      const data = (await res.json()) as
        | ToolAllowlistEntry[]
        | { items?: ToolAllowlistEntry[]; entries?: ToolAllowlistEntry[] };
      const items = Array.isArray(data)
        ? data
        : Array.isArray(data.items)
          ? data.items
          : Array.isArray(data.entries)
            ? data.entries
            : [];
      return items.filter((e) => e && typeof (e.tool_group || e.tool) === "string");
    } catch {
      /* try next */
    }
  }
  return [];
}

/**
 * Revoke one Always-allow entry. Tries DELETE by id, then by tool_group query/body.
 * Returns true if a server accepted the revoke; false if no endpoint yet.
 */
export async function revokeToolAllowlistEntry(entry: {
  id?: string;
  tool_group: string;
}): Promise<boolean> {
  const group = encodeURIComponent(entry.tool_group);
  const attempts: Array<() => Promise<Response>> = [];
  if (entry.id) {
    const id = encodeURIComponent(entry.id);
    for (const base of ["/v1/me/tool-allowlist", "/v1/settings/tool-allowlist", "/v1/user/tool-allowlist"]) {
      attempts.push(() =>
        fetch(`${API_BASE}${base}/${id}`, { method: "DELETE", headers: authHeaders() }),
      );
    }
  }
  for (const base of ["/v1/me/tool-allowlist", "/v1/settings/tool-allowlist", "/v1/user/tool-allowlist"]) {
    attempts.push(() =>
      fetch(`${API_BASE}${base}?tool_group=${group}`, { method: "DELETE", headers: authHeaders() }),
    );
    attempts.push(() =>
      fetch(`${API_BASE}${base}`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ tool_group: entry.tool_group }),
      }),
    );
  }
  for (const run of attempts) {
    try {
      const res = await run();
      if (res.status === 404) continue;
      if (res.ok || res.status === 204) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Legacy stop-marker text; no longer persisted or stamped. Kept for history filtering. */
export const STOP_MARKER_TEXT = "（已停止）";
export function isStopMarkerContent(content: string | undefined | null): boolean {
  const t = (content ?? "").trim();
  return /^[（(]?\s*已停止\s*[）)]?$/u.test(t);
}

type MergeableMessage = Message & { streaming?: boolean; stopped?: boolean };

/**
 * Fold a server message into the local list.
 * - Same id updates in place.
 * - Legacy server stop markers (「已停止」) are dropped (never shown).
 * - Otherwise a local bubble with the same / prefix text takes the server id.
 * - Empty *streaming* assistant placeholders never fuzzy-match incoming messages: they belong to
 *   the run that is streaming into them, and only that run's `message_saved` (stampSavedMessage)
 *   gives them a server id.
 * - New rows insert before trailing streaming assistants and by created_at among sealed rows so
 *   mid-turn projected acks/stage updates stay before the final reply (not appended after it).
 */
export function mergeIncomingMessage<T extends MergeableMessage>(
  prev: T[],
  msg: Message,
): T[] {
  if (!msg?.id) return prev;
  if (prev.some((m) => m.id === msg.id)) {
    return prev.map((m) => {
      if (m.id !== msg.id) return m;
      // Prefer server fields, but never wipe a known agent_id with an empty incoming one
      // (WS/SSE merge must keep avatar attribution stable in parallel group turns).
      const merged = { ...m, ...msg, streaming: false } as T;
      const keep = (m.agent_id || "").trim();
      const next = (msg.agent_id || "").trim();
      if (keep && !next) merged.agent_id = keep;
      return merged;
    });
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
  // Legacy 「（已停止）」 rows: drop rather than adopt or insert.
  if (msg.role === "assistant" && isStopMarkerContent(msg.content)) {
    return prev;
  }
  // Parallel group: prefer the in-flight bubble for the same agent_id (WS projection
  // must not sit beside the streaming tokens as a duplicate).
  const incomingAgent = (msg.agent_id || "").trim();
  if (msg.role === "assistant" && incomingAgent) {
    for (let i = prev.length - 1; i >= 0; i--) {
      const m = prev[i];
      if (m.role !== "assistant") continue;
      const local = Boolean(m.streaming) || m.id.startsWith("local-");
      if (!local) continue;
      if ((m.agent_id || "").trim() === incomingAgent) {
        return adopt(i);
      }
    }
  }
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m.role !== msg.role) continue;
    // Rule: an empty streaming placeholder is never a fuzzy-match target; look past it.
    if (m.streaming && m.role === "assistant" && !(m.content ?? "").trim()) continue;
    const local = Boolean(m.streaming) || m.id.startsWith("local-");
    if (!local) break;
    const localAgent = (m.agent_id || "").trim();
    // Never fuzzy-adopt across different agent_ids (wrong avatar / robot-heads swap).
    if (incomingAgent && localAgent && localAgent !== incomingAgent) continue;
    if (incomingAgent && localAgent && localAgent === incomingAgent) {
      // Same agent: adopt even if content diverged slightly (projection vs tokens).
      return adopt(i);
    }
    const same =
      m.content === msg.content ||
      (m.content === "" && !m.streaming) ||
      (m.content !== "" && msg.content.startsWith(m.content));
    if (!same) {
      // Untagged or other in-flight bubble — keep scanning when agent-aware.
      if (incomingAgent && !localAgent) continue;
      break;
    }
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
