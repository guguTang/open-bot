import { ChevronDown, ChevronLeft } from "lucide-react";
import { FormEvent, memo, RefObject, useEffect, useMemo, useRef } from "react";
import type { Agent, ApprovalDecision, Channel, Conversation } from "../../api";
import type { BotPresenceStatus } from "../../api";
import { normalizePresenceStatus, resolveAvatarColor, toolNameLooksLikeSearch } from "../avatarColor";
import { AgentAvatar } from "../AgentAvatar";
import { channelMemberStackClass } from "./sidebarUi";
import {
  BotOnboardingCard,
  ONBOARDING_WELCOME,
  type OnboardingOption,
} from "../BotOnboardingCard";
import { ChatMessage } from "../ChatMessage";
import { Composer, type ComposerMentionItem, type ComposerSkillOption } from "../Composer";
import { RunStatus } from "../RunStatus";
import {
  indexMessages,
  jumpToMessage,
  quoteForMessage,
  replyTargetFromMessage,
  resolveRunFaceAgent,
  speakerNameForMessage,
  threadMessages,
} from "./chatTimeline";
import { isGroupDecisionPending, resolveRunFaceAgentId } from "../../lib/runFace";
import {
  chatScrollRef,
  setInput,
  setPendingFiles,
  setReplyTarget,
  setShowScrollBottom,
  useChatStore,
} from "../../stores/chat";
import { botIsOnline, usePresenceStore } from "../../stores/presence";
import type { UiMessage } from "../../types/app-ui";

export type ChatMainProps = {
  hostActivity: string | null;
  onSystemBack: () => void;
  activeChannel: Channel | null | undefined;
  selectionHydrated: boolean;
  activeAgent: Agent | null | undefined;
  agentId: string;
  conversation: Conversation | null;
  channelMemberProfiles: (ch: Channel) => Array<{
    agent_id: string;
    name: string;
    avatar_shape?: Agent["avatar_shape"];
    avatar_color?: Agent["avatar_color"];
    online?: boolean;
  }>;
  agentNameById: Map<string, string>;
  onOpenGroupSettings: (ch: Channel) => void;
  onOpenAvatarSettings: (agent: Agent) => void;
  onOpenTrain: (agent: Agent) => void;
  onboardingDismissed: boolean;
  agents: Agent[];
  onOnboardingSelect: (opt: OnboardingOption) => void;
  onOnboardingCustom: (text: string) => void;
  onOnboardingDismiss: () => void;
  settleHostConfirm: (message: UiMessage, decision: ApprovalDecision) => void;
  hostExecPolicy: string;
  setOpenThreadRootId: (id: string | null) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  openFeedbackForMessage: (msg: UiMessage, source: "feedback_menu" | "reaction_followup") => void;
  viewingRunActive: boolean;
  onApprovalDeny: () => void;
  onApprovalAllow: () => void;
  onSubmit: (e: FormEvent) => void;
  stopCurrentRun: (opts: { markStopped: boolean }) => void;
  composerMentionItems: ComposerMentionItem[];
  composerSkills: ComposerSkillOption[];
};

function ChatMainInner(props: ChatMainProps) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  return (
    <main className="main">
      {props.hostActivity ? <div className="status host-activity">{props.hostActivity}</div> : null}
      <ChatTopbar {...props} />
      <ChatTranscript {...props} messagesRef={messagesRef} />
      <ChatComposerDock {...props} messagesRef={messagesRef} />
      <ChatScrollPin messagesRef={messagesRef} viewingRunActive={props.viewingRunActive} />
    </main>
  );
}

function ChatTopbar({
  onSystemBack,
  activeChannel,
  selectionHydrated,
  activeAgent,
  channelMemberProfiles,
  agentNameById,
  onOpenGroupSettings,
  onOpenAvatarSettings,
  onOpenTrain,
  hostActivity,
  agents,
}: ChatMainProps) {
  const presenceByAgent = usePresenceStore((s) => s.presenceByAgent);
  const onlineByAgent = usePresenceStore((s) => s.onlineByAgent);
  const runFaceAgentId = useChatStore((s) => s.runFaceAgentId);
  const runActiveTool = useChatStore((s) => s.runActiveTool);
  const searchingHintNow = toolNameLooksLikeSearch(runActiveTool) || toolNameLooksLikeSearch(hostActivity || "");
  const isOnline = (agentId?: string | null, snapshot?: boolean) =>
    botIsOnline(onlineByAgent, agents, agentId, snapshot);

  return (
    <header className="topbar">
      <button type="button" className="topbar-back" aria-label="返回" onClick={() => void onSystemBack()}>
        <ChevronLeft size={18} strokeWidth={2} aria-hidden />
        <span className="topbar-back-label">返回</span>
      </button>
      <div className="agent-pill">
        {activeChannel ? (
          <button
            type="button"
            className="agent-pill-channel"
            aria-label={`群设置 ${activeChannel.name}`}
            title="群设置"
            onClick={() => onOpenGroupSettings(activeChannel)}
          >
            <span className={channelMemberStackClass} aria-hidden>
              {channelMemberProfiles(activeChannel).map((p) => (
                <AgentAvatar
                  key={p.agent_id}
                  id={p.agent_id}
                  name={p.name}
                  size={24}
                  shape={p.avatar_shape}
                  color={p.avatar_color}
                  status={presenceByAgent[p.agent_id] || "idle"}
                  searchingHint={searchingHintNow && normalizePresenceStatus(presenceByAgent[p.agent_id]) === "working"}
                  online={isOnline(p.agent_id, p.online)}
                />
              ))}
            </span>
            <span className="agent-pill-name">{activeChannel.name}</span>
            <span className="agent-pill-members muted small" style={{ marginLeft: 8 }}>
              {(activeChannel.members || []).map((id) => agentNameById.get(id) || id).join("、")}
            </span>
          </button>
        ) : !selectionHydrated ? (
          <span className="agent-pill-name muted">加载中…</span>
        ) : (
          <>
            <AgentAvatar
              id={activeAgent?.id}
              name={activeAgent?.name ?? "助手"}
              size={28}
              shape={activeAgent?.avatar_shape}
              color={activeAgent?.avatar_color}
              status={(activeAgent && presenceByAgent[activeAgent.id]) || "idle"}
              searchingHint={Boolean(searchingHintNow && (!runFaceAgentId || runFaceAgentId === activeAgent?.id))}
              online={isOnline(activeAgent?.id)}
              onClick={activeAgent ? () => onOpenAvatarSettings(activeAgent) : undefined}
            />
            <span className="agent-pill-name">{activeAgent?.name ?? "助手"}</span>
            {activeAgent ? (
              <button
                type="button"
                className="ghost train-entry-btn"
                title="训练：确认 / 停用从反馈生成的经验"
                onClick={() => onOpenTrain(activeAgent)}
              >
                训练
              </button>
            ) : null}
          </>
        )}
      </div>
    </header>
  );
}

function ChatTranscript({
  messagesRef,
  conversation,
  agentId,
  selectionHydrated,
  onboardingDismissed,
  agents,
  onOnboardingSelect,
  onOnboardingCustom,
  onOnboardingDismiss,
  agentNameById,
  settleHostConfirm,
  hostExecPolicy,
  setOpenThreadRootId,
  onToggleReaction,
  openFeedbackForMessage,
  viewingRunActive,
  activeAgent,
  activeChannel,
  hostActivity,
}: ChatMainProps & { messagesRef: RefObject<HTMLDivElement | null> }) {
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const chatSwitchPending = useChatStore((s) => s.chatSwitchPending);
  const openThreadRootId = useChatStore((s) => s.openThreadRootId);
  const chatProcessing = sending || taskBusy || viewingRunActive;
  const indexed = useMemo(() => indexMessages(messages), [messages]);
  const openThread = useMemo(
    () => threadMessages(messages, openThreadRootId),
    [messages, openThreadRootId],
  );
  const hasChatMessages = useMemo(
    () => messages.some((m) => m.role === "user" || m.role === "assistant"),
    [messages],
  );
  const showOnboarding = Boolean(
    selectionHydrated &&
      !conversation?.channel_id &&
      !hasChatMessages &&
      !onboardingDismissed &&
      !chatProcessing &&
      !chatSwitchPending,
  );

  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    chatScrollRef.stickToBottom = near;
    setShowScrollBottom(!near);
  };

  const beginReplyTo = (m: UiMessage) => {
    setReplyTarget(replyTargetFromMessage(m, agentNameById));
  };

  return (
    <>
      <div
        className="messages"
        key={conversation?.id ?? agentId ?? "none"}
        ref={messagesRef}
        onScroll={onMessagesScroll}
      >
        {!selectionHydrated || (chatSwitchPending && messages.length === 0) ? (
          <div className="empty">
            <p className="muted">加载中…</p>
          </div>
        ) : showOnboarding ? (
          <>
            {ONBOARDING_WELCOME.map((text, i) => (
              <ChatMessage
                key={`onboard-welcome-${i}`}
                message={{ id: `onboard-welcome-${i}`, role: "assistant", content: text }}
              />
            ))}
            <BotOnboardingCard
              disabled={chatProcessing}
              onSelectOption={(opt) => onOnboardingSelect(opt)}
              onCustomSubmit={(customText) => onOnboardingCustom(customText)}
              onDismiss={onOnboardingDismiss}
            />
          </>
        ) : messages.length === 0 ? (
          <div className="empty">
            <h2>有什么可以帮你的？</h2>
            <p>
              {agents.length === 0
                ? "暂无助手，点击左上角「+」创建一个。"
                : "从左侧选择一位助手进入连续对话；群聊里可用 @ 点名助手。回复经 Go API 流式代理到 Python runtime。"}
            </p>
          </div>
        ) : null}
        {indexed.mainTimeline.map((m) => (
          <ChatMessage
            key={m.id}
            message={m}
            agentId={m.agent_id || agentId}
            speakerName={speakerNameForMessage(m, conversation?.channel_id, agentNameById)}
            onHostDecide={m.role === "host_confirm" ? (d) => settleHostConfirm(m, d) : undefined}
            alwaysAllowEnabled={hostExecPolicy !== "ask"}
            replyQuote={quoteForMessage(m, indexed.messageById, agentNameById)}
            replyCount={indexed.replyCountByRoot.get(m.id) || 0}
            onReply={beginReplyTo}
            onOpenThread={(rootId) => setOpenThreadRootId(rootId)}
            onJumpToParent={(pid) => {
              const parent = indexed.messageById.get(pid);
              if (parent?.thread_root_id) {
                setOpenThreadRootId(parent.thread_root_id);
                window.setTimeout(() => jumpToMessage(pid), 50);
              } else {
                jumpToMessage(pid);
              }
            }}
            onToggleReaction={onToggleReaction}
            onFeedback={(msg) => openFeedbackForMessage(msg, "feedback_menu")}
            onNegativeReaction={(msg) => openFeedbackForMessage(msg, "reaction_followup")}
          />
        ))}
        {chatProcessing && !messages.some((m) => m.role === "assistant" && m.streaming && m.content) ? (
          <LiveRunStatus
            activeAgent={activeAgent}
            activeChannel={activeChannel}
            agents={agents}
            agentNameById={agentNameById}
            viewingRunActive={viewingRunActive}
            hostActivity={hostActivity}
          />
        ) : null}
      </div>

      {openThreadRootId ? (
        <div className="thread-panel" role="dialog" aria-label="对话线程">
          <div className="thread-panel-head">
            <div className="thread-panel-title">线程</div>
            <button type="button" className="thread-panel-close" onClick={() => setOpenThreadRootId(null)}>
              关闭
            </button>
          </div>
          <div className="thread-panel-body">
            {openThread.map((m) => (
              <ChatMessage
                key={`thread-${m.id}`}
                message={m}
                agentId={m.agent_id || agentId}
                speakerName={speakerNameForMessage(m, conversation?.channel_id, agentNameById)}
                dense
                replyQuote={quoteForMessage(m, indexed.messageById, agentNameById)}
                onReply={beginReplyTo}
                onJumpToParent={(pid) => jumpToMessage(pid)}
                onHostDecide={m.role === "host_confirm" ? (d) => settleHostConfirm(m, d) : undefined}
                alwaysAllowEnabled={hostExecPolicy !== "ask"}
                onToggleReaction={onToggleReaction}
                onFeedback={(msg) => openFeedbackForMessage(msg, "feedback_menu")}
                onNegativeReaction={(msg) => openFeedbackForMessage(msg, "reaction_followup")}
              />
            ))}
            {openThread.length === 0 ? (
              <p className="muted small" style={{ padding: "12px 16px" }}>
                暂无回复
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function LiveRunStatus({
  activeAgent,
  activeChannel,
  agents,
  agentNameById,
  viewingRunActive,
  hostActivity,
}: {
  activeAgent: Agent | null | undefined;
  activeChannel: Channel | null | undefined;
  agents: Agent[];
  agentNameById: Map<string, string>;
  viewingRunActive: boolean;
  hostActivity: string | null;
}) {
  const runLabel = useChatStore((s) => s.runLabel);
  const runActiveTool = useChatStore((s) => s.runActiveTool);
  const runFaceAgentId = useChatStore((s) => s.runFaceAgentId);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const inGroupChat = Boolean(activeChannel);
  const runLive = sending || taskBusy || viewingRunActive;
  /**
   * Group AutoPick / decision window: run live, no agent_start yet.
   * Do not paint list-focus activeAgent — that looks like a random member answering.
   */
  const groupDecisionPending = isGroupDecisionPending({
    isGroup: inGroupChat,
    faceAgentId: runFaceAgentId,
    runLive,
  });
  const faceId =
    resolveRunFaceAgentId(runFaceAgentId, {
      isGroup: inGroupChat,
      activeAgentId: activeAgent?.id,
    }) || "";
  const fromSse = usePresenceStore((s) =>
    normalizePresenceStatus(faceId ? s.presenceByAgent[faceId] : undefined),
  );
  let runStatusFace: BotPresenceStatus = groupDecisionPending ? "working" : fromSse;
  if (!groupDecisionPending && runStatusFace === "idle") {
    if (runLive) runStatusFace = runActiveTool ? "working" : "thinking";
  }
  const runFaceAgent = resolveRunFaceAgent(runFaceAgentId, activeAgent, agents, activeChannel, agentNameById);
  const searchingHintNow = toolNameLooksLikeSearch(runActiveTool) || toolNameLooksLikeSearch(hostActivity || "");
  return (
    <RunStatus
      label={taskBusy && !sending && !viewingRunActive ? runLabel || "正在做…" : runLabel || "正在思考…"}
      agentId={runFaceAgent?.id}
      agentName={runFaceAgent?.name ?? (groupDecisionPending ? "选人中" : "助手")}
      shape={runFaceAgent?.avatar_shape}
      avatarColor={runFaceAgent?.avatar_color}
      color={resolveAvatarColor(
        runFaceAgent?.id || runFaceAgent?.name || (groupDecisionPending ? "open-bot-group-pick" : "open-bot"),
        runFaceAgent?.avatar_color,
      )}
      status={runStatusFace}
      searchingHint={searchingHintNow || groupDecisionPending}
    />
  );
}

function ChatComposerDock({
  messagesRef,
  conversation,
  activeChannel,
  activeAgent,
  onSubmit,
  stopCurrentRun,
  composerMentionItems,
  composerSkills,
  viewingRunActive,
  onApprovalDeny,
  onApprovalAllow,
}: ChatMainProps & { messagesRef: RefObject<HTMLDivElement | null> }) {
  const input = useChatStore((s) => s.input);
  const pendingFiles = useChatStore((s) => s.pendingFiles);
  const replyTarget = useChatStore((s) => s.replyTarget);
  const approvalGate = useChatStore((s) => s.approvalGate);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const showScrollBottom = useChatStore((s) => s.showScrollBottom);
  const chatProcessing = sending || taskBusy || viewingRunActive;

  const scrollToBottom = (smooth = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
    chatScrollRef.stickToBottom = true;
    setShowScrollBottom(false);
  };

  return (
    <div className="composer-wrap">
      {approvalGate && conversation?.id === approvalGate.conversationId ? (
        <div className="approval-gate-card" role="status">
          <span className="approval-gate-text">工具需要你确认后才能继续</span>
          <div className="approval-gate-actions">
            <button type="button" className="btn-secondary" onClick={onApprovalDeny}>
              拒绝
            </button>
            <button type="button" className="btn-primary" onClick={onApprovalAllow}>
              批准
            </button>
          </div>
        </div>
      ) : null}
      {showScrollBottom ? (
        <button type="button" className="scroll-bottom-btn" title="滚到底部" onClick={() => scrollToBottom(true)}>
          <ChevronDown size={16} strokeWidth={2.2} aria-hidden />
        </button>
      ) : null}
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={onSubmit}
        onStop={() => stopCurrentRun({ markStopped: true })}
        sending={chatProcessing}
        agentName={activeChannel ? activeChannel.name : activeAgent?.name}
        files={pendingFiles}
        onFilesChange={setPendingFiles}
        mentionItems={composerMentionItems}
        skillOptions={composerSkills}
        groupChat={Boolean(activeChannel)}
        replyTo={replyTarget}
        onClearReply={() => setReplyTarget(null)}
      />
    </div>
  );
}

function ChatScrollPin({
  messagesRef,
  viewingRunActive,
}: {
  messagesRef: RefObject<HTMLDivElement | null>;
  viewingRunActive: boolean;
}) {
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const runLabel = useChatStore((s) => s.runLabel);
  useEffect(() => {
    if (!chatScrollRef.stickToBottom) {
      setShowScrollBottom(true);
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = messagesRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      chatScrollRef.stickToBottom = true;
      setShowScrollBottom(false);
    });
    return () => cancelAnimationFrame(id);
  }, [messages, sending, taskBusy, runLabel, viewingRunActive, messagesRef]);
  return null;
}

export const ChatMain = memo(ChatMainInner);
