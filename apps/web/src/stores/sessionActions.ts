/**
 * 工作区动作。hooks 绑定，组件在事件里 getState() 调用。
 * 不要订阅这个 store：回调身份变化不该拖着侧栏/聊天重渲染。
 *
 * Domains (prefer these facades at call sites):
 * - chatSessionActions() — transcript / composer / approval
 * - overlaySessionActions() — create / avatar / train / feedback
 * - shellSessionActions() — sidebar / settings / back
 */

import type { RefObject } from "react";
import { noop } from "es-toolkit";
import { create } from "zustand";
import {
  pickChatSessionActions,
  pickOverlaySessionActions,
  pickShellSessionActions,
  type ChatSessionActions,
  type OverlaySessionActions,
  type SessionActions,
  type ShellSessionActions,
} from "./sessionActionDomains";

export type {
  ChatSessionActions,
  OverlaySessionActions,
  SessionActions,
  ShellSessionActions,
} from "./sessionActionDomains";

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
  settleMicroAppGrant: noop,
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

export function chatSessionActions(): ChatSessionActions {
  return pickChatSessionActions(sessionActions());
}

export function overlaySessionActions(): OverlaySessionActions {
  return pickOverlaySessionActions(sessionActions());
}

export function shellSessionActions(): ShellSessionActions {
  return pickShellSessionActions(sessionActions());
}
