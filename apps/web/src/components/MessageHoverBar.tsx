import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { REACTION_EMOJIS } from "../api";
import { IconCopy, IconFlag, IconMore, IconReply, IconSmile } from "./MsgActionIcons";

type Flip = "right" | "left" | "top";

type Props = {
  isBot: boolean;
  /** Kept for callers; Copy Request ID uses requestId only. */
  messageId: string;
  content: string;
  requestId?: string;
  onToggleReaction?: (emoji: string) => void | Promise<void>;
  onReply?: () => void;
  onFeedback?: () => void;
  forceOpen?: boolean;
};

export function MessageHoverBar({
  isBot,
  content,
  requestId,
  onToggleReaction,
  onReply,
  onFeedback,
  forceOpen = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flip, setFlip] = useState<Flip>("right");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen && !moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      setPickerOpen(false);
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pickerOpen, moreOpen]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const stack = el.closest(".bubble-stack") as HTMLElement | null;
      const bubble = stack?.querySelector(".bubble") as HTMLElement | null;
      const anchor = bubble || stack || el.parentElement;
      if (!anchor || !stack) return;
      const br = bubble ? bubble.getBoundingClientRect() : anchor.getBoundingClientRect();
      const sr = stack.getBoundingClientRect();
      // Vertical center against the bubble (not the whole stack with reactions).
      const centerY = br.top + br.height / 2 - sr.top;
      el.style.top = `${centerY}px`;
      const barW = el.offsetWidth || 96;
      const gap = 6;
      const spaceRight = window.innerWidth - br.right;
      const spaceLeft = br.left;
      // flip-right = preferred side (right of a Bot bubble, left of a user bubble);
      // flip-left = opposite side; flip-top = above when neither side fits.
      const isUserSide = stack.classList.contains("bubble-stack-user");
      const fitsRight = spaceRight >= barW + gap;
      const fitsLeft = spaceLeft >= barW + gap;
      const preferred = isUserSide ? fitsLeft : fitsRight;
      const opposite = isUserSide ? fitsRight : fitsLeft;
      setFlip(preferred ? "right" : opposite ? "left" : "top");
    };
    const scheduleMeasure = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, [pickerOpen, moreOpen, forceOpen]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(content || "");
    } catch {
      /* ignore */
    }
    setMoreOpen(false);
  };

  const copyId = async () => {
    if (!requestId) return;
    try {
      await navigator.clipboard.writeText(requestId);
    } catch {
      /* ignore */
    }
    setMoreOpen(false);
  };

  const pick = async (emoji: string) => {
    if (!onToggleReaction || busy) return;
    setBusy(true);
    try {
      await onToggleReaction(emoji);
      setPickerOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const sticky = pickerOpen || moreOpen || forceOpen;

  return (
    <div
      ref={rootRef}
      className={`msg-hover-bar flip-${flip}${sticky ? " sticky" : ""}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="msg-hover-btns">
        <div className="msg-hover-slot">
          <button
            type="button"
            className="msg-hover-btn"
            title="表情"
            aria-label="表情"
            aria-expanded={pickerOpen}
            disabled={busy || !onToggleReaction}
            onClick={() => {
              setMoreOpen(false);
              setPickerOpen((v) => !v);
            }}
          >
            <IconSmile />
          </button>
          {pickerOpen ? (
            <div className="msg-reaction-picker msg-hover-picker" role="menu">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="msg-reaction-pick"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void pick(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="msg-hover-btn"
          title="回复"
          aria-label="回复"
          onClick={() => onReply?.()}
        >
          <IconReply />
        </button>

        <div className="msg-hover-slot">
          <button
            type="button"
            className="msg-hover-btn"
            title="更多"
            aria-label="更多"
            aria-expanded={moreOpen}
            onClick={() => {
              setPickerOpen(false);
              setMoreOpen((v) => !v);
            }}
          >
            <IconMore />
          </button>
          {moreOpen ? (
            <div className="msg-more-menu" role="menu">
              <button type="button" className="msg-more-item" role="menuitem" onClick={() => void copyText()}>
                <IconCopy size={15} />
                <span>复制</span>
              </button>
              {requestId ? (
                <button type="button" className="msg-more-item" role="menuitem" onClick={() => void copyId()}>
                  <IconCopy size={15} />
                  <span>复制请求 ID</span>
                </button>
              ) : null}
              {isBot ? (
                <>
                  <div className="msg-more-sep" />
                  <button
                    type="button"
                    className="msg-more-item"
                    role="menuitem"
                    onClick={() => {
                      setMoreOpen(false);
                      onFeedback?.();
                    }}
                  >
                    <IconFlag size={15} />
                    <span>反馈</span>
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
