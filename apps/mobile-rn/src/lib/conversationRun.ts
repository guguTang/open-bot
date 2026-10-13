/**
 * Conversation Run — 一次助手执行的流式状态机与消息映射。
 *
 * 屏幕只负责 UI / picker；流式合并、乐观气泡形状、引导卡「先 apply 再 send」
 * 的顺序约束集中在这里，避免 send 与 subscribe 各写一份 onToken/onAgentStart。
 */

import type { Agent, Message, StatusEvent, StreamHandlers, StreamTokenInfo } from "@/api/types";
import type { UiMessage } from "@/components/MessageBubble";
import { deriveRunLabel } from "@/components/RunStatus";

export const STREAMING_ID_PREFIX = "__streaming__:";

/** Parallel group: one streaming slot per agent_id ("_" = unknown until agent_start). */
export type StreamPart = { text: string; agentName?: string };
export type StreamingByAgent = Record<string, StreamPart>;

/** 服务端消息 → 气泡形状（首屏 / 重取 / WS 补拉共用）。 */
export function toUiMessage(m: Message): UiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(m.agent_id ? { agent_id: m.agent_id } : {}),
    ...(m.reactions?.length ? { reactions: m.reactions } : {}),
    ...(m.request_id ? { request_id: m.request_id } : {}),
    ...(m.reply_to_id ? { reply_to_id: m.reply_to_id } : {}),
    ...(m.thread_root_id ? { thread_root_id: m.thread_root_id } : {}),
    ...(m.sources?.length ? { sources: m.sources } : {}),
    ...(m.handoff ? { handoff: m.handoff } : {}),
    ...(m.host_confirm ? { host_confirm: m.host_confirm } : {}),
  };
}

export function avatarPropsForMessage(
  m: UiMessage,
  agents: Agent[],
  primaryAgent: Agent | null
): {
  avatarShape?: string;
  avatarColor?: string;
  fallbackAgentName?: string;
} {
  const aid = m.agent_id || primaryAgent?.id;
  const a = aid ? agents.find((x) => x.id === aid) : undefined;
  return {
    ...(a?.avatar_shape ? { avatarShape: a.avatar_shape } : {}),
    ...(a?.avatar_color ? { avatarColor: a.avatar_color } : {}),
    ...(m.agent_id && !m.agent_name && a?.name ? { fallbackAgentName: a.name } : {}),
  };
}

/** Pure: agent_start → merge stream slot. */
export function applyAgentStart(
  prev: StreamingByAgent | null,
  info: { agent_id: string; agent_name?: string }
): StreamingByAgent {
  return {
    ...(prev || {}),
    [info.agent_id]: {
      text: prev?.[info.agent_id]?.text ?? "",
      agentName: info.agent_name ?? prev?.[info.agent_id]?.agentName,
    },
  };
}

/** Pure: token → append to the right agent slot. */
export function applyStreamToken(
  prev: StreamingByAgent | null,
  text: string,
  info?: StreamTokenInfo
): StreamingByAgent {
  const base = prev || {};
  let key = (info?.agent_id || "").trim();
  if (!key) {
    const keys = Object.keys(base);
    key = keys.length === 1 ? keys[0]! : "_";
  }
  const cur = base[key] || { text: "" };
  return { ...base, [key]: { ...cur, text: cur.text + text } };
}

/** Pure: message_saved seals one agent's stream so avatar cannot stick. */
export function sealStreamAgent(
  prev: StreamingByAgent | null,
  agentId: string
): StreamingByAgent | null {
  if (!prev || !(agentId in prev)) return prev;
  const next = { ...prev };
  delete next[agentId];
  return Object.keys(next).length ? next : null;
}

export type StreamUiSink = {
  setStreamingByAgent: (
    update: StreamingByAgent | null | ((prev: StreamingByAgent | null) => StreamingByAgent | null)
  ) => void;
  setRunLabel: (update: string | ((cur: string) => string)) => void;
  setRunActiveTool: (tool: string | null) => void;
  setError: (message: string) => void;
  setSending?: (v: boolean) => void;
  onDone?: () => void;
  /** When true, include onMeta seal + cancelled label (send path). */
  withSendMeta?: boolean;
};

/** One place for SSE handlers used by both send and resubscribe. */
export function buildStreamHandlers(sink: StreamUiSink): StreamHandlers {
  const handlers: StreamHandlers = {
    onAgentStart: (info) => sink.setStreamingByAgent((prev) => applyAgentStart(prev, info)),
    onToken: (t, info) => sink.setStreamingByAgent((prev) => applyStreamToken(prev, t, info)),
    onStatus: (data: StatusEvent) => {
      if (typeof data.tool === "string" && data.tool) sink.setRunActiveTool(data.tool);
      sink.setRunLabel((cur) => deriveRunLabel(data, cur || "正在思考…"));
    },
    onError: (m) => sink.setError(m),
    onDone: () => {
      sink.setStreamingByAgent(null);
      sink.setSending?.(false);
      sink.setRunLabel("");
      sink.setRunActiveTool(null);
      sink.onDone?.();
    },
  };

  if (sink.withSendMeta) {
    handlers.onMeta = (meta) => {
      if (meta.phase === "cancelled") sink.setRunLabel("已停止");
      if (meta.phase === "message_saved" && typeof meta.agent_id === "string" && meta.agent_id) {
        const aid = meta.agent_id;
        sink.setStreamingByAgent((prev) => sealStreamAgent(prev, aid));
      }
    };
  }

  return handlers;
}

/** Merge server + pending + streaming slots into the visible timeline. */
export function mergeVisibleMessages(
  messages: UiMessage[],
  streamingByAgent: StreamingByAgent | null,
  threadRootId: string | null
): UiMessage[] {
  const mainline = messages.filter((m) => {
    if (threadRootId) return true;
    return !m.thread_root_id;
  });
  const base = threadRootId
    ? messages.filter((m) => m.id === threadRootId || m.thread_root_id === threadRootId)
    : mainline;
  if (!streamingByAgent) return base;
  const entries = Object.entries(streamingByAgent);
  if (entries.length === 0 || entries.every(([, p]) => !p.text)) {
    return base;
  }
  const extras: UiMessage[] = entries
    .filter(([, p]) => Boolean(p.text))
    .map(([agentKey, p]) => ({
      id: `${STREAMING_ID_PREFIX}${agentKey}`,
      role: "assistant",
      content: p.text,
      streaming: true,
      ...(agentKey !== "_" ? { agent_id: agentKey } : {}),
      ...(p.agentName ? { agent_name: p.agentName } : {}),
    }));
  return [...base, ...extras];
}
