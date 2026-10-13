/**
 * Workspace session module — owns App wiring: agents/channels, settings slices,
 * chat controller, ref bridges, sessionActions bind, workspace store sync, logout.
 *
 * App UI only consumes { authed, applySession, settings } and renders shells.
 */
import { FormEvent, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConfirm, useDismissConfirm } from "../components/ConfirmProvider";
import type { Conversation } from "../api";
import { useChatController } from "./chat";
import {
  useAgentsAndChannels,
  useAuthSession,
  useHostMachineState,
  useHostRegistration,
  useMobileShell,
  type AgentsChannelsChatBridge,
} from "./bootstrap";
import { useAppSettings } from "./useAppSettings";
import { useAppComposerOptions } from "./useAppComposerOptions";
import { useAppChatSession, type SendUserTextFn } from "./useAppChatSession";
import { chatState, writeOpenThreadRootId } from "../stores/chat";
import { bindSessionActions } from "../stores/sessionActions";
import { patchShell } from "../stores/shell";
import { patchWorkspace } from "../stores/workspace";
import { setHostExecMachinePolicy } from "../lib/hostExec";
import { normalizeMachineExecPolicy } from "../lib/userSettings";

export function useWorkspaceAppSession() {
  const { user, token, authed, applySession, onLogout: logoutSession } = useAuthSession();

  const chatBridgeRef = useRef<AgentsChannelsChatBridge | null>(null);
  const sendUserTextRef = useRef<SendUserTextFn | null>(null);
  const onSelectAgentRefBridge = useRef<((id: string) => void | Promise<void>) | null>(null);
  const openChannelChatRefBridge = useRef<((id: string) => void | Promise<void>) | null>(null);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const openThreadRootIdRef = useRef<string | null>(null);
  const setOpenThreadRootId = useCallback((id: string | null) => {
    const next = (id || "").trim() || null;
    openThreadRootIdRef.current = next;
    writeOpenThreadRootId(next);
  }, []);
  const [, setStatus] = useState("");
  const confirm = useConfirm();
  const dismissConfirm = useDismissConfirm();

  const agentsChannels = useAgentsAndChannels({
    userId: user?.id,
    conversation,
    setMobileView: (v) => patchShell({ mobileView: v }),
    setShowNewChat: (open) => patchShell({ showNewChat: open }),
    setOnboardingDismissedState: (v) => patchShell({ onboardingDismissed: v }),
    setStatus,
    confirm,
    chatBridgeRef,
  });
  const {
    agents,
    agentId,
    setAgentId,
    channels,
    setChannels,
    agentBusy,
    channelBusy,
    assistantsCollapsed,
    groupsCollapsed,
    toggleAssistantsCollapsed,
    toggleGroupsCollapsed,
    didRestoreLastActive,
    onSelectAgentRef,
    applyBotOnline,
    refreshAgents,
    refreshChannels,
    refreshConversations,
    saveLastActiveSelection,
    saveAvatarSettings,
    openAvatarSettings,
    startChatWithAgent,
    createBotFromPopover,
    createGroupFromPopover,
    removeAgent,
    removeChannel,
    setCloneTarget,
    setGroupMembersChannel,
    setAvatarSettingsAgent,
  } = agentsChannels;

  const hostMachine = useHostMachineState();
  const {
    clientEnv,
    hostMachineId,
    setHostMachineId,
    hostWritesOn,
    hostExecPolicy,
    setHostExecPolicy,
    setHostActivity,
  } = hostMachine;

  const settings = useAppSettings({
    confirm,
    agentId,
    conversationId: conversation?.id,
    agents,
    userId: user?.id,
    refreshAgents,
    clientEnv,
    hostMachineId,
    setHostMachineId,
    setHostExecPolicy,
    setHostWritesOn: hostMachine.setHostWritesOn,
  });

  const { shell, chatSlice } = settings;
  const openSettings = shell.open;

  const hostExecPolicyFromMachine = useMemo(() => {
    const mid = hostMachineId;
    if (!mid) return "allow" as const;
    const m = chatSlice.machines.find((x) => x.id === mid);
    return normalizeMachineExecPolicy(m?.exec_policy);
  }, [hostMachineId, chatSlice.machines]);

  useLayoutEffect(() => {
    setHostExecMachinePolicy(hostExecPolicyFromMachine);
    setHostExecPolicy(hostExecPolicyFromMachine);
  }, [hostExecPolicyFromMachine, setHostExecPolicy]);

  const chatSession = useAppChatSession({
    agentId,
    agents,
    conversation,
    refreshAgents,
    setStatus,
    getSendUserText: () => sendUserTextRef.current,
    getOnSelectAgent: () => onSelectAgentRefBridge.current,
    getOpenChannelChat: () => openChannelChatRefBridge.current,
    removeAgent,
    removeChannel,
    openSettings,
  });

  const composer = useAppComposerOptions({
    conversation,
    channels,
    agents,
    authed,
    agentId,
    routines: settings.routines.routines,
    mcpServers: settings.mcp.mcpServers,
    skillsRevision: settings.skills.skills,
  });
  const { agentNameById, groupMentionMembers, composerMentionItems, composerSkills } = composer;

  const chat = useChatController({
    token,
    user,
    authed,
    conversation,
    setConversation,
    agentId,
    setAgentId,
    agents,
    channels,
    setMobileView: (v) => patchShell({ mobileView: v }),
    setStatus,
    applyBotOnline,
    refreshAgents,
    refreshChannels,
    refreshConversations,
    saveLastActiveSelection,
    agentNameById,
    groupMentionMembers,
    openThreadRootIdRef,
    setOpenThreadRootId,
    setOnboardingDismissedState: chatSession.setOnboardingDismissedState,
    applyReactionEvent: chatSession.applyReactionEvent,
    setHostActivity,
    hostExecPolicy,
    toolAllowEntries: chatSlice.toolAllowEntries,
    setToolAllowEntries: chatSlice.setToolAllowEntries,
    clientEnv,
    machines: chatSlice.machines,
    deviceDisplayName: chatSlice.deviceDisplayName,
    refreshLLMs: chatSlice.refreshLLMs,
    didRestoreLastActive,
  });

  const {
    onSelectAgent,
    openChannelChat,
    snapshotViewedMessages,
    selectGenRef,
    sendUserText,
    conversationRef,
    messagesByConvRef,
    runsRef,
    stopCurrentRun,
    busySelectionKeys,
    viewingRunActive,
    selectionHydrated,
    settleHostConfirm,
    askHostConfirmRef,
    hostConfirmResolvers,
    teardownChatOnLogout,
  } = chat;

  useLayoutEffect(() => {
    sendUserTextRef.current = sendUserText;
    onSelectAgentRefBridge.current = onSelectAgent;
    openChannelChatRefBridge.current = openChannelChat;
    chatBridgeRef.current = {
      onSelectAgent,
      openChannelChat,
      snapshotViewedMessages,
      selectGenRef,
      conversationRef,
      setConversation,
      messagesByConvRef,
      runsRef,
      stopCurrentRun,
    };
  });

  useHostRegistration({
    authed,
    token,
    clientEnv,
    machines: chatSlice.machines,
    machinesSyncRef: settings.machinesSyncRef,
    hostMachineId,
    setHostMachineId,
    askHostConfirmRef,
    hostConfirmResolvers,
  });

  const mobile = useMobileShell({
    showSettings: shell.show,
    closeSettings: shell.close,
    dismissConfirm,
    secretPromptOpen: Boolean(shell.secretPrompt),
    dismissSecretPrompt: () => shell.setSecretPrompt(null),
  });

  const onLogout = () => {
    logoutSession({
      beforeClear: () => patchShell({ mobileView: "list" }),
      teardownChat: teardownChatOnLogout,
    });
    openThreadRootIdRef.current = null;
    settings.clearLlmsOnLogout();
    setStatus("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const { input, pendingFiles } = chatState();
    await sendUserText(input, [...pendingFiles]);
  };

  bindSessionActions({
    onSelectAgent: chatSession.onSelectAgentSync,
    openChannelChat: chatSession.onOpenChannelChatSync,
    removeAgent: chatSession.onRemoveAgentSync,
    removeChannel: chatSession.onRemoveChannelSync,
    openSettings,
    openAvatarSettings,
    setCloneTarget,
    setGroupMembersChannel: (ch) => setGroupMembersChannel(ch),
    startChatWithAgent,
    createBotFromPopover,
    createGroupFromPopover,
    saveAvatarSettings,
    onLogout,
    onSystemBack: () => void mobile.runSystemBack(),
    settleHostConfirm,
    stopCurrentRun,
    onSubmit,
    setOpenThreadRootId,
    toggleAssistantsCollapsed,
    toggleGroupsCollapsed,
    onToggleCreateSheet: chatSession.onToggleCreateSheet,
    onOpenNewChatList: chatSession.onOpenNewChatList,
    onOpenBotSettings: chatSession.onOpenBotSettingsFromSidebar,
    onOnboardingSelect: chatSession.onOnboardingSelect,
    onOnboardingCustom: chatSession.onOnboardingCustom,
    onOnboardingDismiss: chatSession.onOnboardingDismiss,
    onToggleReaction: chatSession.onToggleReaction,
    openFeedbackForMessage: chatSession.openFeedbackForMessage,
    onApprovalDeny: chatSession.onApprovalDeny,
    onApprovalAllow: chatSession.onApprovalAllow,
    setTrainAgent: (a) => patchShell({ trainAgent: a }),
    setShowNewChat: (open) => patchShell({ showNewChat: open }),
    setCreateSheetOpen: (open) => patchShell({ createSheetOpen: open }),
    setNewChatInitialMode: (mode) => patchShell({ newChatInitialMode: mode }),
    setConvSheet: (target) => patchShell({ convSheet: target }),
    setFeedbackTarget: (t) => patchShell({ feedbackTarget: t }),
    setAvatarSettingsAgent,
    setChannels,
    refreshChannels,
    refreshAgents,
    submitFeedback: chatSession.submitFeedback,
    onSelectAgentRef,
    newChatBtnRef: chatSession.newChatBtnRef,
    setSettingsShellHub: (v) => patchShell({ settingsShellHub: v }),
    setSettingsGeneralPane: (pane) => patchShell({ settingsGeneralPane: pane }),
    onStatusMessage: setStatus,
  });

  useLayoutEffect(() => {
    const nextBusyKeys = [...busySelectionKeys];
    patchWorkspace({
      user,
      conversation,
      agentId,
      agents,
      channels,
      assistantsCollapsed,
      groupsCollapsed,
      agentBusy,
      channelBusy,
      busySelectionKeys: nextBusyKeys,
      defaultLLM: settings.defaultLLM,
      selectionHydrated,
      viewingRunActive,
      hostExecPolicy,
      hostWritesOn,
      composerMentionItems,
      composerSkills,
    });
  }, [
    user,
    conversation,
    agentId,
    agents,
    channels,
    assistantsCollapsed,
    groupsCollapsed,
    agentBusy,
    channelBusy,
    busySelectionKeys,
    settings.defaultLLM,
    selectionHydrated,
    viewingRunActive,
    hostExecPolicy,
    hostWritesOn,
    composerMentionItems,
    composerSkills,
  ]);

  return {
    authed,
    applySession,
    settings,
  };
}
