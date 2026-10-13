import type { FormEvent, MouseEvent, RefObject } from "react";
import type { Agent, ApprovalDecision, Channel } from "../api";
import type { ConvSheetTarget } from "../components/app/AppOverlays";
import type { OnboardingOption } from "../components/botOnboarding";
import type { CreateBotInput, NewChatMode } from "../components/newChatTypes";
import type { FeedbackTarget } from "../components/feedbackModalTypes";
import type { SettingsTab, UiMessage } from "../types/app-ui";

/** Chat transcript / composer / approval actions. */
export type ChatSessionActions = {
  settleHostConfirm: (message: UiMessage, decision: ApprovalDecision) => void;
  stopCurrentRun: (opts: { markStopped: boolean }) => void;
  onSubmit: (e: FormEvent) => void | Promise<void>;
  setOpenThreadRootId: (id: string | null) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  openFeedbackForMessage: (msg: UiMessage, source: FeedbackTarget["source"]) => void;
  onApprovalDeny: () => void;
  onApprovalAllow: () => void;
  onOnboardingSelect: (opt: OnboardingOption) => void;
  onOnboardingCustom: (text: string) => void;
  onOnboardingDismiss: () => void;
};

/** Overlay / create / avatar / train / feedback modal actions. */
export type OverlaySessionActions = {
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
  onToggleCreateSheet: () => void;
  onOpenNewChatList: () => void;
  setTrainAgent: (a: Agent | null) => void;
  setShowNewChat: (open: boolean) => void;
  setCreateSheetOpen: (open: boolean) => void;
  setNewChatInitialMode: (mode: NewChatMode) => void;
  setConvSheet: (target: ConvSheetTarget) => void;
  setFeedbackTarget: (t: FeedbackTarget | null) => void;
  setAvatarSettingsAgent: (a: Agent | null) => void;
  submitFeedback: (input: {
    polarity: FeedbackTarget["polarity"];
    reasons: string[];
    note: string;
    source: FeedbackTarget["source"];
  }) => Promise<void>;
  newChatBtnRef: RefObject<HTMLButtonElement | null>;
};

/** Sidebar selection + settings shell actions. */
export type ShellSessionActions = {
  onSelectAgent: (id: string) => void;
  openChannelChat: (id: string) => void | Promise<void>;
  removeAgent: (a: Agent, e?: MouseEvent) => void | Promise<void>;
  removeChannel: (ch: Channel, e?: MouseEvent) => void | Promise<void>;
  openSettings: (tab?: SettingsTab) => void;
  onLogout: () => void;
  onSystemBack: () => void;
  toggleAssistantsCollapsed: () => void;
  toggleGroupsCollapsed: () => void;
  onOpenBotSettings: (id: string) => void;
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  refreshChannels: () => Promise<unknown>;
  refreshAgents: () => Promise<unknown>;
  onSelectAgentRef: RefObject<(id: string) => void | Promise<void>>;
  setSettingsShellHub: (v: boolean) => void;
  setSettingsGeneralPane: (pane: "account" | "server" | "review") => void;
  onStatusMessage: (msg: string) => void;
};

export type SessionActions = ChatSessionActions & OverlaySessionActions & ShellSessionActions;

export const CHAT_SESSION_KEYS = [
  "settleHostConfirm",
  "stopCurrentRun",
  "onSubmit",
  "setOpenThreadRootId",
  "onToggleReaction",
  "openFeedbackForMessage",
  "onApprovalDeny",
  "onApprovalAllow",
  "onOnboardingSelect",
  "onOnboardingCustom",
  "onOnboardingDismiss",
] as const satisfies readonly (keyof ChatSessionActions)[];

export const OVERLAY_SESSION_KEYS = [
  "openAvatarSettings",
  "setCloneTarget",
  "setGroupMembersChannel",
  "startChatWithAgent",
  "createBotFromPopover",
  "createGroupFromPopover",
  "saveAvatarSettings",
  "onToggleCreateSheet",
  "onOpenNewChatList",
  "setTrainAgent",
  "setShowNewChat",
  "setCreateSheetOpen",
  "setNewChatInitialMode",
  "setConvSheet",
  "setFeedbackTarget",
  "setAvatarSettingsAgent",
  "submitFeedback",
  "newChatBtnRef",
] as const satisfies readonly (keyof OverlaySessionActions)[];

export const SHELL_SESSION_KEYS = [
  "onSelectAgent",
  "openChannelChat",
  "removeAgent",
  "removeChannel",
  "openSettings",
  "onLogout",
  "onSystemBack",
  "toggleAssistantsCollapsed",
  "toggleGroupsCollapsed",
  "onOpenBotSettings",
  "setChannels",
  "refreshChannels",
  "refreshAgents",
  "onSelectAgentRef",
  "setSettingsShellHub",
  "setSettingsGeneralPane",
  "onStatusMessage",
] as const satisfies readonly (keyof ShellSessionActions)[];

function pickKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

export function pickChatSessionActions(all: SessionActions): ChatSessionActions {
  return pickKeys(all, CHAT_SESSION_KEYS);
}

export function pickOverlaySessionActions(all: SessionActions): OverlaySessionActions {
  return pickKeys(all, OVERLAY_SESSION_KEYS);
}

export function pickShellSessionActions(all: SessionActions): ShellSessionActions {
  return pickKeys(all, SHELL_SESSION_KEYS);
}
