import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REACTION_EMOJIS } from "../api";
import { IconCopy, IconFlag, IconMore, IconReply, IconSmile } from "./MsgActionIcons";

type Flip = "right" | "left" | "top";

type MenuPos = { top: number; left: number };

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

const VIEW_PAD = 8;

function placeBelow(anchor: DOMRect, menu: DOMRect, align: "start" | "end" | "more"): MenuPos {
  let left =
    align === "end"
      ? anchor.right - menu.width
      : align === "more"
        ? anchor.left + anchor.width / 2 - menu.width + 14
        : anchor.left;
  left = Math.max(VIEW_PAD, Math.min(left, window.innerWidth - menu.width - VIEW_PAD));

  const below = anchor.bottom + 4;
  const above = anchor.top - menu.height - 4;
  const top =
    below + menu.height + VIEW_PAD <= window.innerHeight
      ? below
      : above >= VIEW_PAD
        ? above
        : Math.max(VIEW_PAD, window.innerHeight - menu.height - VIEW_PAD);

  return { top, left };
}

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
  const [pickerPos, setPickerPos] = useState<MenuPos | null>(null);
  const [morePos, setMorePos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const smileRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen && !moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (pickerRef.current?.contains(t)) return;
      if (moreMenuRef.current?.contains(t)) return;
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

  useLayoutEffect(() => {
    if (!pickerOpen && !moreOpen) {
      setPickerPos(null);
      setMorePos(null);
      return;
    }

    let raf = 0;
    const place = () => {
      const stack = rootRef.current?.closest(".bubble-stack");
      const isUserSide = stack?.classList.contains("bubble-stack-user") ?? false;
      // Prefer growth toward the bubble (same as prior .msg-hover-picker CSS).
      const pickerAlign: "start" | "end" =
        (isUserSide && flip === "right") || (!isUserSide && flip === "left") ? "start" : "end";

      if (pickerOpen && smileRef.current && pickerRef.current) {
        setPickerPos(
          placeBelow(
            smileRef.current.getBoundingClientRect(),
            pickerRef.current.getBoundingClientRect(),
            pickerAlign,
          ),
        );
      } else {
        setPickerPos(null);
      }

      if (moreOpen && moreBtnRef.current && moreMenuRef.current) {
        setMorePos(
          placeBelow(
            moreBtnRef.current.getBoundingClientRect(),
            moreMenuRef.current.getBoundingClientRect(),
            "more",
          ),
        );
      } else {
        setMorePos(null);
      }
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };

    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [pickerOpen, moreOpen, flip]);

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
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  const pickerMenu =
    pickerOpen && portalTarget
      ? createPortal(
          <div
            ref={pickerRef}
            className="msg-reaction-picker msg-hover-picker msg-hover-menu-portal"
            role="menu"
            style={
              pickerPos
                ? { position: "fixed", top: pickerPos.top, left: pickerPos.left, transform: "none" }
                : { position: "fixed", visibility: "hidden", top: 0, left: 0, transform: "none" }
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
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
          </div>,
          portalTarget,
        )
      : null;

  const moreMenu =
    moreOpen && portalTarget
      ? createPortal(
          <div
            ref={moreMenuRef}
            className="msg-more-menu msg-hover-menu-portal"
            role="menu"
            style={
              morePos
                ? { position: "fixed", top: morePos.top, left: morePos.left, transform: "none" }
                : { position: "fixed", visibility: "hidden", top: 0, left: 0, transform: "none" }
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
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
          </div>,
          portalTarget,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`msg-hover-bar flip-${flip}${sticky ? " sticky" : ""}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="msg-hover-btns">
        <button
          ref={smileRef}
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
            ref={moreBtnRef}
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
        </div>
      </div>
      {pickerMenu}
      {moreMenu}
    </div>
  );
}
