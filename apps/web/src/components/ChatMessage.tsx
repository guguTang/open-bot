import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { AttachmentMeta, HandoffPayload, ReactionSummary } from "../api";
import {
  NEGATIVE_REACTION_EMOJIS,
  attachmentDisplayUrl,
  isImageAttachmentMime,
} from "../api";
import { ImageDiagramCard } from "./ImageDiagramCard";
import { MessageReactions } from "./MessageReactions";
import { stripThinkTags } from "../lib/stripThink";
import { ResultOrientedMessage } from "./ArtifactCards";
import { HostConfirmCard, parseHostConfirm } from "./HostConfirmCard";
import { HandoffCard } from "./HandoffCard";
import { MessageActionSheet } from "./MessageActionSheet";
import { MessageHoverBar } from "./MessageHoverBar";
import { useIsTouchUi } from "./useIsTouchUi";

export type ChatMessageData = {
  id: string;
  role: string;
  content: string;
  streaming?: boolean;
  attachments?: AttachmentMeta[];
  agent_id?: string;
  agent_name?: string;
  created_at?: string;
  reply_to_id?: string;
  thread_root_id?: string;
  agent_message_id?: string;
  /** Runtime run id on Bot replies (More → 复制请求 ID); absent on historical messages. */
  request_id?: string;
  reactions?: ReactionSummary[];
  handoff?: HandoffPayload;
};

type Props = {
  message: ChatMessageData;
  /** Fallback selected bot when message.agent_id is missing. */
  agentId?: string;
  /**
   * Group chat only: bot display name above the assistant bubble.
   * Omit in DM / single-bot so chrome stays unchanged.
   */
  speakerName?: string;
  onHostDecide?: (ok: boolean) => void;
  /** Quoted parent preview when rendering a reply. */
  replyQuote?: { who: string; text: string } | null;
  /** Number of replies in this message's thread (main timeline roots). */
  replyCount?: number;
  onReply?: (message: ChatMessageData) => void;
  onOpenThread?: (rootId: string) => void;
  onJumpToParent?: (parentId: string) => void;
  /** Compact style inside an open thread panel. */
  dense?: boolean;
  onToggleReaction?: (messageId: string, emoji: string) => void | Promise<void>;
  /** Open the feedback dialog for a bot reply (explicit submit → pending lesson). */
  onFeedback?: (message: ChatMessageData) => void;
  /** Called after the user *adds* 👎/❌ on a bot reply; reaction alone stores no feedback. */
  onNegativeReaction?: (message: ChatMessageData, emoji: string) => void;
};

const NEGATIVE_REACTION_SET = new Set<string>(NEGATIVE_REACTION_EMOJIS as readonly string[]);
const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 10;

export function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function previewText(content: string, max = 80): string {
  const t = stripThinkTags(content).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

function canReact(message: ChatMessageData): boolean {
  if (message.streaming) return false;
  if (message.role === "host_confirm" || message.role === "handoff") return false;
  const id = message.id || "";
  if (!id || id.startsWith("local-") || id.startsWith("onboard-")) return false;
  return true;
}


function resolveHandoff(message: ChatMessageData): HandoffPayload | null {
  if (message.handoff && message.handoff.from_bot) return message.handoff;
  if (message.role !== "handoff") return null;
  try {
    const j = JSON.parse(message.content) as HandoffPayload;
    if (j && typeof j.from_bot === "string") return j;
  } catch {
    /* ignore */
  }
  return message.handoff || null;
}

export function ChatMessage({
  message,
  agentId,
  speakerName,
  onHostDecide,
  replyQuote,
  replyCount = 0,
  onReply,
  onOpenThread,
  onJumpToParent,
  dense,
  onToggleReaction,
  onFeedback,
  onNegativeReaction,
}: Props) {
  const isUser = message.role === "user";
  const isSummary = message.role === "summary";
  const time = formatMessageTime(message.created_at);
  const speakerLabel = (speakerName || "").trim();
  const timeEl = time ? (
    <time className="chat-time" dateTime={message.created_at}>
      {time}
    </time>
  ) : null;
  const speakerId = message.agent_id || agentId;
  const canReply = Boolean(onReply) && (message.role === "user" || message.role === "assistant") && !message.streaming;
  const touchUi = useIsTouchUi();
  const [sheetOpen, setSheetOpen] = useState(false);
  const timerRef = useRef<number | null>(null);
  /** Set when the long-press timer opened the sheet; the release must not "click" the mask. */
  const longPressFiredRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => () => clearTimer(), []);

  if (message.role === "host_confirm") {
    const item = parseHostConfirm(message.content);
    if (!item) return null;
    return (
      <div className="chat-row chat-row-assistant" data-msg-id={message.id}>
        <HostConfirmCard item={item} onDecide={item.status === "pending" ? onHostDecide : undefined} />
        {timeEl}
      </div>
    );
  }

  const handoff = resolveHandoff(message);
  if (message.role === "handoff" || handoff) {
    const payload: HandoffPayload = handoff || {
      from_bot: "?",
      to_bot: "?",
      purpose: message.content || "",
      status: "running",
      agent_message_id: "",
    };
    return (
      <div className="chat-row chat-row-handoff" data-msg-id={message.id}>
        <HandoffCard handoff={payload} contentFallback={message.content} />
        {timeEl}
      </div>
    );
  }

  const visible =
    isUser ? message.content : stripThinkTags(message.content);
  if (message.streaming && !visible && !isUser) {
    return null;
  }
  if (!isUser && !message.streaming && !visible.trim()) {
    return null;
  }

  const canFeedback =
    Boolean(onFeedback) && message.role === "assistant" && canReact(message);
  const isBot = message.role === "assistant";

  // Reply / feedback live in the hover bar (desktop) or long-press action sheet (touch UI).
  const threadBtn =
    replyCount > 0 && onOpenThread ? (
      <button
        type="button"
        className="msg-action-btn msg-action-thread"
        title="查看线程"
        onClick={() => onOpenThread(message.thread_root_id || message.id)}
      >
        {replyCount} 条回复
      </button>
    ) : null;
  const parentBtn =
    message.reply_to_id && onJumpToParent ? (
      <button
        type="button"
        className="msg-action-btn"
        title="跳到原消息"
        onClick={() => onJumpToParent(message.reply_to_id!)}
      >
        原消息
      </button>
    ) : null;
  const actions = threadBtn || parentBtn ? (
    <div className="msg-actions">
      {threadBtn}
      {parentBtn}
    </div>
  ) : null;

  const quoteEl = replyQuote ? (
    <button
      type="button"
      className="msg-reply-quote"
      title="跳到原消息"
      aria-label={`引用 ${replyQuote.who}`}
      onClick={() => message.reply_to_id && onJumpToParent?.(message.reply_to_id)}
    >
      <span className="msg-reply-quote-text">{previewText(replyQuote.text, 120)}</span>
    </button>
  ) : null;

  const interactive = canReact(message) && Boolean(onToggleReaction);
  const handleToggle = async (emoji: string) => {
    const alreadyMine = Boolean(
      message.reactions?.some((r) => r.emoji === emoji && r.me),
    );
    await onToggleReaction?.(message.id, emoji);
    // Only follow up when *adding* 👎/❌ on a bot reply, never on removal.
    if (!alreadyMine && isBot && NEGATIVE_REACTION_SET.has(emoji)) {
      onNegativeReaction?.(message, emoji);
    }
  };
  const reactionsBar = (
    <MessageReactions
      reactions={message.reactions}
      interactive={interactive}
      onToggle={interactive ? (emoji) => handleToggle(emoji) : undefined}
    />
  );

  const hasActions = interactive || canReply || canFeedback;
  const requestId = message.request_id?.trim() || undefined;
  const replyFn = canReply ? () => onReply?.(message) : undefined;
  const feedbackFn = canFeedback ? () => onFeedback?.(message) : undefined;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!hasActions || !touchUi) return;
    if (e.pointerType === "mouse") return;
    startRef.current = { x: e.clientX, y: e.clientY };
    longPressFiredRef.current = false;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
      if (sel && sel.toString().length > 0) return;
      longPressFiredRef.current = true;
      setSheetOpen(true);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* ignore */
      }
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!startRef.current || timerRef.current == null) return;
    const dx = Math.abs(e.clientX - startRef.current.x);
    const dy = Math.abs(e.clientY - startRef.current.y);
    if (dx + dy > MOVE_CANCEL_PX) clearTimer();
  };
  const onPointerEnd = () => {
    clearTimer();
    startRef.current = null;
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      // Swallow the ghost click from lifting the finger, which would otherwise
      // land on the freshly opened sheet's mask and close it immediately.
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 500);
    }
  };
  const touchHandlers =
    touchUi && hasActions
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp: onPointerEnd,
          onPointerCancel: onPointerEnd,
          onContextMenu: (e: ReactMouseEvent) => {
            if (sheetOpen) e.preventDefault();
          },
        }
      : {};

  // Desktop (fine pointer & wide): hover bar. touch-ui (coarse OR ≤767): bottom action sheet.
  const desktopBar =
    hasActions && !touchUi ? (
      <MessageHoverBar
        isBot={isBot}
        messageId={message.id}
        content={visible}
        requestId={requestId}
        onToggleReaction={interactive ? (emoji) => handleToggle(emoji) : undefined}
        onReply={replyFn}
        onFeedback={feedbackFn}
      />
    ) : null;
  const sheet =
    hasActions && touchUi ? (
      <MessageActionSheet
        open={sheetOpen}
        isBot={isBot}
        messageId={message.id}
        content={visible}
        requestId={requestId}
        onClose={() => setSheetOpen(false)}
        onToggleReaction={interactive ? (emoji) => handleToggle(emoji) : undefined}
        onReply={replyFn}
        onFeedback={feedbackFn}
      />
    ) : null;

  if (isUser) {
    return (
      <div className={`chat-row chat-row-user${dense ? " chat-row-dense" : ""}`} data-msg-id={message.id} {...touchHandlers}>
        <div className="bubble-stack bubble-stack-user">
          <div className="bubble bubble-user">
            {quoteEl}
            {(() => {
              const atts = message.attachments || [];
              if (!atts.length) return null;
              const images: AttachmentMeta[] = [];
              const others: AttachmentMeta[] = [];
              for (const a of atts) {
                if (isImageAttachmentMime(a.mime) && attachmentDisplayUrl(a)) {
                  images.push(a);
                } else {
                  others.push(a);
                }
              }
              return (
                <>
                  {images.map((a) => (
                    <ImageDiagramCard
                      key={a.id || a.name}
                      src={a.url!}
                      alt={a.name}
                      name={a.name}
                      mime={a.mime}
                    />
                  ))}
                  {others.length > 0 ? (
                    <div className="msg-attach-chips">
                      {others.map((a) => {
                        const thumb = isImageAttachmentMime(a.mime)
                          ? attachmentDisplayUrl(a)
                          : null;
                        return (
                          <span
                            key={a.id || a.name}
                            className={`msg-attach-chip${thumb ? " is-image" : ""}`}
                          >
                            {thumb ? (
                              <img
                                className="msg-attach-thumb"
                                src={thumb}
                                alt=""
                                loading="lazy"
                              />
                            ) : null}
                            <span className="msg-attach-name">{a.name}</span>
                            {a.size ? (
                              <span className="msg-attach-size">{formatSize(a.size)}</span>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              );
            })()}
            {visible ? <div className="bubble-text">{visible}</div> : null}
          </div>
          {desktopBar}
        </div>
        {reactionsBar}
        {actions}
        {timeEl}
        {sheet}
      </div>
    );
  }

  return (
    <div
      className={`chat-row chat-row-assistant${isSummary ? " chat-row-summary" : ""}${dense ? " chat-row-dense" : ""}`}
      data-msg-id={message.id}
      {...touchHandlers}
    >
      <div className="bubble-stack bubble-stack-assistant">
        {speakerLabel ? (
          <div className="msg-speaker-name" title={speakerLabel}>
            {speakerLabel}
          </div>
        ) : null}
        <div className="bubble bubble-assistant">
          {quoteEl}
          {isSummary ? <div className="msg-role">摘要</div> : null}
          <ResultOrientedMessage
            content={visible}
            streaming={message.streaming}
            agentId={speakerId}
          />
        </div>
        {desktopBar}
      </div>
      {reactionsBar}
      {actions}
      {timeEl}
      {sheet}
    </div>
  );
}
