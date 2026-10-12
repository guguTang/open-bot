import { FormEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useConfirm, useDismissConfirm } from "./components/ConfirmProvider";
import { Conversation } from "./api";
import { AuthPage } from "./components/app/AuthPage";
import { AppSidebar } from "./components/app/AppSidebar";
import { AppAuthenticatedShell } from "./components/app/AppAuthenticatedShell";
import { AppSettingsPanel } from "./components/app/AppSettingsPanel";
import { AppOverlays } from "./components/app/AppOverlays";
import { AppChatArea } from "./components/app/AppChatArea";
import { useChatController } from "./hooks/chat";
import {
  useAgentsAndChannels,
  useAuthSession,
  useHostMachineState,
  useHostRegistration,
  useMobileShell,
  type AgentsChannelsChatBridge,
} from "./hooks/bootstrap";
import { useAppSettings } from "./hooks/useAppSettings";
import { useAppComposerOptions } from "./hooks/useAppComposerOptions";
import { useAppChatSession, type SendUserTextFn } from "./hooks/useAppChatSession";
import { chatState, writeOpenThreadRootId } from "./stores/chat";
import { bindSessionActions } from "./stores/sessionActions";
import { patchShell } from "./stores/shell";
import { patchWorkspace } from "./stores/workspace";

export default function App() {
  const auth = useAuthSession();
  const { user, token, authed, onLogout: logoutSession } = auth;

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

  const { openSettings } = settings;

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
    toolAllowEntries: settings.review.toolAllowEntries,
    setToolAllowEntries: settings.review.setToolAllowEntries,
    clientEnv,
    machines: settings.machines.machines,
    deviceDisplayName: settings.machines.deviceDisplayName,
    refreshLLMs: settings.llm.refreshLLMs,
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

  useHostRegistration({
    authed,
    token,
    clientEnv,
    machines: settings.machines.machines,
    machinesSyncRef: settings.machinesSyncRef,
    hostMachineId,
    setHostMachineId,
    setHostExecPolicy,
    askHostConfirmRef,
    hostConfirmResolvers,
  });

  const mobile = useMobileShell({
    showSettings: settings.showSettings,
    closeSettings: settings.closeSettings,
    dismissConfirm,
    secretPromptOpen: Boolean(settings.secretPrompt),
    dismissSecretPrompt: () => settings.setSecretPrompt(null),
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

  if (!authed) {
    return <AuthPage auth={auth} />;
  }

  return (
    <AppAuthenticatedShell>
      <AppSidebar />
      <AppOverlays settings={settings} />
      <AppChatArea />
      <AppSettingsPanel settings={settings} />
    </AppAuthenticatedShell>
  );
}
