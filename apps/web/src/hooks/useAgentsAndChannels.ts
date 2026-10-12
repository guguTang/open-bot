import {
  MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { CreateBotInput } from "../components/NewChatPopover";
import {
  Agent,
  Channel,
  Conversation,
  createAgent,
  createChannel,
  deleteAgent,
  deleteChannel,
  getStoredUser,
  listAgents,
  listChannels,
  openPrimaryConversation,
  updateAgent,
} from "../api";
import {
  readLastActiveSelection,
  readListFoldState,
  writeLastActiveSelection,
  writeListFoldState,
} from "../lib/app/storage";
import type { LastActiveSelection } from "../types/app-ui";
import { usePresenceStore } from "../stores/presence";
import { patchShell, setShell } from "../stores/shell";
import {
  chatScrollRef,
  setMessages,
  setPendingFiles,
  setRunLabel,
  setSending,
} from "../stores/chat";

export type AgentsChannelsChatBridge = {
  onSelectAgent: (id: string) => void;
  openChannelChat: (channelId: string) => Promise<void>;
  snapshotViewedMessages: () => void;
  selectGenRef: MutableRefObject<number>;
  conversationRef: MutableRefObject<Conversation | null>;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  messagesByConvRef: MutableRefObject<Map<string, import("../api").Message[]>>;
  runsRef: MutableRefObject<
    Map<
      string,
      {
        selectionKey: string;
      }
    >
  >;
  stopCurrentRun: (opts: { markStopped: boolean; conversationId: string }) => Promise<void>;
};

export type UseAgentsAndChannelsParams = {
  userId: string | undefined;
  conversation: Conversation | null;
  setMobileView: (v: "list" | "chat") => void;
  setShowNewChat: (open: boolean) => void;
  setOnboardingDismissedState: (v: boolean) => void;
  setStatus: Dispatch<SetStateAction<string>>;
  confirm: (opts: {
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    danger?: boolean;
  }) => Promise<boolean>;
  chatBridgeRef: MutableRefObject<AgentsChannelsChatBridge | null>;
};

export function useAgentsAndChannels(params: UseAgentsAndChannelsParams) {
  const {
    userId,
    conversation,
    setMobileView,
    setShowNewChat,
    setOnboardingDismissedState,
    setStatus,
    confirm,
    chatBridgeRef,
  } = params;

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const setCloneTarget = useCallback((agent: Agent | null) => patchShell({ cloneTarget: agent }), []);
  const setGroupMembersChannel = useCallback(
    (value: SetStateAction<Channel | null>) => setShell("groupMembersChannel", value),
    [],
  );
  const setAvatarSettingsAgent = useCallback((agent: Agent | null) => patchShell({ avatarSettingsAgent: agent }), []);
  const [assistantsCollapsed, setAssistantsCollapsed] = useState(false);
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);

  const didRestoreLastActive = useRef<string | null>(null);
  const onSelectAgentRef = useRef<(id: string) => void>(() => {});

  const applyBotOnline = useCallback((id: string, on: boolean) => {
    usePresenceStore.getState().setOnline(id, on);
    setAgents((prev) =>
      prev.some((a) => a.id === id && a.online !== on)
        ? prev.map((a) => (a.id === id ? { ...a, online: on } : a))
        : prev,
    );
  }, []);

  const seedOnlineFromAgents = useCallback((list: Agent[]) => {
    usePresenceStore.getState().seedOnline(list);
  }, []);

  useEffect(() => {
    if (!userId) {
      setAssistantsCollapsed(false);
      setGroupsCollapsed(false);
      return;
    }
    const saved = readListFoldState(userId);
    setAssistantsCollapsed(saved.assistantsCollapsed);
    setGroupsCollapsed(saved.groupsCollapsed);
  }, [userId]);

  const toggleAssistantsCollapsed = useCallback(() => {
    setAssistantsCollapsed((prev) => {
      const next = !prev;
      if (userId) {
        writeListFoldState(userId, { assistantsCollapsed: next, groupsCollapsed });
      }
      return next;
    });
  }, [userId, groupsCollapsed]);

  const toggleGroupsCollapsed = useCallback(() => {
    setGroupsCollapsed((prev) => {
      const next = !prev;
      if (userId) {
        writeListFoldState(userId, { assistantsCollapsed, groupsCollapsed: next });
      }
      return next;
    });
  }, [userId, assistantsCollapsed]);

  const refreshAgents = useCallback(async (): Promise<Agent[]> => {
    const list = await listAgents();
    setAgents(list);
    seedOnlineFromAgents(list);
    setAgentId((prev) => {
      if (prev && list.some((a) => a.id === prev)) return prev;
      const uid = getStoredUser()?.id;
      const saved = uid ? readLastActiveSelection(uid) : null;
      if (saved?.kind === "agent" && list.some((a) => a.id === saved.id)) {
        return saved.id;
      }
      if (uid && didRestoreLastActive.current !== uid) {
        return prev;
      }
      return list[0]?.id ?? "";
    });
    return list;
  }, [seedOnlineFromAgents, setAgentId]);

  const refreshChannels = useCallback(async () => {
    const chs = await listChannels();
    setChannels(chs);
    return chs;
  }, []);

  const refreshConversations = useCallback(async () => {
    await refreshAgents();
  }, [refreshAgents]);

  const saveLastActiveSelection = useCallback(
    (selection: LastActiveSelection) => {
      if (!userId) return;
      writeLastActiveSelection(userId, selection);
    },
    [userId],
  );

  const saveAvatarSettings = useCallback(
    async (
      id: string,
      patch: { avatar_shape: string; avatar_color: string; machine_id?: string },
    ) => {
      const updated = await updateAgent(id, patch);
      const nextMachineId =
        typeof updated.machine_id === "string" ? updated.machine_id : patch.machine_id;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                avatar_shape: updated.avatar_shape || patch.avatar_shape,
                avatar_color: updated.avatar_color || patch.avatar_color,
                ...(nextMachineId !== undefined ? { machine_id: nextMachineId } : {}),
                ...(typeof updated.online === "boolean" ? { online: updated.online } : {}),
              }
            : a,
        ),
      );
      if (typeof updated.online === "boolean") applyBotOnline(id, updated.online);
    },
    [applyBotOnline],
  );

  const openAvatarSettings = useCallback((a: Agent) => {
    setAvatarSettingsAgent(a);
  }, []);

  const startChatWithAgent = useCallback(
    async (agent: Agent) => {
      setShowNewChat(false);
      chatBridgeRef.current?.onSelectAgent(agent.id);
    },
    [chatBridgeRef, setShowNewChat],
  );

  const createBotFromPopover = useCallback(
    async (input: CreateBotInput) => {
      const bridge = chatBridgeRef.current;
      const created = await createAgent({
        name: input.name,
        description: input.description,
        system_prompt: input.system_prompt,
        avatar_shape: input.avatar_shape,
        avatar_color: input.avatar_color,
        ...(input.machine_id ? { machine_id: input.machine_id } : {}),
      });
      await refreshAgents();
      setShowNewChat(false);
      setMobileView("chat");
      if (bridge) {
        bridge.snapshotViewedMessages();
        bridge.selectGenRef.current += 1;
      }
      setAgentId(created.id);
      setPendingFiles([]);
      setSending(false);
      setRunLabel("正在思考…");
      setStatus("");
      toast.success(`已创建 Bot「${created.name}」`);
      try {
        const conv = await openPrimaryConversation(created.id);
        chatScrollRef.stickToBottom = true;
        if (bridge) {
          bridge.conversationRef.current = conv;
          bridge.messagesByConvRef.current.set(conv.id, []);
        }
        bridge?.setConversation(conv);
        setMessages([]);
        setOnboardingDismissedState(false);
        saveLastActiveSelection({ kind: "agent", id: created.id });
        await refreshConversations();
        await refreshAgents();
      } catch (err) {
        if (bridge) bridge.conversationRef.current = null;
        bridge?.setConversation(null);
        setMessages([]);
        setOnboardingDismissedState(false);
        setStatus(err instanceof Error ? err.message : String(err));
      }
    },
    [
      chatBridgeRef,
      refreshAgents,
      refreshConversations,
      saveLastActiveSelection,
      setAgentId,
      setMobileView,
      setOnboardingDismissedState,
      setShowNewChat,
      setStatus,
    ],
  );

  const createGroupFromPopover = useCallback(
    async (name: string, memberIds: string[]) => {
      const ch = await createChannel(name, memberIds);
      await refreshChannels();
      setShowNewChat(false);
      toast.success(`已创建群聊「${ch.name}」（${memberIds.length} 名成员）`);
      await chatBridgeRef.current?.openChannelChat(ch.id);
      await refreshConversations();
    },
    [chatBridgeRef, refreshChannels, refreshConversations, setShowNewChat],
  );

  const removeAgent = useCallback(
    async (a: Agent, e?: MouseEvent) => {
      e?.stopPropagation();
      const bridge = chatBridgeRef.current;
      const ok = await confirm({
        title: "确定删除该会话？",
        description: `「${a.name}」删除后无法找回`,
        confirmLabel: "删除",
        cancelLabel: "取消",
        danger: true,
      });
      if (!ok) return;
      setAgentBusy(true);
      try {
        await deleteAgent(a.id);
        const list = await listAgents();
        setAgents(list);
        seedOnlineFromAgents(list);
        await refreshConversations().catch(() => {});
        if (bridge) {
          const agentKey = `agent:${a.id}`;
          for (const [convId, run] of [...bridge.runsRef.current.entries()]) {
            if (run.selectionKey === agentKey) {
              await bridge.stopCurrentRun({ markStopped: true, conversationId: convId });
            }
          }
        }
        if (agentId === a.id) {
          setAgentId(list[0]?.id ?? "");
          if (bridge) {
            bridge.conversationRef.current = null;
            bridge.setConversation(null);
          }
          setMessages([]);
          setSending(false);
          setStatus("");
        } else if (conversation?.agent_id === a.id && !conversation?.channel_id) {
          if (bridge) {
            bridge.conversationRef.current = null;
            bridge.setConversation(null);
          }
          setMessages([]);
          setSending(false);
          setStatus("");
        }
        toast.success(`已删除助手「${a.name}」`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setAgentBusy(false);
      }
    },
    [
      agentId,
      chatBridgeRef,
      confirm,
      conversation?.agent_id,
      conversation?.channel_id,
      refreshConversations,
      seedOnlineFromAgents,
      setAgentId,
      setStatus,
    ],
  );

  const removeChannel = useCallback(
    async (ch: Channel, e?: MouseEvent) => {
      e?.stopPropagation();
      const bridge = chatBridgeRef.current;
      const ok = await confirm({
        title: "确定删除该会话？",
        description: `「${ch.name}」删除后无法找回`,
        confirmLabel: "删除",
        cancelLabel: "取消",
        danger: true,
      });
      if (!ok) return;
      setChannelBusy(true);
      try {
        await deleteChannel(ch.id);
        await refreshChannels();
        const channelKey = `channel:${ch.id}`;
        if (bridge) {
          for (const [convId, run] of [...bridge.runsRef.current.entries()]) {
            if (run.selectionKey === channelKey || (ch.conversation_id && convId === ch.conversation_id)) {
              await bridge.stopCurrentRun({ markStopped: true, conversationId: convId });
            }
          }
        }
        if (conversation?.channel_id === ch.id || conversation?.id === ch.conversation_id) {
          if (bridge) {
            bridge.conversationRef.current = null;
            bridge.setConversation(null);
          }
          setMessages([]);
          setSending(false);
          setStatus("");
        }
        toast.success(`已删除群聊「${ch.name}」`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setChannelBusy(false);
      }
    },
    [chatBridgeRef, confirm, conversation?.channel_id, conversation?.id, refreshChannels, setStatus],
  );

  onSelectAgentRef.current = (id: string) => {
    chatBridgeRef.current?.onSelectAgent(id);
  };

  return {
    agents,
    setAgents,
    agentId,
    setAgentId,
    channels,
    setChannels,
    agentBusy,
    channelBusy,
    setCloneTarget,
    setGroupMembersChannel,
    setAvatarSettingsAgent,
    assistantsCollapsed,
    groupsCollapsed,
    toggleAssistantsCollapsed,
    toggleGroupsCollapsed,
    didRestoreLastActive,
    onSelectAgentRef,
    applyBotOnline,
    seedOnlineFromAgents,
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
  };
}
