/**
 * 客户端状态（Zustand）。
 *
 * 2026 年 RN 社区的共识是**把服务端状态和客户端状态分开管**：
 * - 服务端状态（列表、会话、设置页数据）→ TanStack Query，见 `queries/`
 * - 客户端状态（当前选中了谁、界面偏好、实时在线态）→ 就是这里
 *
 * 放进来的是「不来自服务器、又需要在多个页面之间共享」的东西。
 * 只有一个页面用得着的状态留在 useState 里 —— 别为了统一而统一。
 *
 * 三个 store 的共同点：都是**同步可读**的，页面首帧就能拿到正确值，
 * 不用等一次异步读盘（MMKV 同步，见 lib/storage.ts）。
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { readJson, writeJson } from "@/lib/storage";

/** 当前正在对话 / 配置的那个助手。跨页共享，持久化到 MMKV。 */
export type CurrentBot = { id: string; name: string } | null;

type CurrentBotState = {
  bot: CurrentBot;
  setBot: (bot: CurrentBot) => void;
  clearBot: () => void;
};

export const useCurrentBot = create<CurrentBotState>()(
  persist(
    (set) => ({
      bot: null,
      setBot: (bot) => set({ bot }),
      clearBot: () => set({ bot: null }),
    }),
    { name: "current_bot", storage: createJSONStorage(() => mmkvStorage) }
  )
);

/** 列表页偏好：分区折叠 + 上次打开。 */
export type ListPrefsState = {
  collapsed: Record<string, boolean>;
  lastOpened: {
    kind: "agent" | "channel";
    id: string;
    name: string;
    conversation_id?: string;
  } | null;
  toggleSection: (key: string) => void;
  setLastOpened: (value: ListPrefsState["lastOpened"]) => void;
  clearLastOpened: () => void;
};

export const useListPrefs = create<ListPrefsState>()(
  persist(
    (set) => ({
      collapsed: {},
      lastOpened: null,
      toggleSection: (key) =>
        set((s) => ({ collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } })),
      setLastOpened: (lastOpened) => set({ lastOpened }),
      clearLastOpened: () => set({ lastOpened: null }),
    }),
    { name: "list_prefs", storage: createJSONStorage(() => mmkvStorage) }
  )
);

/**
 * Zustand persist 的存储适配器。
 *
 * MMKV 是同步的，所以这三个方法也是同步的 —— zustand 允许同步 storage，
 * 好处是 hydrate 在首次渲染前就完成了，页面不会先闪一帧默认值。
 */
const mmkvStorage = {
  getItem: (name: string): string | null => {
    const v = readJson<string | null>(name, null);
    return typeof v === "string" ? v : null;
  },
  setItem: (name: string, value: string): void => {
    writeJson(name, value);
  },
  removeItem: (name: string): void => {
    writeJson(name, null);
  },
};
