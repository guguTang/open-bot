import { threadMessages } from "../chatTimeline";
import { jumpToMessage } from "../jumpToMessage";
import { useChatStore } from "../../../stores/chat";
import { chatSessionActions } from "../../../stores/sessionActions";
import { TranscriptMessage, type TranscriptWire } from "./TranscriptMessage";

export function ChatThreadPanel({ wire }: { wire: TranscriptWire }) {
  const messages = useChatStore((s) => s.messages);
  const openThreadRootId = useChatStore((s) => s.openThreadRootId);
  const openThread = threadMessages(messages, openThreadRootId);
  if (!openThreadRootId) return null;

  const chat = chatSessionActions();
  return (
    <dialog open className="thread-panel" aria-label="对话线程">
      <div className="thread-panel-head">
        <div className="thread-panel-title">线程</div>
        <button type="button" className="thread-panel-close" onClick={() => chat.setOpenThreadRootId(null)}>
          关闭
        </button>
      </div>
      <div className="thread-panel-body">
        {openThread.map((message) => (
          <TranscriptMessage
            key={`thread-${message.id}`}
            message={message}
            wire={wire}
            dense
            onJumpToParent={(parentId) => jumpToMessage(parentId)}
          />
        ))}
        {openThread.length === 0 ? (
          <p className="muted small" style={{ padding: "12px 16px" }}>
            暂无回复
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
