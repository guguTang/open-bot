import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelConversationRun, openPrimaryConversation, type Agent, type Channel, type Conversation, type ReactionUpdatedEvent } from "../../api";
import { onboardingStorageKey } from "../../components/BotOnboardingCard";
import type { LastActiveSelection } from "../../types/app-ui";
import { readLastActiveSelection } from "../../lib/app/storage";
import { resetChatSession, setTaskBusy, setRunLabel } from "../../stores/chat";
import { useConvMessageBuffer } from "./useConvMessageBuffer";
import { useHostConfirmChat } from "./useHostConfirmChat";
import { useConversationRuns } from "./useConversationRuns";
import { useChatEventsSocket } from "./useChatEventsSocket";
import { useConversationSelection } from "./useConversationSelection";
import { useSendMessage } from "./useSendMessage";
import type { SendMessageDeps } from "./sendMessageDeps";
import type { ClientContext } from "../../lib/clientEnv";
import type { ToolAllowEntry } from "../../lib/toolAllowlist";
import type { Dispatch, SetStateAction } from "react";

export type ChatControllerParams = {
  token: string | null;
  user: { id: string } | null;
  authed: boolean;
  conversation: Conversation | null;
  setConversation: (c: Conversation | null) => void;
  agentId: string;
  setAgentId: (id: string) => void;
  agents: Agent[];
  channels: Channel[];
  setMobileView: (v: "list" | "chat") => void;
  setStatus: (s: string) => void;
  applyBotOnline: (id: string, on: boolean) => void;
  refreshAgents: () => Promise<Agent[]>;
  refreshChannels: () => Promise<Channel[]>;
  refreshConversations: () => Promise<void>;
  saveLastActiveSelection: (selection: LastActiveSelection) => void;
  agentNameById: Map<string, string>;
  groupMentionMembers: Agent[] | undefined;
  openThreadRootIdRef: React.RefObject<string | null>;
  setOpenThreadRootId: (id: string | null) => void;
  setOnboardingDismissedState: (v: boolean) => void;
  applyReactionEvent: (evt: ReactionUpdatedEvent) => void;
  setHostActivity: (label: string) => void;
  hostExecPolicy: import("../../lib/userSettings").MachineExecPolicy;
  toolAllowEntries: ToolAllowEntry[];
  setToolAllowEntries: Dispatch<SetStateAction<ToolAllowEntry[]>>;
  clientEnv: ClientContext;
  machines: import("../../api").Machine[];
  deviceDisplayName: string;
  refreshLLMs: () => Promise<unknown>;
  didRestoreLastActive: React.MutableRefObject<string | null>;
};

export function useChatController(p: ChatControllerParams) {
  const conversationRef = useRef<Conversation | null>(null);
  useEffect(() => {
    conversationRef.current = p.conversation;
  }, [p.conversation]);

  const [taskConvIds, setTaskConvIds] = useState<Set<string>>(() => new Set());
  const taskConvIdsRef = useRef(taskConvIds);
  taskConvIdsRef.current = taskConvIds;

  const lastRequestIdRef = useRef<string>("");
  const localUserIdRef = useRef<string | null>(null);

  const [selectionHydrated, setSelectionHydrated] = useState(false);

  const { messagesByConvRef, patchConvMessages, snapshotViewedMessages, clearMessageBuffer } =
    useConvMessageBuffer(conversationRef);

  const noteTask = useCallback((convId: string, active: boolean, label?: string) => {
    const cur = taskConvIdsRef.current;
    const has = cur.has(convId);
    if (active !== has) {
      const next = new Set(cur);
      if (active) next.add(convId);
      else next.delete(convId);
      taskConvIdsRef.current = next;
      setTaskConvIds(next);
    }
    if (conversationRef.current?.id === convId) {
      setTaskBusy(active);
      if (active && label) setRunLabel(label);
      if (!active) setRunLabel("正在思考…");
    }
  }, []);

  const host = useHostConfirmChat({
    conversationRef,
    patchConvMessages,
    userId: p.user?.id,
    hostExecPolicy: p.hostExecPolicy,
    toolAllowEntries: p.toolAllowEntries,
    setToolAllowEntries: p.setToolAllowEntries,
  });

  const runs = useConversationRuns({
    conversationRef,
    messagesByConvRef,
    patchConvMessages,
    lastRequestIdRef,
    localUserIdRef,
    openThreadRootIdRef: p.openThreadRootIdRef,
    setOpenThreadRootId: p.setOpenThreadRootId,
    noteTask,
    applyBotOnline: p.applyBotOnline,
    refreshConversations: p.refreshConversations,
  });

  const selection = useConversationSelection({
    agents: p.agents,
    channels: p.channels,
    agentId: p.agentId,
    setAgentId: p.setAgentId,
    setMobileView: p.setMobileView,
    setStatus: p.setStatus,
    conversationRef,
    setConversation: p.setConversation,
    messagesByConvRef,
    patchConvMessages,
    snapshotViewedMessages,
    runsRef: runs.runsRef,
    taskConvIdsRef,
    noteTask,
    applyBotOnline: p.applyBotOnline,
    saveLastActiveSelection: p.saveLastActiveSelection,
    refreshAgents: p.refreshAgents,
    refreshChannels: p.refreshChannels,
    resumeActiveRun: runs.resumeActiveRun,
    mapApiMessages: runs.mapApiMessages,
    agentNameById: p.agentNameById,
    setOpenThreadRootId: p.setOpenThreadRootId,
  });

  const ensureConversation = useCallback(async () => {
    if (p.conversation?.channel_id) return p.conversation;
    if (p.conversation && p.conversation.agent_id === p.agentId && !p.conversation.channel_id) {
      return p.conversation;
    }
    if (!p.agentId) {
      throw new Error("请先创建助手");
    }
    const conv = await openPrimaryConversation(p.agentId);
    conversationRef.current = conv;
    p.setConversation(conv);
    return conv;
  }, [p]);

  const onboardingKey = useMemo(
    () => onboardingStorageKey(p.conversation?.id, p.agentId),
    [p.conversation?.id, p.agentId],
  );

  const sendDeps = useMemo(
    (): SendMessageDeps => ({
      authed: p.authed,
      openThreadRootIdRef: p.openThreadRootIdRef,
      conversationRef,
      setConversation: p.setConversation,
      runsRef: runs.runsRef,
      stopCurrentRun: runs.stopCurrentRun,
      taskConvIdsRef,
      agents: p.agents,
      agentId: p.agentId,
      setAgentId: p.setAgentId,
      agentNameById: p.agentNameById,
      messagesByConvRef,
      patchConvMessages,
      snapshotViewedMessages,
      selectGenRef: selection.selectGenRef,
      mapApiMessages: runs.mapApiMessages,
      noteTask,
      saveLastActiveSelection: p.saveLastActiveSelection,
      onboardingKey,
      setOnboardingDismissedState: p.setOnboardingDismissedState,
      localUserIdRef,
      groupMentionMembers: p.groupMentionMembers,
      ensureConversation,
      refreshConversations: p.refreshConversations,
      refreshAgents: p.refreshAgents,
      bumpRunBusy: runs.bumpRunBusy,
      lastRequestIdRef,
      sealStreamingMessagesForConv: runs.sealStreamingMessagesForConv,
      stampUserSavedMessage: runs.stampUserSavedMessage,
      stampSavedMessage: runs.stampSavedMessage,
      attachSourcesToStreaming: runs.attachSourcesToStreaming,
      setStatus: p.setStatus,
      clientEnv: p.clientEnv,
      machines: p.machines,
      deviceDisplayName: p.deviceDisplayName,
    }),
    [
      p,
      runs,
      selection.selectGenRef,
      noteTask,
      ensureConversation,
      onboardingKey,
      patchConvMessages,
      snapshotViewedMessages,
      messagesByConvRef,
    ],
  );

  const sendUserText = useSendMessage(sendDeps);

  useChatEventsSocket({
    token: p.token,
    conversationRef,
    conversationId: p.conversation?.id,
    taskConvIds,
    patchConvMessages,
    noteTask,
    applyRemoteHostDecisionRef: host.applyRemoteHostDecisionRef,
    acceptServerMessage: host.acceptServerMessage,
    applyReactionEvent: p.applyReactionEvent,
    applyBotOnline: p.applyBotOnline,
    refreshAgents: p.refreshAgents,
    lastRequestIdRef,
    setHostActivity: p.setHostActivity,
  });

  const busySelectionKeys = useMemo(() => {
    void runs.runBusyTick;
    const keys = new Set<string>();
    for (const run of runs.runsRef.current.values()) {
      keys.add(run.selectionKey);
    }
    for (const a of p.agents) {
      if (a.task_active || (a.conversation_id && taskConvIds.has(a.conversation_id))) {
        keys.add(`agent:${a.id}`);
      }
    }
    for (const ch of p.channels) {
      if (ch.task_active || (ch.conversation_id && taskConvIds.has(ch.conversation_id))) {
        keys.add(`channel:${ch.id}`);
      }
    }
    return keys;
  }, [runs.runBusyTick, p.agents, p.channels, taskConvIds, runs.runsRef]);

  const viewingRunActive = useMemo(() => {
    void runs.runBusyTick;
    const id = p.conversation?.id;
    return Boolean(id && runs.runsRef.current.has(id));
  }, [runs.runBusyTick, p.conversation?.id, runs.runsRef]);

  const teardownChatOnLogout = useCallback(() => {
    p.didRestoreLastActive.current = null;
    setSelectionHydrated(false);
    runs.clearAllRuns((convId) => {
      void cancelConversationRun(convId).catch(() => {});
    });
    clearMessageBuffer();
    conversationRef.current = null;
    p.openThreadRootIdRef.current = null;
    p.setConversation(null);
    resetChatSession();
    setTaskConvIds(new Set());
    taskConvIdsRef.current = new Set();
    runs.bumpRunBusy();
  }, [clearMessageBuffer, p.openThreadRootIdRef, runs]);

  const onSelectAgentRef = useRef(selection.onSelectAgent);
  onSelectAgentRef.current = selection.onSelectAgent;
  const openChannelChatRef = useRef(selection.openChannelChat);
  openChannelChatRef.current = selection.openChannelChat;

  useEffect(() => {
    if (!p.authed || !p.user?.id) {
      p.didRestoreLastActive.current = null;
      setSelectionHydrated(false);
      return;
    }
    if (p.didRestoreLastActive.current === p.user.id) return;

    let cancelled = false;
    const restoreLastActive = async () => {
      try {
        const [agentList, channelList] = await Promise.all([p.refreshAgents(), p.refreshChannels()]);
        if (cancelled) return;

        if (conversationRef.current) {
          p.didRestoreLastActive.current = p.user!.id;
          setSelectionHydrated(true);
          p.setMobileView("chat");
          return;
        }

        const saved = readLastActiveSelection(p.user!.id);
        if (saved?.kind === "agent" && agentList.some((agent) => agent.id === saved.id)) {
          await onSelectAgentRef.current(saved.id);
        } else if (
          saved?.kind === "channel" &&
          channelList.some((channel) => channel.id === saved.id)
        ) {
          await openChannelChatRef.current(saved.id);
        } else {
          const datedAgents = agentList
            .filter((agent) => agent.conversation_updated_at)
            .sort(
              (a, b) =>
                (Date.parse(b.conversation_updated_at || "") || 0) -
                (Date.parse(a.conversation_updated_at || "") || 0),
            );
          const fallback = datedAgents[0] ?? agentList[0];
          if (fallback) await onSelectAgentRef.current(fallback.id);
        }

        if (cancelled) return;
        p.didRestoreLastActive.current = p.user!.id;
        setSelectionHydrated(true);
        if (conversationRef.current) p.setMobileView("chat");
      } catch {
        if (!cancelled) {
          p.didRestoreLastActive.current = p.user!.id;
          setSelectionHydrated(true);
          p.setStatus("无法拉取助手或群聊列表（请确认已登录且 API 可用）");
        }
      }
    };

    void restoreLastActive();
    void p.refreshLLMs().catch(() => p.setStatus("无法拉取 LLM 连接列表"));
    return () => {
      cancelled = true;
    };
  }, [p.authed, p.user?.id, p.refreshAgents, p.refreshChannels, p.refreshLLMs]);

  return {
    conversationRef,
    messagesByConvRef,
    patchConvMessages,
    snapshotViewedMessages,
    selectGenRef: selection.selectGenRef,
    sendUserText,
    onSelectAgent: selection.onSelectAgent,
    openChannelChat: selection.openChannelChat,
    applyConversationView: selection.applyConversationView,
    stopCurrentRun: runs.stopCurrentRun,
    runsRef: runs.runsRef,
    busySelectionKeys,
    viewingRunActive,
    selectionHydrated,
    settleHostConfirm: host.settleHostConfirm,
    askHostConfirmRef: host.askHostConfirmRef,
    hostConfirmResolvers: host.hostConfirmResolvers,
    applyRemoteHostDecisionRef: host.applyRemoteHostDecisionRef,
    mapApiMessages: runs.mapApiMessages,
    teardownChatOnLogout,
    taskConvIdsRef,
    noteTask,
  };
}
