/**
 * 壳层 UI：搜索、窄屏视图、弹层开关、host 活动条。
 * 和会话数据无关。搜索每敲一字、活动条每跳一次只刷新订阅了对应字段的组件。
 */

import { create } from "zustand";
import type { Agent, Channel } from "../api";
import type { ConvSheetTarget } from "../components/app/AppOverlays";
import type { FeedbackTarget } from "../components/FeedbackModal";
import type { NewChatMode } from "../components/NewChatPopover";

export type SettingsGeneralPane = "account" | "server" | "review";

export type ShellSnapshot = {
  convSearch: string;
  mobileView: "list" | "chat";
  settingsShellHub: boolean;
  settingsGeneralPane: SettingsGeneralPane;
  hostActivity: string;
  showNewChat: boolean;
  createSheetOpen: boolean;
  newChatInitialMode: NewChatMode;
  convSheet: ConvSheetTarget;
  cloneTarget: Agent | null;
  groupMembersChannel: Channel | null;
  avatarSettingsAgent: Agent | null;
  feedbackTarget: FeedbackTarget | null;
  trainAgent: Agent | null;
  trainReload: number;
  onboardingDismissed: boolean;
};

const initialOverlays: Pick<
  ShellSnapshot,
  | "showNewChat"
  | "createSheetOpen"
  | "newChatInitialMode"
  | "convSheet"
  | "cloneTarget"
  | "groupMembersChannel"
  | "avatarSettingsAgent"
  | "feedbackTarget"
  | "trainAgent"
  | "trainReload"
  | "onboardingDismissed"
> = {
  showNewChat: false,
  createSheetOpen: false,
  newChatInitialMode: "list",
  convSheet: null,
  cloneTarget: null,
  groupMembersChannel: null,
  avatarSettingsAgent: null,
  feedbackTarget: null,
  trainAgent: null,
  trainReload: 0,
  onboardingDismissed: false,
};

const initialShell: ShellSnapshot = {
  convSearch: "",
  mobileView: "list",
  settingsShellHub: true,
  settingsGeneralPane: "account",
  hostActivity: "",
  ...initialOverlays,
};

type Updater<T> = T | ((prev: T) => T);

type ShellStore = ShellSnapshot & {
  setConvSearch: (value: string) => void;
  patch: (partial: Partial<ShellSnapshot>) => void;
  reset: () => void;
};

export const useShellStore = create<ShellStore>()((set) => ({
  ...initialShell,
  setConvSearch: (convSearch) => set({ convSearch }),
  patch: (partial) =>
    set((s) => {
      let changed = false;
      const next: ShellStore = { ...s };
      for (const key of Object.keys(partial) as (keyof ShellSnapshot)[]) {
        const value = partial[key];
        if (value !== undefined && !Object.is(value, s[key])) {
          (next as Record<typeof key, typeof value>)[key] = value;
          changed = true;
        }
      }
      return changed ? next : s;
    }),
  reset: () =>
    set((s) => ({
      ...s,
      convSearch: "",
      mobileView: "list",
      settingsShellHub: true,
      settingsGeneralPane: "account",
      hostActivity: "",
      ...initialOverlays,
    })),
}));

export function shellState(): ShellSnapshot {
  return useShellStore.getState();
}

export function patchShell(partial: Partial<ShellSnapshot>) {
  useShellStore.getState().patch(partial);
}

export function setShell<K extends keyof ShellSnapshot>(key: K, value: Updater<ShellSnapshot[K]>) {
  const prev = useShellStore.getState()[key];
  const next = typeof value === "function" ? (value as (p: ShellSnapshot[K]) => ShellSnapshot[K])(prev) : value;
  if (Object.is(next, prev)) return;
  patchShell({ [key]: next } as Partial<ShellSnapshot>);
}
