import { useCallback, useEffect, useState } from "react";
import { REACTION_EMOJIS } from "../api";
import { OPENBOT_SYSTEM_BACK_EVENT } from "../lib/mobileSystemBack";
import { IconCopy, IconFlag, IconReply, IconSmile } from "./MsgActionIcons";
import { useDialogOpen } from "./useDialogOpen";

type Props = {
  open: boolean;
  isBot: boolean;
  /** Kept for callers; Copy Request ID uses requestId only. */
  messageId: string;
  content: string;
  requestId?: string;
  onClose: () => void;
  onToggleReaction?: (emoji: string) => void | Promise<void>;
  onReply?: () => void;
  onFeedback?: () => void;
};

export function MessageActionSheet({
  open,
  isBot,
  content,
  requestId,
  onClose,
  onToggleReaction,
  onReply,
  onFeedback,
}: Props) {
  const [emojiPage, setEmojiPage] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = useCallback(() => {
    setEmojiPage(false);
    onClose();
  }, [onClose]);
  const dialogRef = useDialogOpen(open, close, {
    onDismiss: () => {
      if (emojiPage) {
        setEmojiPage(false);
        return false;
      }
    },
  });

  useEffect(() => {
    if (!open) return;
    const onSystemBack = (e: Event) => {
      e.preventDefault();
      close();
    };
    document.addEventListener(OPENBOT_SYSTEM_BACK_EVENT, onSystemBack);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener(OPENBOT_SYSTEM_BACK_EVENT, onSystemBack);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (!open) return null;

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(content || "");
    } catch {
      /* ignore */
    }
    close();
  };

  const copyId = async () => {
    if (!requestId) return;
    try {
      await navigator.clipboard.writeText(requestId);
    } catch {
      /* ignore */
    }
    close();
  };

  const pick = async (emoji: string) => {
    if (!onToggleReaction || busy) return;
    setBusy(true);
    try {
      await onToggleReaction(emoji);
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="action-sheet-root" aria-label="消息操作">
      <button type="button" className="action-sheet-mask" aria-label="关闭" onClick={close} />
      <div className="action-sheet">
        <div className="action-sheet-handle" aria-hidden />
        {emojiPage ? (
          <>
            <div className="action-sheet-title">选择表情</div>
            <div className="action-sheet-emoji-grid">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="action-sheet-emoji"
                  disabled={busy}
                  onClick={() => void pick(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button type="button" className="action-sheet-row" onClick={() => setEmojiPage(false)}>
              返回
            </button>
          </>
        ) : (
          <>
            <div className="action-sheet-primary">
              <button
                type="button"
                className="action-sheet-primary-btn"
                disabled={busy || !onToggleReaction}
                onClick={() => setEmojiPage(true)}
              >
                <span className="action-sheet-primary-ico"><IconSmile size={22} /></span>
                表情
              </button>
              <button
                type="button"
                className="action-sheet-primary-btn"
                onClick={() => {
                  onReply?.();
                  onClose();
                }}
              >
                <span className="action-sheet-primary-ico"><IconReply size={22} /></span>
                回复
              </button>
            </div>
            <div className="action-sheet-sep" />
            <button type="button" className="action-sheet-row action-sheet-row-icon" onClick={() => void copyText()}>
              <IconCopy size={18} /> 复制
            </button>
            {requestId ? (
              <button type="button" className="action-sheet-row action-sheet-row-icon" onClick={() => void copyId()}>
                <IconCopy size={18} /> 复制请求 ID
              </button>
            ) : null}
            {isBot && onFeedback ? (
              <button
                type="button"
                className="action-sheet-row action-sheet-row-icon"
                onClick={() => {
                  onFeedback();
                  close();
                }}
              >
                <IconFlag size={18} /> 反馈
              </button>
            ) : null}
            <button type="button" className="action-sheet-row action-sheet-cancel" onClick={close}>
              取消
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
