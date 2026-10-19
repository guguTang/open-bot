import { useEffect, useLayoutEffect, useRef } from "react";
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
import { refreshMicroAppsFromWS } from "../../stores/microApps";

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
  refreshChannels: () => Promise<unknown>;
  lastRequestIdRef: React.RefObject<string>;
  setHostActivity: (label: string) => void;
}) {
  const depsRef = useRef(deps);
  useLayoutEffect(() => {
    depsRef.current = deps;
  });

  // WebSocket is created inside connect() for reconnect; cleanup always calls closeSocket().
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- reconnect allocates WS inside nested connect(); effect cleanup owns closeSocket()
  useEffect(() => {
    const d = depsRef.current;
    if (!d.token) {
      return undefined;
    }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    const pullOpen = () => {
      const live = depsRef.current;
      const id = live.conversationRef.current?.id;
      if (!id) return;
      void listMessagesWithStatus(id)
        .then((listed) => {
          const cur = depsRef.current;
          if (cur.conversationRef.current?.id !== id) return;
          cur.patchConvMessages(id, (prev) => {
            let next = prev;
            for (const m of listed.messages) {
              if (m.role === "summary") continue;
              cur.applyRemoteHostDecisionRef.current(m);
              next = mergeIncomingMessage(next, m);
            }
            return next;
          });
          cur.noteTask(id, Boolean(listed.task_active));
        })
        .catch(() => {});
    };
    const closeSocket = () => {
      if (!socket) return;
      const ws = socket;
      socket = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    };
    const connect = () => {
      if (stopped) return;
      closeSocket();
      const ws = new WebSocket(chatEventsWebSocketUrl(d.token!));
      socket = ws;
      ws.onopen = () => {
        const live = depsRef.current;
        void live.refreshAgents().catch(() => {});
        void live.refreshChannels().catch(() => {});
        refreshMicroAppsFromWS();
        pullOpen();
      };
      ws.onmessage = (ev) => {
        const live = depsRef.current;
        let data: {
          type?: string;
          message?: Message;
          message_id?: string;
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
          live.acceptServerMessage(data.message);
          void live.refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "message_deleted" && data.message_id && data.conversation_id) {
          const messageId = data.message_id;
          live.patchConvMessages(data.conversation_id, (prev) => prev.filter((m) => m.id !== messageId));
          return;
        }
        if (data.type === "task_status" && data.conversation_id) {
          const active = data.status === "running" || data.status === "queued";
          live.noteTask(data.conversation_id, active, data.label);
          void live.refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "host_activity") {
          const row = data as { active?: boolean; label?: string };
          live.setHostActivity(row.active && row.label ? row.label : "");
        }
        if (data.type === "bot_online") {
          const evt = data as unknown as BotOnlineEvent;
          if (evt.agent_id) {
            live.applyBotOnline(evt.agent_id, evt.online === true);
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
              const rid = live.lastRequestIdRef.current;
              const cid = live.conversationRef.current?.id;
              if (rid && cid) {
                setApprovalGate({ conversationId: cid, requestId: rid });
              }
            } else if (st === "idle" || st === "thinking" || st === "working") {
              setApprovalGate((prev) =>
                prev && live.conversationRef.current?.id === prev.conversationId ? null : prev,
              );
            }
          }
          return;
        }
        if (data.type === "agents_changed") {
          void live.refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "channels_changed") {
          void live.refreshChannels().catch(() => {});
          return;
        }
        if (data.type === "micro_apps_changed") {
          refreshMicroAppsFromWS();
          return;
        }
        if (data.type === "reaction_updated") {
          const evt = data as ReactionUpdatedEvent;
          if (evt.message_id && evt.emoji) {
            live.applyReactionEvent(evt);
          }
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(connect, 2000);
      };
    };
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- WebSocket pushes server-driven chat/presence updates
    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const live = depsRef.current;
        void live.refreshAgents().catch(() => {});
        void live.refreshChannels().catch(() => {});
        refreshMicroAppsFromWS();
        pullOpen();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (retry !== undefined) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      closeSocket();
    };
  }, [deps.token]);

  useEffect(() => {
    const id = deps.conversationId;
    if (!deps.token || !id || !deps.taskConvIds.has(id)) return;
    const timer = window.setInterval(() => {
      void listMessagesWithStatus(id)
        .then((listed) => {
          const live = depsRef.current;
          if (live.conversationRef.current?.id !== id) return;
          live.patchConvMessages(id, (prev) => {
            let next = prev;
            for (const m of listed.messages) {
              if (m.role === "summary") continue;
              live.applyRemoteHostDecisionRef.current(m);
              next = mergeIncomingMessage(next, m);
            }
            return next;
          });
          live.noteTask(id, Boolean(listed.task_active));
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [deps.token, deps.conversationId, deps.taskConvIds]);
}
