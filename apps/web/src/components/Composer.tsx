import { ArrowUp, CornerUpLeft, Plus, Square, X } from "lucide-react";
import { Button, Tooltip } from "@heroui/react";
import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { AgentAvatar } from "./AgentAvatar";
import { useAutoGrowTextarea } from "../lib/useAutoGrowTextarea";

export type PendingFile = {
  key: string;
  file: File;
};

export type ComposerMentionItem = {
  kind: "agent" | "everyone" | "routine" | "mcp" | "bot";
  /** Inserted after @ (token). */
  insert: string;
  label: string;
  subtitle?: string;
  agentId?: string;
  avatarShape?: string;
  avatarColor?: string;
};

export type ComposerSkillOption = {
  name: string;
  description?: string;
};

export type ComposerReplyTarget = {
  id: string;
  who: string;
  text: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  /** Cancel the in-flight run (Stop). */
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  agentName?: string;
  files?: PendingFile[];
  onFilesChange?: (files: PendingFile[]) => void;
  /** @ autocomplete items (bots, group, routines, MCP…). */
  mentionItems?: ComposerMentionItem[];
  /** / skill picker options. */
  skillOptions?: ComposerSkillOption[];
  /** When true, @ targets group members; otherwise DM @ switches bot. */
  groupChat?: boolean;
  /** Active reply target (Grok-style quote bar inside the composer card). */
  replyTo?: ComposerReplyTarget | null;
  onClearReply?: () => void;
};

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type TriggerState = {
  kind: "mention" | "slash";
  start: number;
  query: string;
};

function detectTrigger(value: string, caret: number): TriggerState | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  const slash = before.lastIndexOf("/");
  const pick = (idx: number, kind: "mention" | "slash"): TriggerState | null => {
    if (idx < 0) return null;
    if (idx > 0) {
      const prev = before[idx - 1];
      if (prev && !/\s/.test(prev)) return null;
    }
    const query = before.slice(idx + 1);
    if (/\s/.test(query)) return null;
    return { kind, start: idx, query };
  };
  const m = pick(at, "mention");
  const s = pick(slash, "slash");
  if (m && s) return m.start > s.start ? m : s;
  return m || s;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  disabled,
  sending,
  agentName,
  files = [],
  onFilesChange,
  mentionItems,
  skillOptions,
  groupChat,
  replyTo,
  onClearReply,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** True while an IME session is active (incl. Safari gap after compositionend). */
  const imeComposingRef = useRef(false);
  useAutoGrowTextarea(taRef, value);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [pickerIndex, setPickerIndex] = useState(0);

  const hasMentions = Boolean(mentionItems?.length);
  const hasSkills = Boolean(skillOptions?.length);
  const placeholder = replyTo
    ? "回复…"
    : hasMentions
    ? groupChat
      ? `给群聊发消息，@ 点名成员`
      : `给 ${agentName || "助手"} 发消息 · @ 可转给其他 Bot`
    : hasSkills
      ? `给 ${agentName || "助手"} 发消息 · / 引用 Skill`
      : `给 ${agentName || "助手"} 发消息`;
  const canSend = Boolean(value.trim() || files.length > 0);

  const mentionOptions = useMemo(() => {
    if (!trigger || trigger.kind !== "mention" || !mentionItems?.length) return [];
    const q = trigger.query.trim().toLowerCase();
    return mentionItems
      .filter((item) => {
        if (!q) return true;
        return (
          item.insert.toLowerCase().includes(q) ||
          item.label.toLowerCase().includes(q) ||
          (item.subtitle || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 10);
  }, [trigger, mentionItems]);

  const slashOptions = useMemo(() => {
    if (!trigger || trigger.kind !== "slash" || !skillOptions?.length) return [];
    const q = trigger.query.trim().toLowerCase();
    return skillOptions
      .filter((s) => {
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 10);
  }, [trigger, skillOptions]);

  const activeOptions =
    trigger?.kind === "slash" ? slashOptions : mentionOptions;
  const showPicker = Boolean(
    trigger &&
      (activeOptions.length > 0 ||
        (trigger.kind === "slash" && (!hasSkills || slashOptions.length === 0))),
  );

  const applyInsert = (text: string) => {
    if (!trigger) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const before = value.slice(0, trigger.start);
    const after = value.slice(caret);
    const next = before + text + after;
    onChange(next);
    setTrigger(null);
    setPickerIndex(0);
    requestAnimationFrame(() => {
      const pos = before.length + text.length;
      ta?.focus();
      ta?.setSelectionRange(pos, pos);
    });
  };

  const applyMention = (item: ComposerMentionItem) => {
    applyInsert(`@${item.insert} `);
  };

  const applySkill = (skill: ComposerSkillOption) => {
    applyInsert(`请 load_skill ${skill.name} `);
  };

  // Picking「回复」focuses the input so the user can type straight away.
  useEffect(() => {
    if (replyTo?.id) taRef.current?.focus();
  }, [replyTo?.id]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Chinese/Japanese/etc. IME: Space/Enter confirm candidates into the input.
    // Never treat those as send or @/ picker shortcuts. keyCode 229 = IME "Process".
    // imeComposingRef covers Safari, where compositionend can clear isComposing
    // before the confirming keydown runs.
    // Prefer nativeEvent.isComposing: React KeyboardEvent omits isComposing
    // under @types/react 19 (main IME guard + develop type-safe access).
    const imeComposing =
      imeComposingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229;
    if (imeComposing) {
      return;
    }
    // Send is Enter-only (Shift+Enter inserts newline). Space must never submit.
    if (showPicker && activeOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => (i + 1) % activeOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => (i - 1 + activeOptions.length) % activeOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const idx = pickerIndex;
        if (trigger?.kind === "slash") {
          applySkill(slashOptions[idx] ?? slashOptions[0]);
        } else {
          applyMention(mentionOptions[idx] ?? mentionOptions[0]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (e.key === "Escape" && replyTo && onClearReply) {
      e.preventDefault();
      onClearReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (sending) {
        if (canSend) {
          void onSubmit(e);
        } else {
          onStop?.();
        }
        return;
      }
      if (canSend) {
        void onSubmit(e);
      }
    }
  };

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || !onFilesChange) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      next.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`, file: f });
    }
    onFilesChange(next);
    e.target.value = "";
  };

  const removeFile = (key: string) => {
    onFilesChange?.(files.filter((f) => f.key !== key));
  };

  const refreshTrigger = (next: string, caret: number) => {
    if (!hasMentions && !hasSkills) {
      setTrigger(null);
      return;
    }
    const t = detectTrigger(next, caret);
    if (!t) {
      setTrigger(null);
      return;
    }
    if (t.kind === "mention" && !hasMentions) {
      setTrigger(null);
      return;
    }
    // ArrowUp/Down only move pickerIndex; onKeyUp still re-detects the same
    // trigger — do not reset the highlight or the selection snaps back to 0.
    const unchanged =
      trigger?.kind === t.kind &&
      trigger.start === t.start &&
      trigger.query === t.query;
    if (unchanged) return;
    setTrigger(t);
    setPickerIndex(0);
  };

  const onTextChange = (next: string) => {
    onChange(next);
    const caret = taRef.current?.selectionStart ?? next.length;
    refreshTrigger(next, caret);
  };

  return (
    <form className="composer" onSubmit={onSubmit}>
      {files.length > 0 ? (
        <div className="composer-chips">
          {files.map((f) => (
            <div key={f.key} className="composer-chip" title={f.file.name}>
              <span className="composer-chip-name">{f.file.name}</span>
              <span className="composer-chip-size">{formatSize(f.file.size)}</span>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                className="composer-chip-remove"
                aria-label="移除"
                isDisabled={sending}
                onPress={() => removeFile(f.key)}
              >
                <X size={12} strokeWidth={2.5} aria-hidden />
              </Button>
            </div>
          ))}
          {files.some((f) => f.file.type.startsWith("image/")) ? (
            <p className="composer-attach-hint muted small" role="note">
              图片仅作提及，模型暂不看图
            </p>
          ) : null}
        </div>
      ) : null}
      <div className={`composer-card${replyTo ? " has-quote" : ""}`}>
      {replyTo ? (
        <>
          <div className="composer-quote-bar" title={replyTo.text}>
            <CornerUpLeft className="composer-quote-icon" size={16} strokeWidth={2} aria-hidden />
            <span className="composer-quote-text">{replyTo.text}</span>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="composer-quote-clear"
              aria-label="取消回复"
              onPress={() => onClearReply?.()}
            >
              <X size={14} strokeWidth={2.2} aria-hidden />
            </Button>
          </div>
          <div className="composer-quote-divider" aria-hidden />
        </>
      ) : null}
      <div className="composer-bar">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="composer-file-input"
          onChange={onPickFiles}
          disabled={disabled || sending}
          aria-hidden
          tabIndex={-1}
        />
        <Tooltip delay={400}>
          <Button
            isIconOnly
            variant="ghost"
            className="composer-attach"
            aria-label="添加附件"
            isDisabled={disabled || sending || !onFilesChange}
            onPress={() => fileRef.current?.click()}
          >
            <Plus size={18} strokeWidth={2.25} aria-hidden />
          </Button>
          <Tooltip.Content>添加附件</Tooltip.Content>
        </Tooltip>
        <div className="composer-input-wrap">
          {showPicker ? (
            <div
              className="mention-popup"
              role="listbox"
              aria-label={trigger?.kind === "slash" ? "引用 Skill" : "提及"}
            >
              {trigger?.kind === "slash"
                ? slashOptions.length === 0
                  ? (
                      <div className="mention-option mention-option-empty" role="option" aria-disabled aria-selected={false}>
                        <span className="mention-option-name">暂无可用 Skill</span>
                        <span className="mention-option-id">
                          写代码岗默认含 diagnosing-bugs / tdd / implement / code-review 等；可在「设置 → 当前 Bot」打开更多
                        </span>
                      </div>
                    )
                  : slashOptions.map((s, i) => (
                    <button
                      key={s.name}
                      type="button"
                      role="option"
                      aria-selected={i === pickerIndex}
                      className={`mention-option${i === pickerIndex ? " active" : ""}`}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        applySkill(s);
                      }}
                    >
                      <span className="mention-option-name">/{s.name}</span>
                      <span className="mention-option-id">{s.description || "Skill"}</span>
                    </button>
                  ))
                : mentionOptions.map((item, i) => (
                    <button
                      key={`${item.kind}-${item.insert}`}
                      type="button"
                      role="option"
                      aria-selected={i === pickerIndex}
                      className={`mention-option${i === pickerIndex ? " active" : ""}`}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        applyMention(item);
                      }}
                    >
                      {item.kind === "agent" || item.kind === "bot" ? (
                        <AgentAvatar
                          id={item.agentId || item.insert}
                          name={item.label}
                          size={24}
                          shape={item.avatarShape}
                          color={item.avatarColor}
                        />
                      ) : (
                        <span className="mention-kind-badge">{item.kind}</span>
                      )}
                      <span className="mention-option-name">{item.label}</span>
                      <span className="mention-option-id">@{item.insert}</span>
                    </button>
                  ))}
            </div>
          ) : null}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onTextChange(e.target.value)}
            onCompositionStart={() => {
              imeComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              // Defer clear so a confirming Enter/Space keydown in the same turn
              // still sees composing=true and does not submit.
              window.setTimeout(() => {
                imeComposingRef.current = false;
              }, 0);
            }}
            onClick={() => {
              const caret = taRef.current?.selectionStart ?? value.length;
              refreshTrigger(value, caret);
            }}
            onKeyUp={(e) => {
              if (
                e.key === "ArrowDown" ||
                e.key === "ArrowUp" ||
                e.key === "Enter" ||
                e.key === "Tab" ||
                e.key === "Escape"
              ) {
                return;
              }
              const caret = taRef.current?.selectionStart ?? value.length;
              refreshTrigger(value, caret);
            }}
            placeholder={placeholder}
            rows={1}
            onKeyDown={onKeyDown}
            disabled={disabled}
          />
        </div>
        {sending ? (
          <Button
            isIconOnly
            variant="secondary"
            className="composer-send composer-stop"
            aria-label="停止生成"
            onPress={() => onStop?.()}
          >
            <Square
              className="composer-stop-icon"
              size={12}
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={0}
              aria-hidden
            />
          </Button>
        ) : (
          <Button type="submit" isIconOnly className="composer-send" isDisabled={!canSend} aria-label="发送">
            <ArrowUp size={18} strokeWidth={2.5} aria-hidden />
          </Button>
        )}
      </div>
      </div>
    </form>
  );
}
