import { useState } from "react";
import type { HandoffPayload } from "../api";

const STATUS_LABEL: Record<string, string> = {
  running: "进行中",
  done: "完成",
  failed: "失败",
  rejected: "被拒",
  awaiting_approval: "待批准",
};

type Props = {
  handoff: HandoffPayload;
  contentFallback?: string;
};

function parseFallback(content?: string): HandoffPayload | null {
  if (!content) return null;
  try {
    const j = JSON.parse(content) as HandoffPayload;
    if (j && typeof j.from_bot === "string" && typeof j.to_bot === "string") return j;
  } catch {
    /* ignore */
  }
  return null;
}

export function HandoffCard({ handoff, contentFallback }: Props) {
  const [open, setOpen] = useState(false);
  const data = handoff.from_bot ? handoff : parseFallback(contentFallback) || handoff;
  const status = data.status || "running";
  const label = STATUS_LABEL[status] || status;

  return (
    <div className={`handoff-card status-${status}`}>
      <div className="handoff-card-head">
        <span className="handoff-badge">交接</span>
        <span className={`handoff-status status-${status}`}>{label}</span>
      </div>
      <div className="handoff-route">
        <span className="handoff-bot">{data.from_bot || "?"}</span>
        <span className="handoff-arrow" aria-hidden>
          →
        </span>
        <span className="handoff-bot">{data.to_bot || "?"}</span>
      </div>
      {data.purpose ? <div className="handoff-purpose">{data.purpose}</div> : null}
      {status === "failed" && data.error ? (
        <div className="handoff-error">{data.error}</div>
      ) : null}
      {data.agent_message_id ? (
        <button
          type="button"
          className="handoff-detail-btn"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起详情" : "查看详情"}
        </button>
      ) : null}
      {open && data.agent_message_id ? (
        <pre className="handoff-detail">{[
          `agent_message_id: ${data.agent_message_id}`,
          `status: ${status}`,
          `from: ${data.from_bot}`,
          `to: ${data.to_bot}`,
          data.error ? `error: ${data.error}` : "",
        ]
          .filter(Boolean)
          .join("\n")}</pre>
      ) : null}
    </div>
  );
}
