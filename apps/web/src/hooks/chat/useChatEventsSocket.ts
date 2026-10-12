import { useEffect } from "react";
import {
  chatEventsWebSocketUrl,
  listMessagesWithStatus,
  mergeIncomingMessage,
  type Message,
  type ReactionUpdatedEvent,
  type BotOnlineEvent,
  type BotPresenceEvent,
  type BotPresenceStatus,
} from "../../api";
import { normalizePresenceStatus } from "../../components/avatarColor";
import type { Conversation } from "../../api";
import type { PatchConvMessages } from "../../lib/app/conversationMessages";
import { setApprovalGate } from "../../stores/chat";
import { usePresenceStore } from "../../stores/presence";

export function useChatEventsSocket(deps: {
  token: string | null;
  conversationRef: React.RefObject<Conversation | null>;
  conversationId: string | undefined;
  taskConvIds: Set<string>;
  patchConvMessages: PatchConvMessages;
  noteTask: (convId: string, active: boolean, label?: string) => void;
  applyRemoteHostDecisionRef: React.RefObject<(msg: Message) => void>;
  acceptServerMessage: (msg: Message) => void;
  applyReactionEvent: (evt: ReactionUpdatedEvent) => void;
  applyBotOnline: (id: string, on: boolean) => void;
  refreshAgents: () => Promise<unknown>;
  lastRequestIdRef: React.RefObject<string>;
  setHostActivity: (label: string) => void;
}) {
  useEffect(() => {
    if (!deps.token) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    const pullOpen = () => {
      const id = deps.conversationRef.current?.id;
      if (!id) return;
      void listMessagesWithStatus(id)
        .then((listed) => {
          if (deps.conversationRef.current?.id !== id) return;
          deps.patchConvMessages(id, (prev) => {
            let next = prev;
            for (const m of listed.messages) {
              if (m.role === "summary") continue;
              deps.applyRemoteHostDecisionRef.current(m);
              next = mergeIncomingMessage(next, m);
            }
            return next;
          });
          deps.noteTask(id, Boolean(listed.task_active));
        })
        .catch(() => {});
    };
    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(chatEventsWebSocketUrl(deps.token!));
      socket = ws;
      ws.onopen = () => {
        void deps.refreshAgents().catch(() => {});
        pullOpen();
      };
      ws.onmessage = (ev) => {
        let data: {
          type?: string;
          message?: Message;
          conversation_id?: string;
          status?: string;
          label?: string;
        };
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (data.type === "conversation_message" && data.message) {
          deps.acceptServerMessage(data.message);
          void deps.refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "task_status" && data.conversation_id) {
          const active = data.status === "running" || data.status === "queued";
          deps.noteTask(data.conversation_id, active, data.label);
          void deps.refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "host_activity") {
          const row = data as { active?: boolean; label?: string };
          deps.setHostActivity(row.active && row.label ? row.label : "");
        }
        if (data.type === "bot_online") {
          const evt = data as unknown as BotOnlineEvent;
          if (evt.agent_id) {
            deps.applyBotOnline(evt.agent_id, evt.online === true);
          }
          return;
        }
        if (data.type === "bot_presence") {
          const evt = data as unknown as BotPresenceEvent;
          if (evt.agent_id) {
            // Five-state whitelist; empty → idle, unknown → working (v2.1 product rule).
            const st: BotPresenceStatus = normalizePresenceStatus(evt.status);
            usePresenceStore.getState().setPresence(evt.agent_id, st);
            if (st === "awaiting_approval") {
              const rid = deps.lastRequestIdRef.current;
              const cid = deps.conversationRef.current?.id;
              if (rid && cid) {
                setApprovalGate({ conversationId: cid, requestId: rid });
              }
            } else if (st === "idle" || st === "thinking" || st === "working") {
              setApprovalGate((prev) =>
                prev && deps.conversationRef.current?.id === prev.conversationId ? null : prev,
              );
            }
          }
          return;
        }
        if (data.type === "reaction_updated") {
          const evt = data as ReactionUpdatedEvent;
          if (evt.message_id && evt.emoji) {
            deps.applyReactionEvent(evt);
          }
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void deps.refreshAgents().catch(() => {});
        pullOpen();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, [deps.token, deps.refreshAgents]);

  useEffect(() => {
    const id = deps.conversationId;
    if (!deps.token || !id || !deps.taskConvIds.has(id)) return;
    const timer = window.setInterval(() => {
      void listMessagesWithStatus(id)
        .then((listed) => {
          if (deps.conversationRef.current?.id !== id) return;
          deps.patchConvMessages(id, (prev) => {
            let next = prev;
            for (const m of listed.messages) {
              if (m.role === "summary") continue;
              deps.applyRemoteHostDecisionRef.current(m);
              next = mergeIncomingMessage(next, m);
            }
            return next;
          });
          deps.noteTask(id, Boolean(listed.task_active));
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [deps.token, deps.conversationId, deps.taskConvIds]);
}
