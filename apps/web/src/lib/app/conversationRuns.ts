import type { Agent, Message } from "../../api";
import { isStopMarkerContent, normalizeMessageSources } from "../../api";
import type { ConvRunState, UiMessage } from "../../types/app-ui";
import type { MutableRefObject } from "react";
import type { MessagesByConv, PatchConvMessages } from "./conversationMessages";
import { isGroupPassContent } from "./groupPass";

export type RunsRef = MutableRefObject<Map<string, ConvRunState>>;

export type RunMessageOpsContext = {
  runsRef: RunsRef;
  messagesByConvRef: MutableRefObject<MessagesByConv>;
  patchConvMessages: PatchConvMessages;
};

export function mapApiMessages(msgs: Message[], nameLookup: Map<string, string> | Agent[]) {
  const nameOf = (agentId: string) => {
    if (Array.isArray(nameLookup)) {
      return nameLookup.find((a) => a.id === agentId)?.name || agentId;
    }
    return nameLookup.get(agentId) || agentId;
  };
  return msgs
    .filter((m) => m.role !== "summary")
    // Drop any silence tokens that leaked into storage (journal race / old rows).
    .filter((m) => !(m.role === "assistant" && isGroupPassContent(m.content || "")))
    // Legacy 「（已停止）」 rows: never show (Stop and supersede both omit the marker).
    .filter((m) => !(m.role === "assistant" && isStopMarkerContent(m.content)))
    .map((m) => ({
      ...m,
      agent_name: m.agent_id ? nameOf(m.agent_id) : undefined,
    }));
}

export function attachSourcesToStreaming(
  ctx: RunMessageOpsContext,
  convId: string,
  raw: unknown,
  messageId?: string,
) {
  const sources = normalizeMessageSources(raw);
  if (!sources.length) return;
  const run = ctx.runsRef.current.get(convId);
  const targetId = (messageId || "").trim() || run?.assistantId || "";
  ctx.patchConvMessages(convId, (prev) => {
    // Prefer explicit message id, then current streaming assistant, then last assistant.
    let idx = targetId ? prev.findIndex((m) => m.id === targetId) : -1;
    if (idx < 0 && run?.assistantId) {
      idx = prev.findIndex((m) => m.id === run.assistantId);
    }
    if (idx < 0) {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) return prev;
    const cur = prev[idx];
    const merged = normalizeMessageSources([...(cur.sources || []), ...sources]);
    if (merged.length === (cur.sources || []).length) {
      // Same set — skip churn
      const same =
        merged.length === (cur.sources || []).length &&
        merged.every((s, i) => s.url === (cur.sources || [])[i]?.url);
      if (same) return prev;
    }
    return prev.map((m, i) => (i === idx ? { ...m, sources: merged } : m));
  });
}

export function stampSavedMessage(
  ctx: RunMessageOpsContext,
  convId: string,
  messageId: string,
  requestId?: string,
  agentId?: string,
) {
  if (!messageId) return;
  const run = ctx.runsRef.current.get(convId);
  const aid = (agentId || "").trim();
  const rid = (requestId || "").trim();
  // Parallel group: resolve the local bubble for THIS agent_id only.
  // Never fall back to run.assistantId when aid is known but unmapped — that stamped
  // another bot's streaming row and swapped AgentAvatar / robot-heads.
  const resolveLocalId = (prev: UiMessage[]): string | null => {
    if (aid && run?.assistantIdsByAgent?.[aid]) return run.assistantIdsByAgent[aid];
    if (aid) {
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m.role !== "assistant") continue;
        const local = Boolean(m.streaming) || m.id.startsWith("local-");
        if (!local) continue;
        if ((m.agent_id || "").trim() === aid) return m.id;
      }
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m.role !== "assistant") continue;
        if (!(m.streaming || m.id.startsWith("local-"))) continue;
        if ((m.agent_id || "").trim()) continue;
        if ((m.content || "").trim()) continue;
        return m.id;
      }
      return null;
    }
    return run?.assistantId || null;
  };
  let stampedLocalId: string | null = null;
  ctx.patchConvMessages(convId, (prev) => {
    const localId = resolveLocalId(prev);
    stampedLocalId = localId;
    const existing = prev.find((m) => m.id === messageId);
    if (existing) {
      const local = localId && localId !== messageId ? prev.find((m) => m.id === localId) : undefined;
      if (local && local.role === "assistant" && existing.role === "assistant") {
        // The saved row already arrived via WS / pullOpen as its own bubble (empty
        // placeholders never fuzzy-absorb). Fold: this agent's placeholder takes the
        // server id, drop the duplicate.
        return prev
          .filter((m) => m.id !== messageId)
          .map((m) =>
            m.id === localId
              ? {
                  ...existing,
                  ...m,
                  id: messageId,
                  content: m.content || existing.content,
                  ...(aid || existing.agent_id || m.agent_id
                    ? { agent_id: aid || existing.agent_id || m.agent_id }
                    : {}),
                  ...(rid || existing.request_id ? { request_id: rid || existing.request_id } : {}),
                }
              : m,
          );
      }
      if (!rid && !aid) return prev;
      return prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              ...(rid && !m.request_id ? { request_id: rid } : {}),
              // Prefer explicit aid so avatar attribution cannot stick to a prior bot.
              ...(aid ? { agent_id: aid } : {}),
            }
          : m,
      );
    }
    if (!localId) return prev;
    return prev.map((m) =>
      m.id === localId
        ? {
            ...m,
            id: messageId,
            ...(rid ? { request_id: rid } : {}),
            ...(aid ? { agent_id: aid } : {}),
          }
        : m,
    );
  });
  const localId = stampedLocalId;
  if (run && localId) {
    if (run.assistantId === localId) run.assistantId = messageId;
    if (aid) {
      if (!run.assistantIdsByAgent) run.assistantIdsByAgent = {};
      if (run.assistantIdsByAgent[aid] === localId || !run.assistantIdsByAgent[aid]) {
        run.assistantIdsByAgent[aid] = messageId;
      }
    }
  }
}
