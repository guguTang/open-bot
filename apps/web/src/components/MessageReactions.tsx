import { useState } from "react";
import type { ReactionSummary } from "../api";

type Props = {
  /** Server may send null for messages without reactions. */
  reactions?: ReactionSummary[] | null;
  /** When false, hide interactive controls (local/temp messages). */
  interactive?: boolean;
  onToggle?: (emoji: string) => void | Promise<void>;
};

/**
 * Shows existing reaction chips only (tap a chip to toggle / cancel your own).
 * Adding reactions is via the hover bar / mobile action sheet (no "+" button).
 */
export function MessageReactions({ reactions, interactive = true, onToggle }: Props) {
  const [busy, setBusy] = useState(false);
  const visible = (reactions ?? []).filter((r) => r.count > 0);

  if (visible.length === 0) return null;

  const handleToggle = async (emoji: string) => {
    if (!interactive || !onToggle || busy) return;
    setBusy(true);
    try {
      await onToggle(emoji);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="msg-reactions open">
      <ul className="msg-reaction-chips m-0 list-none p-0">
        {visible.map((r) => (
          <li key={r.emoji}>
          <button
            type="button"
            className={`msg-reaction-chip${r.me ? " me" : ""}`}
            disabled={!interactive || busy}
            title={r.me ? "取消反应" : "添加反应"}
            onClick={() => void handleToggle(r.emoji)}
          >
            <span className="msg-reaction-emoji">{r.emoji}</span>
            <span className="msg-reaction-count">{r.count}</span>
          </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
