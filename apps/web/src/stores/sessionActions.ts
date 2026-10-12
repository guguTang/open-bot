/**
 * 工作区动作。hooks 绑定，组件在事件里 getState() 调用。
 * 不要订阅这个 store：回调身份变化不该拖着侧栏/聊天重渲染。
 */

import type { FormEvent, MouseEvent, RefObject } from "react";
import type { Agent, ApprovalDecision, Channel } from "../api";
import type { ConvSheetTarget } from "../components/app/AppOverlays";
import type { OnboardingOption } from "../components/BotOnboardingCard";
import type { CreateBotInput } from "../components/NewChatPopover";
import type { FeedbackTarget } from "../components/FeedbackModal";
import type { SettingsTab } from "../types/app-ui";
import type { UiMessage } from "../types/app-ui";
import { create } from "zustand";

export type SessionActions = {
  onSelectAgent: (id: string) => void;
  openChannelChat: (id: string) => void | Promise<void>;
  removeAgent: (a: Agent, e?: MouseEvent) => void | Promise<void>;
  removeChannel: (ch: Channel, e?: MouseEvent) => void | Promise<void>;
  openSettings: (tab?: SettingsTab) => void;
  openAvatarSettings: (agent: Agent) => void;
  setCloneTarget: (agent: Agent | null) => void;
  setGroupMembersChannel: (ch: Channel | null) => void;
  startChatWithAgent: (a: Agent) => void;
  createBotFromPopover: (input: CreateBotInput) => void | Promise<void>;
  createGroupFromPopover: (name: string, ids: string[]) => void | Promise<void>;
  saveAvatarSettings: (
    id: string,
    patch: { avatar_shape: string; avatar_color: string; machine_id?: string },
  ) => Promise<void>;
  onLogout: () => void;
  onSystemBack: () => void;
  settleHostConfirm: (message: UiMessage, decision: ApprovalDecision) => void;
  stopCurrentRun: (opts: { markStopped: boolean }) => void;
  onSubmit: (e: FormEvent) => void | Promise<void>;
  setOpenThreadRootId: (id: string | null) => void;
  toggleAssistantsCollapsed: () => void;
  toggleGroupsCollapsed: () => void;
  onToggleCreateSheet: () => void;
  onOpenNewChatList: () => void;
  onOpenBotSettings: (id: string) => void;
  onOnboardingSelect: (opt: OnboardingOption) => void;
  onOnboardingCustom: (text: string) => void;
  onOnboardingDismiss: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  openFeedbackForMessage: (msg: UiMessage, source: FeedbackTarget["source"]) => void;
  onApprovalDeny: () => void;
  onApprovalAllow: () => void;
  setTrainAgent: (a: Agent | null) => void;
  setShowNewChat: (open: boolean) => void;
  setCreateSheetOpen: (open: boolean) => void;
  setNewChatInitialMode: (mode: import("../components/NewChatPopover").NewChatMode) => void;
  setConvSheet: (target: ConvSheetTarget) => void;
  setFeedbackTarget: (t: FeedbackTarget | null) => void;
  setAvatarSettingsAgent: (a: Agent | null) => void;
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  refreshChannels: () => Promise<unknown>;
  refreshAgents: () => Promise<unknown>;
  submitFeedback: (input: {
    polarity: FeedbackTarget["polarity"];
    reasons: string[];
    note: string;
    source: FeedbackTarget["source"];
  }) => Promise<void>;
  onSelectAgentRef: RefObject<(id: string) => void | Promise<void>>;
  newChatBtnRef: RefObject<HTMLButtonElement | null>;
  setSettingsShellHub: (v: boolean) => void;
  setSettingsGeneralPane: (pane: "account" | "server" | "review") => void;
  onStatusMessage: (msg: string) => void;
};

const noop = () => {};
const asyncNoop = async () => {};
const emptyFnRef: RefObject<(id: string) => void | Promise<void>> = { current: () => {} };
const emptyBtnRef: RefObject<HTMLButtonElement | null> = { current: null };

const initialActions: SessionActions = {
  onSelectAgent: noop,
  openChannelChat: noop,
  removeAgent: noop,
  removeChannel: noop,
  openSettings: noop,
  openAvatarSettings: noop,
  setCloneTarget: noop,
  setGroupMembersChannel: noop,
  startChatWithAgent: noop,
  createBotFromPopover: noop,
  createGroupFromPopover: noop,
  saveAvatarSettings: asyncNoop,
  onLogout: noop,
  onSystemBack: noop,
  settleHostConfirm: noop,
  stopCurrentRun: noop,
  onSubmit: noop,
  setOpenThreadRootId: noop,
  toggleAssistantsCollapsed: noop,
  toggleGroupsCollapsed: noop,
  onToggleCreateSheet: noop,
  onOpenNewChatList: noop,
  onOpenBotSettings: noop,
  onOnboardingSelect: noop,
  onOnboardingCustom: noop,
  onOnboardingDismiss: noop,
  onToggleReaction: asyncNoop,
  openFeedbackForMessage: noop,
  onApprovalDeny: noop,
  onApprovalAllow: noop,
  setTrainAgent: noop,
  setShowNewChat: noop,
  setCreateSheetOpen: noop,
  setNewChatInitialMode: noop,
  setConvSheet: noop,
  setFeedbackTarget: noop,
  setAvatarSettingsAgent: noop,
  setChannels: noop,
  refreshChannels: asyncNoop,
  refreshAgents: asyncNoop,
  submitFeedback: asyncNoop,
  onSelectAgentRef: emptyFnRef,
  newChatBtnRef: emptyBtnRef,
  setSettingsShellHub: noop,
  setSettingsGeneralPane: noop,
  onStatusMessage: noop,
};

export const useSessionActions = create<SessionActions>()(() => ({ ...initialActions }));

export function bindSessionActions(partial: Partial<SessionActions>) {
  useSessionActions.setState(partial);
}

export function sessionActions(): SessionActions {
  return useSessionActions.getState();
}
