/**
 * 实时通道的状态。
 *
 * 连接生命周期（WebSocket、重连、AppState）仍在 `providers/realtime.tsx` 里 ——
 * 那是典型的「同步外部系统」，本来就该在 effect 里做。
 * 这里只放**读得到的状态**：谁在线、什么 presence、本机在不在操作。
 *
 * 为什么用 store 而不是 Context：这个状态被列表页（在线绿点、回复中角标）、
 * 聊天页（presence）、全局提示条（host_activity）同时消费。用 Context 的话
 * 每次事件都要重渲染所有消费者；用 Zustand 则是按字段订阅 ——
 * 只有真正用到 `online` 的组件会重渲染。
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import type { BotPresenceEvent, BotOnlineEvent, Message, ReactionUpdatedEvent } from "@/api/types";

export type ChatServerEvent =
  | BotOnlineEvent
  | BotPresenceEvent
  | ReactionUpdatedEvent
  | { type: "conversation_message"; message: Message }
  | {
      type: "task_status";
      conversation_id: string;
      agent_id?: string;
      channel_id?: string;
      status: string;
      label?: string;
    }
  | { type: "host_activity"; active: boolean; machine_id?: string; label?: string }
  | { type: string; [key: string]: unknown };

type RealtimeState = {
  connected: boolean;
  /** 助手在线状态，key 为 agent_id */
  online: Record<string, boolean>;
  /** 助手 presence，key 为 agent_id */
  presence: Record<string, string>;
  /** 本机正在执行操作时的提示文案；null = 无 */
  hostActivity: string | null;
  /** 状态属于哪个用户，用于登出后自动失效旧数据 */
  scope: string | null;

  setConnected: (connected: boolean) => void;
  setScope: (scope: string | null) => void;
  applyBotOnline: (scope: string, evt: BotOnlineEvent) => void;
  applyBotPresence: (scope: string, evt: BotPresenceEvent) => void;
  setHostActivity: (scope: string, label: string | null) => void;
  reset: () => void;
};

export const useRealtimeStore = create<RealtimeState>()((set) => ({
  connected: false,
  online: {},
  presence: {},
  hostActivity: null,
  scope: null,

  setConnected: (connected) => set({ connected }),
  setScope: (scope) => set({ scope }),

  applyBotOnline: (scope, evt) =>
    set((s) => ({
      scope,
      online:
        s.scope === scope
          ? { ...s.online, [evt.agent_id]: evt.online }
          : { [evt.agent_id]: evt.online },
    })),

  applyBotPresence: (scope, evt) =>
    set((s) => ({
      scope,
      presence:
        s.scope === scope
          ? { ...s.presence, [evt.agent_id]: evt.status }
          : { [evt.agent_id]: evt.status },
    })),

  setHostActivity: (scope, hostActivity) => set({ scope, hostActivity }),

  reset: () => set({ connected: false, online: {}, presence: {}, hostActivity: null, scope: null }),
}));

/**
 * 读某个助手是否在线。
 *
 * 传 `scope`（当前用户 id）是刻意的：登出换人后，上一位用户的在线状态
 * 天然不可见，不会出现「A 的绿点显示在 B 的列表上」。
 */
export function useAgentOnline(agentId: string | undefined, scope: string | null): boolean {
  return useRealtimeStore(
    useShallow((s) => (s.scope === scope && agentId ? Boolean(s.online[agentId]) : false))
  );
}
