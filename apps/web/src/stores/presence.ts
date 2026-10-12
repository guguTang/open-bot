/**
 * 助手在线与 presence。
 *
 * WebSocket 会频繁推 bot_presence / bot_online。侧栏绿点和聊天顶栏订阅这里，
 * App 本体不订阅，所以一次 presence 不会重跑设置页和消息逻辑。
 */

import { create } from "zustand";
import type { BotPresenceStatus } from "../api";

type PresenceState = {
  presenceByAgent: Record<string, BotPresenceStatus>;
  onlineByAgent: Record<string, boolean>;
  setPresence: (agentId: string, status: BotPresenceStatus) => void;
  setOnline: (agentId: string, on: boolean) => void;
  seedOnline: (list: readonly { id: string; online?: boolean }[]) => void;
  reset: () => void;
};

export const usePresenceStore = create<PresenceState>()((set) => ({
  presenceByAgent: {},
  onlineByAgent: {},

  setPresence: (agentId, status) =>
    set((s) => {
      if (s.presenceByAgent[agentId] === status) return s;
      return { presenceByAgent: { ...s.presenceByAgent, [agentId]: status } };
    }),

  setOnline: (agentId, on) =>
    set((s) => {
      if (s.onlineByAgent[agentId] === on) return s;
      return { onlineByAgent: { ...s.onlineByAgent, [agentId]: on } };
    }),

  seedOnline: (list) =>
    set((s) => {
      let next = s.onlineByAgent;
      for (const a of list) {
        if (typeof a.online !== "boolean" || next[a.id] === a.online) continue;
        if (next === s.onlineByAgent) next = { ...s.onlineByAgent };
        next[a.id] = a.online;
      }
      if (next === s.onlineByAgent) return s;
      return { onlineByAgent: next };
    }),

  reset: () => set({ presenceByAgent: {}, onlineByAgent: {} }),
}));

export function botIsOnline(
  onlineByAgent: Record<string, boolean>,
  agents: readonly { id: string; online?: boolean }[],
  agentId?: string | null,
  snapshot?: boolean,
): boolean {
  if (!agentId) return false;
  if (agentId in onlineByAgent) return onlineByAgent[agentId];
  const a = agents.find((x) => x.id === agentId);
  return (a?.online ?? snapshot) === true;
}
