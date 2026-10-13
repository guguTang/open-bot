import { type RefObject, useEffect } from "react";
import { pinStick, stickAfterContentChange } from "../../../lib/scrollStick";
import { applyScrollStick, chatScrollRef, setShowScrollBottom, useChatStore } from "../../../stores/chat";
import { useWorkspaceStore } from "../../../stores/workspace";

/** 内容变化后，如果用户本来贴在底部，就把消息区重新钉住。 */
export function useChatScrollPin(messagesRef: RefObject<HTMLDivElement | null>) {
  const viewingRunActive = useWorkspaceStore((s) => s.viewingRunActive);
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const runLabel = useChatStore((s) => s.runLabel);
  useEffect(() => {
    const decision = stickAfterContentChange(chatScrollRef.stickToBottom);
    if (!decision.scroll) {
      setShowScrollBottom(decision.showScrollBottom);
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = messagesRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
      applyScrollStick(pinStick());
    });
    return () => cancelAnimationFrame(id);
  }, [messages, sending, taskBusy, runLabel, viewingRunActive, messagesRef]);
}
