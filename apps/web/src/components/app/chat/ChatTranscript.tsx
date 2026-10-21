/**
 * Message feed scroller.
 *
 * Pro ChatConversation auto-scroll + ScrollAnchor assume a normal top→bottom
 * scrollport. This app uses flex-direction:column-reverse stick-to-bottom
 * (see styles.css .messages + useChatScrollPin). Replacing the scroller would
 * break pin behaviour and OpenUI streaming. Keep the reverse scroller; jump-to-
 * bottom lives in ChatComposerDock (HeroUI Button).
 */
import { type RefObject, useMemo } from "react";
import { agentNameMap } from "../../../lib/app/workspaceDerived";
import { stickFromReverseScroll } from "../../../lib/scrollStick";
import { applyScrollStick, chatScrollRef, useChatStore } from "../../../stores/chat";
import { chatSessionActions } from "../../../stores/sessionActions";
import { useShellStore } from "../../../stores/shell";
import { useWorkspaceStore } from "../../../stores/workspace";
import { jumpToMessage } from "../jumpToMessage";
import { isChatProcessing, resolveTranscriptView } from "../transcriptView";
import { ChatThreadPanel } from "./ChatThreadPanel";
import { ChatTranscriptBanner } from "./ChatTranscriptBanner";
import { LiveRunStatus } from "./LiveRunStatus";
import { TranscriptMessage, type TranscriptWire } from "./TranscriptMessage";

export function ChatTranscript({ messagesRef }: { messagesRef: RefObject<HTMLDivElement | null> }) {
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const selectionHydrated = useWorkspaceStore((s) => s.selectionHydrated);
  const viewingRunActive = useWorkspaceStore((s) => s.viewingRunActive);
  const hostExecPolicy = useWorkspaceStore((s) => s.hostExecPolicy);
  const onboardingDismissed = useShellStore((s) => s.onboardingDismissed);
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const chatSwitchPending = useChatStore((s) => s.chatSwitchPending);

  const agentNameById = useMemo(() => agentNameMap(agents), [agents]);
  const chatProcessing = isChatProcessing({ sending, taskBusy, viewingRunActive });
  const view = useMemo(
    () =>
      resolveTranscriptView({
        selectionHydrated,
        chatSwitchPending,
        channelId: conversation?.channel_id,
        onboardingDismissed,
        chatProcessing,
        messages,
      }),
    [selectionHydrated, chatSwitchPending, conversation?.channel_id, onboardingDismissed, chatProcessing, messages],
  );
  const wire = useMemo<TranscriptWire>(
    () => ({
      agentNameById,
      messageById: view.indexed.messageById,
      channelId: conversation?.channel_id,
      conversationAgentId: conversation?.agent_id,
      agents,
      fallbackAgentId: agentId,
      alwaysAllowEnabled: hostExecPolicy !== "ask",
    }),
    [agentNameById, view.indexed.messageById, conversation?.channel_id, conversation?.agent_id, agents, agentId, hostExecPolicy],
  );

  const onMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el || chatScrollRef.suppressStick) return;
    applyScrollStick(stickFromReverseScroll(el.scrollTop));
  };

  const jumpFromTimeline = (parentId: string) => {
    const parent = view.indexed.messageById.get(parentId);
    if (parent?.thread_root_id) {
      chatSessionActions().setOpenThreadRootId(parent.thread_root_id);
      window.setTimeout(() => jumpToMessage(parentId), 50);
      return;
    }
    jumpToMessage(parentId);
  };

  return (
    <>
      <div
        className="messages"
        key={conversation?.id ?? agentId ?? "none"}
        ref={messagesRef}
        onScroll={onMessagesScroll}
      >
        <div className="messages-column chat-conversation__content">
          {view.banner ? <ChatTranscriptBanner banner={view.banner} chatProcessing={chatProcessing} /> : null}
          {view.indexed.mainTimeline.map((message) => (
            <TranscriptMessage
              key={message.id}
              message={message}
              wire={wire}
              replyCount={view.indexed.replyCountByRoot.get(message.id) || 0}
              onOpenThread={(rootId) => chatSessionActions().setOpenThreadRootId(rootId)}
              onJumpToParent={jumpFromTimeline}
            />
          ))}
          {view.showLiveRun ? <LiveRunStatus /> : null}
        </div>
      </div>
      <ChatThreadPanel wire={wire} />
    </>
  );
}
