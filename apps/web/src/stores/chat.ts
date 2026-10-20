/**
 * 当前会话的热状态。
 *
 * 流式 token、输入框、运行状态每秒会变很多次。这些字段如果留在 App 的 useState 里，
 * 每次更新都会重跑整份巨石组件（设置、侧栏、弹层一起）。
 * 这里只放「读得到的状态」和同步 setter；拉消息、SSE、切换会话仍在 App 的 effect 里。
 * 组件按字段订阅：打字只刷新输入框，token 只刷新消息列表。
 */

import { create } from "zustand";
import type { ComposerReplyTarget, PendingFile } from "../components/Composer";
import type { UiMessage } from "../types/app-ui";
import { pinStick, type ScrollStick } from "../lib/scrollStick";
import { usePresenceStore } from "./presence";
import { useShellStore } from "./shell";
import { useMicroAppsStore } from "./microApps";
import { useWorkspaceStore } from "./workspace";

export type ApprovalGate = {
  conversationId: string;
  requestId: string;
} | null;

export type ChatSnapshot = {
  messages: UiMessage[];
  input: string;
  sending: boolean;
  taskBusy: boolean;
  runLabel: string;
  runActiveTool: string;
  runFaceAgentId: string;
  approvalGate: ApprovalGate;
  pendingFiles: PendingFile[];
  replyTarget: ComposerReplyTarget | null;
  openThreadRootId: string | null;
  showScrollBottom: boolean;
  chatSwitchPending: boolean;
};

const initialChat: ChatSnapshot = {
  messages: [],
  input: "",
  sending: false,
  taskBusy: false,
  runLabel: "正在思考…",
  runActiveTool: "",
  runFaceAgentId: "",
  approvalGate: null,
  pendingFiles: [],
  replyTarget: null,
  openThreadRootId: null,
  showScrollBottom: false,
  chatSwitchPending: false,
};

type ChatStore = ChatSnapshot & {
  resetChat: () => void;
};

export const useChatStore = create<ChatStore>()((set) => ({
  ...initialChat,
  resetChat: () => {
    replyTargetRef.current = null;
    const pin = pinStick();
    chatScrollRef.stickToBottom = pin.stickToBottom;
    set({ ...initialChat, showScrollBottom: pin.showScrollBottom });
  },
}));

/** 发送路径要同步读到回复目标，不能等下一次渲染。setter 会立刻写这里。 */
export const replyTargetRef: { current: ComposerReplyTarget | null } = { current: null };

/** 用户是否贴在底部。滚动位置是瞬态的，不进 React state。初值与 pinStick 一致。 */
export const chatScrollRef = { stickToBottom: pinStick().stickToBottom, suppressStick: false };

type Updater<T> = T | ((prev: T) => T);

export function setChat<K extends keyof ChatSnapshot>(key: K, value: Updater<ChatSnapshot[K]>) {
  useChatStore.setState((s) => {
    const prev = s[key];
    const next = typeof value === "function" ? (value as (p: ChatSnapshot[K]) => ChatSnapshot[K])(prev) : value;
    if (Object.is(next, prev)) return s;
    return { [key]: next };
  });
}

export function chatState(): ChatSnapshot {
  return useChatStore.getState();
}

export function viewedMessages(): UiMessage[] {
  return useChatStore.getState().messages;
}

export const setMessages = (value: Updater<UiMessage[]>) => setChat("messages", value);
export const setInput = (value: Updater<string>) => setChat("input", value);
export const setSending = (value: Updater<boolean>) => setChat("sending", value);
export const setTaskBusy = (value: Updater<boolean>) => setChat("taskBusy", value);
export const setRunLabel = (value: Updater<string>) => setChat("runLabel", value);
export const setRunActiveTool = (value: Updater<string>) => setChat("runActiveTool", value);
export const setRunFaceAgentId = (value: Updater<string>) => setChat("runFaceAgentId", value);
export const setApprovalGate = (value: Updater<ApprovalGate>) => setChat("approvalGate", value);
export const setPendingFiles = (value: Updater<PendingFile[]>) => setChat("pendingFiles", value);
export const setShowScrollBottom = (value: Updater<boolean>) => setChat("showScrollBottom", value);
export const setChatSwitchPending = (value: Updater<boolean>) => setChat("chatSwitchPending", value);
export const writeOpenThreadRootId = (value: Updater<string | null>) => setChat("openThreadRootId", value);

export function setReplyTarget(value: Updater<ComposerReplyTarget | null>) {
  setChat("replyTarget", value);
  replyTargetRef.current = useChatStore.getState().replyTarget;
}

export function applyScrollStick(next: ScrollStick) {
  chatScrollRef.stickToBottom = next.stickToBottom;
  setShowScrollBottom(next.showScrollBottom);
}

export function pinChatScroll() {
  applyScrollStick(pinStick());
}

export function resetChatSession() {
  useChatStore.getState().resetChat();
  usePresenceStore.getState().reset();
  useShellStore.getState().reset();
  useMicroAppsStore.getState().reset();
  useWorkspaceStore.getState().reset();
}
