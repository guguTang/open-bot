import { type RefObject, useLayoutEffect, useRef } from "react";
import { pinStick } from "../../../lib/scrollStick";
import { applyScrollStick, chatScrollRef, pinChatScroll, useChatStore } from "../../../stores/chat";
import { useWorkspaceStore } from "../../../stores/workspace";

/**
 * 会话列表是反向列，新节点的 scrollTop 0 就是底部。
 * 切换时不要改 scrollTop，否则会从顶部滚下去。
 * 用户已经往上翻时，内容变高要补回位移，阅读位置保持不动。
 */
export function useChatScrollPin(messagesRef: RefObject<HTMLDivElement | null>) {
  const conversationId = useWorkspaceStore((s) => s.conversation?.id ?? "");
  const viewingRunActive = useWorkspaceStore((s) => s.viewingRunActive);
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const runLabel = useChatStore((s) => s.runLabel);
  const prevHeight = useRef(0);
  const prevConversationId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const switched = prevConversationId.current !== conversationId;
    prevConversationId.current = conversationId;
    if (switched) {
      pinChatScroll();
      prevHeight.current = el.scrollHeight;
      return;
    }
    if (chatScrollRef.stickToBottom) {
      if (el.scrollTop !== 0) {
        chatScrollRef.suppressStick = true;
        el.scrollTop = 0;
        chatScrollRef.suppressStick = false;
      }
      applyScrollStick(pinStick());
    } else {
      const growth = el.scrollHeight - prevHeight.current;
      if (prevHeight.current > 0 && growth !== 0) {
        chatScrollRef.suppressStick = true;
        el.scrollTop -= growth;
        chatScrollRef.suppressStick = false;
      }
    }
    prevHeight.current = el.scrollHeight;
  }, [messages, conversationId, sending, taskBusy, runLabel, viewingRunActive, messagesRef]);
}
