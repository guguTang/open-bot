import { useCallback, useRef } from "react";
import { toast } from "@/lib/toast";
import {
  listMessagesWithStatus,
  openChannelConversation,
  openPrimaryConversation,
  type Agent,
  type Channel,
  type Conversation,
  type Message,
} from "../../api";
import type { LastActiveSelection } from "../../types/app-ui";
import type { MessagesByConv, PatchConvMessages } from "../../lib/app/conversationMessages";
import {
  pinChatScroll,
  setChatSwitchPending,
  setMessages,
  setPendingFiles,
  setReplyTarget,
  setRunActiveTool,
  setRunFaceAgentId,
  setRunLabel,
  setSending,
  setTaskBusy,
  replyTargetRef,
} from "../../stores/chat";
import type { ConvRunState } from "../../types/app-ui";

export function useConversationSelection(deps: {
  agents: Agent[];
  channels: Channel[];
  agentId: string;
  setAgentId: (id: string) => void;
  setMobileView: (v: "list" | "chat") => void;
  setStatus: (s: string) => void;
  conversationRef: React.RefObject<Conversation | null>;
  setConversation: (c: Conversation | null) => void;
  messagesByConvRef: React.RefObject<MessagesByConv>;
  patchConvMessages: PatchConvMessages;
  snapshotViewedMessages: () => void;
  runsRef: React.RefObject<Map<string, ConvRunState>>;
  taskConvIdsRef: React.RefObject<Set<string>>;
  noteTask: (convId: string, active: boolean, label?: string) => void;
  applyBotOnline: (id: string, on: boolean) => void;
  saveLastActiveSelection: (selection: LastActiveSelection) => void;
  refreshAgents: () => Promise<Agent[]>;
  refreshChannels: () => Promise<Channel[]>;
  resumeActiveRun: (conv: Conversation, nameLookup: Map<string, string> | Agent[]) => Promise<void>;
  mapApiMessages: (msgs: Message[], nameLookup: Map<string, string> | Agent[]) => ReturnType<
    typeof import("../../lib/app/conversationRuns").mapApiMessages
  >;
  agentNameById: Map<string, string>;
  setOpenThreadRootId: (id: string | null) => void;
}) {
  const selectGenRef = useRef(0);

  const applyConversationView = useCallback(
    (conv: Conversation, apiMsgs?: Message[], nameLookup?: Map<string, string> | Agent[]) => {
      pinChatScroll();
      // Sync ref immediately so in-flight tokens for the previous conv cannot paint into this view.
      deps.conversationRef.current = conv;
      deps.setConversation(conv);
      // Session-host green dot: stamp from this conversation's participants.
      for (const p of conv.participants ?? []) {
        if (p.agent_id && typeof p.online === "boolean") {
          deps.applyBotOnline(p.agent_id, p.online);
        }
      }
      replyTargetRef.current = null;
      setReplyTarget(null);
      deps.setOpenThreadRootId(null);
      setChatSwitchPending(false);
      const activeRun = deps.runsRef.current.get(conv.id);
      if (activeRun) {
        const buffered = deps.messagesByConvRef.current.get(conv.id) ?? [];
        setMessages(buffered);
        setSending(true);
        setRunLabel(activeRun.runLabel || "正在思考…");
        setRunActiveTool(activeRun.activeTool || "");
        setRunFaceAgentId(activeRun.faceAgentId || "");
        return;
      }
      setSending(false);
      setRunLabel("正在思考…");
      setRunActiveTool("");
      setRunFaceAgentId("");
      if (apiMsgs) {
        const mapped = deps.mapApiMessages(apiMsgs, nameLookup ?? deps.agents);
        deps.messagesByConvRef.current.set(conv.id, mapped);
        setMessages(mapped);
      } else {
        // Never leave the previous conversation's bubbles on screen when apiMsgs was omitted.
        const cached = deps.messagesByConvRef.current.get(conv.id) ?? [];
        setMessages(cached);
      }
    },
    [deps],
  );

  const onSelectAgent = useCallback(
    async (id: string) => {
      deps.snapshotViewedMessages();
      const selectGen = ++selectGenRef.current;
      // Hide Stop for the previous run while the target chat loads; do not cancel it.
      setSending(false);
      setRunLabel("正在思考…");
      deps.setMobileView("chat");
      deps.setAgentId(id);
      setPendingFiles([]);
      deps.setStatus("");
      // Drop previous conv immediately so stream patches cannot re-paint old bubbles under the new header.
      pinChatScroll();
      setChatSwitchPending(true);
      deps.conversationRef.current = null;
      deps.setConversation(null);
      replyTargetRef.current = null;
      setReplyTarget(null);
      deps.setOpenThreadRootId(null);
      const agentEntry = deps.agents.find((a) => a.id === id);
      const cachedConvId = (agentEntry?.conversation_id || "").trim();
      const cachedMsgs = cachedConvId ? deps.messagesByConvRef.current.get(cachedConvId) : undefined;
      if (cachedMsgs) {
        setMessages(cachedMsgs);
      } else {
        setMessages([]);
      }
      try {
        const conv = await openPrimaryConversation(id);
        if (selectGen !== selectGenRef.current) return;
        deps.conversationRef.current = conv;
        const activeRun = deps.runsRef.current.get(conv.id);
        let apiMsgs: Message[] | undefined;
        let runActive = false;
        if (!activeRun) {
          const listed = await listMessagesWithStatus(conv.id);
          if (selectGen !== selectGenRef.current) return;
          apiMsgs = listed.messages;
          runActive = Boolean(listed.run_active);
          deps.noteTask(conv.id, Boolean(listed.task_active), listed.task_active ? "正在做…" : undefined);
        } else {
          setTaskBusy(deps.taskConvIdsRef.current.has(conv.id));
        }
        applyConversationView(conv, apiMsgs, deps.agents);
        deps.saveLastActiveSelection({ kind: "agent", id });
        void deps.refreshAgents().catch(() => {});
        if (!activeRun && runActive) {
          void deps.resumeActiveRun(conv, deps.agents);
        }
      } catch (err) {
        if (selectGen !== selectGenRef.current) return;
        deps.conversationRef.current = null;
        deps.setConversation(null);
        setMessages([]);
        setChatSwitchPending(false);
        setSending(false);
        deps.setStatus(err instanceof Error ? err.message : String(err));
      }
    },
    [applyConversationView, deps],
  );

  const openChannelChat = useCallback(
    async (channelId: string) => {
      try {
        deps.snapshotViewedMessages();
        const selectGen = ++selectGenRef.current;
        setSending(false);
        setRunLabel("正在思考…");
        deps.setMobileView("chat");
        pinChatScroll();
        setChatSwitchPending(true);
        // Drop previous conv immediately so old bubbles cannot linger under the new channel header.
        deps.conversationRef.current = null;
        deps.setConversation(null);
        replyTargetRef.current = null;
        setReplyTarget(null);
        deps.setOpenThreadRootId(null);
        const channelEntry = deps.channels.find((c) => c.id === channelId);
        const cachedConvId = (channelEntry?.conversation_id || "").trim();
        const cachedMsgs = cachedConvId ? deps.messagesByConvRef.current.get(cachedConvId) : undefined;
        if (cachedMsgs) {
          setMessages(cachedMsgs);
        } else {
          setMessages([]);
        }
        setPendingFiles([]);
        deps.setStatus("");
        const { conversation: conv } = await openChannelConversation(channelId);
        if (selectGen !== selectGenRef.current) return;
        deps.conversationRef.current = conv;
        deps.setAgentId(conv.agent_id);
        const activeRun = deps.runsRef.current.get(conv.id);
        let apiMsgs: Message[] | undefined;
        let runActive = false;
        if (!activeRun) {
          const listed = await listMessagesWithStatus(conv.id);
          if (selectGen !== selectGenRef.current) return;
          apiMsgs = listed.messages;
          runActive = Boolean(listed.run_active);
          deps.noteTask(conv.id, Boolean(listed.task_active), listed.task_active ? "正在做…" : undefined);
        } else {
          setTaskBusy(deps.taskConvIdsRef.current.has(conv.id));
        }
        applyConversationView(conv, apiMsgs, deps.agentNameById);
        deps.saveLastActiveSelection({ kind: "channel", id: channelId });
        await deps.refreshChannels();
        if (!activeRun && runActive) {
          void deps.resumeActiveRun(conv, deps.agentNameById);
        }
      } catch (err) {
        setChatSwitchPending(false);
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [applyConversationView, deps],
  );

  return {
    selectGenRef,
    onSelectAgent,
    openChannelChat,
    applyConversationView,
  };
}
