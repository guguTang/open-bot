import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  applyAgentOnboarding,
  approveConversationRun,
  createMessageFeedback,
  toggleReaction,
  type Agent,
  type Channel,
  type Conversation,
  type ReactionUpdatedEvent,
} from "../api";
import { type FeedbackTarget } from "../components/feedbackModalTypes";
import {
  isOnboardingDismissed,
  onboardingStorageKey,
  setOnboardingDismissed,
  type OnboardingOption,
} from "../components/botOnboarding";
import type { SettingsTab } from "../types/app-ui";
import { chatState, setApprovalGate, setMessages, setRunLabel, viewedMessages } from "../stores/chat";
import { patchShell, setShell, shellState } from "../stores/shell";
import type { SendUserTextFn } from "./chat/useChatTurn";

export type { SendUserTextFn };

export type UseAppChatSessionParams = {
  agentId: string;
  agents: Agent[];
  conversation: Conversation | null;
  refreshAgents: () => Promise<unknown>;
  setStatus: (msg: string) => void;
  /** Resolved after chat controller mounts; onboarding handlers read via ref. */
  getSendUserText: () => SendUserTextFn | null;
  getOnSelectAgent: () => ((id: string) => void | Promise<void>) | null;
  getOpenChannelChat: () => ((id: string) => void | Promise<void>) | null;
  removeAgent: (a: Agent, e?: MouseEvent) => void | Promise<void>;
  removeChannel: (ch: Channel, e?: MouseEvent) => void | Promise<void>;
  openSettings: (tab?: SettingsTab) => void;
};

export function useAppChatSession(p: UseAppChatSessionParams) {
  const {
    agentId,
    agents,
    conversation,
    refreshAgents,
    setStatus,
    getSendUserText,
    getOnSelectAgent,
    getOpenChannelChat,
    removeAgent,
    removeChannel,
    openSettings,
  } = p;

  const newChatBtnRef = useRef<HTMLButtonElement>(null);

  const getSendUserTextRef = useRef(getSendUserText);
  const getOnSelectAgentRef = useRef(getOnSelectAgent);
  const getOpenChannelChatRef = useRef(getOpenChannelChat);
  useLayoutEffect(() => {
    getSendUserTextRef.current = getSendUserText;
    getOnSelectAgentRef.current = getOnSelectAgent;
    getOpenChannelChatRef.current = getOpenChannelChat;
  });

  const applyReactionEvent = useCallback((evt: ReactionUpdatedEvent) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== evt.message_id) return m;
        const list = [...(m.reactions || [])];
        const idx = list.findIndex((r) => r.emoji === evt.emoji);
        if (evt.count <= 0) {
          if (idx >= 0) list.splice(idx, 1);
        } else if (idx >= 0) {
          list[idx] = { emoji: evt.emoji, count: evt.count, me: Boolean(evt.me) };
        } else {
          list.push({ emoji: evt.emoji, count: evt.count, me: Boolean(evt.me) });
        }
        return { ...m, reactions: list };
      }),
    );
  }, []);

  const onToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const prevSnapshot = viewedMessages().find((m) => m.id === messageId)?.reactions;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const list = [...(m.reactions || [])];
          const idx = list.findIndex((r) => r.emoji === emoji);
          if (idx >= 0) {
            const cur = list[idx];
            if (cur.me) {
              const nextCount = cur.count - 1;
              if (nextCount <= 0) list.splice(idx, 1);
              else list[idx] = { ...cur, count: nextCount, me: false };
            } else {
              list[idx] = { ...cur, count: cur.count + 1, me: true };
            }
          } else {
            list.push({ emoji, count: 1, me: true });
          }
          return { ...m, reactions: list };
        }),
      );
      try {
        const evt = await toggleReaction(messageId, emoji);
        applyReactionEvent(evt);
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: prevSnapshot } : m)),
        );
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [applyReactionEvent],
  );

  const openFeedbackForMessage = useCallback(
    (message: { id: string; agent_id?: string; agent_name?: string }, source: FeedbackTarget["source"]) => {
      const convId = conversation?.id || "";
      const aid = message.agent_id || agentId;
      if (!convId || !aid) {
        toast.error("无法定位这条回复所属的会话或 Bot");
        return;
      }
      const agent = agents.find((a) => a.id === aid);
      patchShell({
        feedbackTarget: {
          messageId: message.id,
          agentId: aid,
          agentName: agent?.name || message.agent_name || "Bot",
          conversationId: convId,
          polarity: "negative",
          source,
        },
      });
    },
    [agentId, agents, conversation?.id],
  );

  const submitFeedback = useCallback(
    async (input: {
      polarity: FeedbackTarget["polarity"];
      reasons: string[];
      note: string;
      source: FeedbackTarget["source"];
    }) => {
      const target = shellState().feedbackTarget;
      if (!target) return;
      await createMessageFeedback({
        message_id: target.messageId,
        agent_id: target.agentId,
        conversation_id: target.conversationId,
        polarity: input.polarity,
        reasons: input.reasons,
        note: input.note,
        source: input.source,
      });
      setShell("trainReload", (n) => n + 1);
      toast.success("已提交反馈，已生成待确认经验（在「训练」里确认后才生效）");
    },
    [],
  );

  const onboardingKey = useMemo(
    () => onboardingStorageKey(conversation?.id, agentId),
    [conversation?.id, agentId],
  );

  useEffect(() => {
    patchShell({ onboardingDismissed: isOnboardingDismissed(onboardingKey) });
  }, [onboardingKey]);

  const setOnboardingDismissedState = useCallback((v: boolean) => {
    patchShell({ onboardingDismissed: v });
  }, []);

  const onOnboardingSelect = useCallback(
    (opt: OnboardingOption) => {
      void (async () => {
        try {
          if (agentId) {
            await applyAgentOnboarding(agentId, { focus: opt.letter });
            await refreshAgents();
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
        const send = getSendUserTextRef.current();
        if (send) void send(opt.prompt, []);
      })();
    },
    [agentId, refreshAgents],
  );

  const onOnboardingCustom = useCallback(
    (customText: string) => {
      void (async () => {
        try {
          if (agentId) {
            await applyAgentOnboarding(agentId, {
              focus: "E",
              description: customText.slice(0, 400),
              system_prompt: `用户自定义方向：${customText}`,
            });
            await refreshAgents();
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
        const send = getSendUserTextRef.current();
        if (send) void send(customText, []);
      })();
    },
    [agentId, refreshAgents],
  );

  const onOnboardingDismiss = useCallback(() => {
    setOnboardingDismissed(onboardingKey);
    patchShell({ onboardingDismissed: true });
  }, [onboardingKey]);

  const onApprovalDeny = useCallback(() => {
    const gate = chatState().approvalGate;
    if (!gate) return;
    void approveConversationRun(gate.conversationId, gate.requestId, false, "user_rejected", {
      decision: "deny",
    })
      .then(() => setApprovalGate(null))
      .catch((err) => setStatus(`拒绝失败：${err instanceof Error ? err.message : String(err)}`));
  }, [setStatus]);

  const onApprovalAllow = useCallback(() => {
    const gate = chatState().approvalGate;
    if (!gate) return;
    void approveConversationRun(gate.conversationId, gate.requestId, true, "", { decision: "allow_once" })
      .then(() => {
        setApprovalGate(null);
        setRunLabel("正在继续…");
      })
      .catch((err) => setStatus(`批准失败：${err instanceof Error ? err.message : String(err)}`));
  }, [setStatus]);

  const onToggleCreateSheet = useCallback(() => {
    const { showNewChat, createSheetOpen } = shellState();
    if (showNewChat) {
      patchShell({ showNewChat: false });
      return;
    }
    patchShell({ createSheetOpen: !createSheetOpen });
  }, []);

  const onOpenNewChatList = useCallback(() => {
    patchShell({ newChatInitialMode: "list", showNewChat: !shellState().showNewChat });
  }, []);

  const onSelectAgentSync = useCallback((id: string) => {
    const fn = getOnSelectAgentRef.current();
    if (fn) void fn(id);
  }, []);
  const onOpenChannelChatSync = useCallback((id: string) => {
    const fn = getOpenChannelChatRef.current();
    if (fn) void fn(id);
  }, []);
  const onRemoveAgentSync = useCallback(
    (a: Agent, e?: MouseEvent) => void removeAgent(a, e),
    [removeAgent],
  );
  const onRemoveChannelSync = useCallback(
    (ch: Channel, e?: MouseEvent) => void removeChannel(ch, e),
    [removeChannel],
  );
  const onOpenBotSettingsFromSidebar = useCallback(
    (id: string) => {
      const fn = getOnSelectAgentRef.current();
      if (fn) void fn(id);
      void openSettings("bot");
    },
    [openSettings],
  );

  return {
    applyReactionEvent,
    setOnboardingDismissedState,
    newChatBtnRef,
    submitFeedback,
    onToggleCreateSheet,
    onOpenNewChatList,
    onSelectAgentSync,
    onOpenChannelChatSync,
    onRemoveAgentSync,
    onRemoveChannelSync,
    onOpenBotSettingsFromSidebar,
    onOnboardingSelect,
    onOnboardingCustom,
    onOnboardingDismiss,
    onToggleReaction,
    openFeedbackForMessage,
    onApprovalDeny,
    onApprovalAllow,
  };
}

export type AppChatSessionBundle = ReturnType<typeof useAppChatSession>;
