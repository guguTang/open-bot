import type { Agent } from "../../../api";
import { quoteForMessage, replyTargetFromMessage, speakerFaceForMessage, speakerNameForMessage } from "../chatTimeline";
import { ChatMessage } from "../../ChatMessage";
import { setReplyTarget } from "../../../stores/chat";
import { chatSessionActions } from "../../../stores/sessionActions";
import type { UiMessage } from "../../../types/app-ui";

/** 时间线和线程共用的消息接线：引用、回复、确认、反应、反馈。 */
export type TranscriptWire = {
  agentNameById: Map<string, string>;
  messageById: Map<string, UiMessage>;
  channelId?: string;
  conversationAgentId?: string;
  agents: Agent[];
  fallbackAgentId?: string;
  alwaysAllowEnabled: boolean;
};

export function TranscriptMessage({
  message,
  wire,
  dense,
  replyCount,
  onOpenThread,
  onJumpToParent,
}: {
  message: UiMessage;
  wire: TranscriptWire;
  dense?: boolean;
  replyCount?: number;
  onOpenThread?: (rootId: string) => void;
  onJumpToParent?: (parentId: string) => void;
}) {
  const chat = chatSessionActions();
  return (
    <ChatMessage
      message={message}
      agentId={message.agent_id || wire.fallbackAgentId}
      speakerName={speakerNameForMessage(message, wire.channelId, wire.agentNameById, wire.conversationAgentId)}
      speakerFace={speakerFaceForMessage(
        message,
        { channel_id: wire.channelId, agent_id: wire.conversationAgentId },
        wire.agents,
      )}
      dense={dense}
      alwaysAllowEnabled={wire.alwaysAllowEnabled}
      replyQuote={quoteForMessage(message, wire.messageById, wire.agentNameById)}
      replyCount={replyCount}
      onReply={(target) => setReplyTarget(replyTargetFromMessage(target, wire.agentNameById))}
      onOpenThread={onOpenThread}
      onJumpToParent={onJumpToParent}
      onHostDecide={message.role === "host_confirm" ? (decision) => chat.settleHostConfirm(message, decision) : undefined}
      onToggleReaction={(messageId, emoji) => void chat.onToggleReaction(messageId, emoji)}
      onFeedback={(msg) => chat.openFeedbackForMessage(msg, "feedback_menu")}
      onNegativeReaction={(msg) => chat.openFeedbackForMessage(msg, "reaction_followup")}
    />
  );
}
