import { FormEvent, useEffect, useState } from "react";
import type { FeedbackPolarity, FeedbackSource } from "../api";

export const NEGATIVE_REASONS = [
  { id: "wrong", label: "答错了 / 事实不准" },
  { id: "verbose", label: "太啰嗦" },
  { id: "not_followed", label: "没按要求做" },
  { id: "missed_steps", label: "漏了关键步骤" },
  { id: "tone", label: "语气/格式不对" },
  { id: "other", label: "其它" },
] as const;

export const POSITIVE_REASONS = [
  { id: "good", label: "答得好" },
  { id: "concise", label: "简洁有用" },
  { id: "format_ok", label: "格式对" },
] as const;

export type FeedbackTarget = {
  messageId: string;
  agentId: string;
  agentName: string;
  conversationId: string;
  polarity: FeedbackPolarity;
  source: FeedbackSource;
};

type Props = {
  target: FeedbackTarget | null;
  onClose: () => void;
  onSubmit: (input: {
    polarity: FeedbackPolarity;
    reasons: string[];
    note: string;
    source: FeedbackSource;
  }) => Promise<void>;
};

export function FeedbackModal({ target, onClose, onSubmit }: Props) {
  const [polarity, setPolarity] = useState<FeedbackPolarity>("negative");
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!target) return;
    setPolarity(target.polarity);
    setReasons([]);
    setNote("");
    setErr("");
    setBusy(false);
  }, [target]);

  if (!target) return null;

  const presets = polarity === "negative" ? NEGATIVE_REASONS : POSITIVE_REASONS;

  const toggleReason = (id: string) => {
    setReasons((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await onSubmit({
        polarity,
        reasons,
        note: note.trim().slice(0, 500),
        source: target.source,
      });
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop feedback-backdrop" onClick={onClose}>
      <div className="modal feedback-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>给 {target.agentName} 的反馈</h3>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="feedback-sub muted small">
          反馈经你确认经验后才会用来改进这个 Bot；表情反应本身不会进记忆。
        </p>
        <form className="feedback-form" onSubmit={(e) => void submit(e)}>
          <div className="feedback-label">极性</div>
          <div className="feedback-chips">
            <button
              type="button"
              className={`feedback-chip${polarity === "positive" ? " active" : ""}`}
              onClick={() => {
                setPolarity("positive");
                setReasons([]);
              }}
            >
              正面
            </button>
            <button
              type="button"
              className={`feedback-chip${polarity === "negative" ? " active" : ""}`}
              onClick={() => {
                setPolarity("negative");
                setReasons([]);
              }}
            >
              负面
            </button>
          </div>

          <div className="feedback-label">原因标签</div>
          <div className="feedback-chips wrap">
            {presets.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`feedback-chip${reasons.includes(r.id) ? " active" : ""}`}
                onClick={() => toggleReason(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <label className="feedback-label">
            补充说明（可选）
            <textarea
              className="feedback-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="想让它下次怎么改？"
            />
          </label>

          {err ? <div className="text-[13px] text-[var(--danger)]">{err}</div> : null}

          <div className="feedback-actions">
            <button type="button" className="ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "提交中…" : "提交反馈"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
