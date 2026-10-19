import { useEffect, useState } from "react";
import type { MicroAppGrantDecision } from "../api";
import { CAPABILITY_LABELS } from "../lib/microApp/capabilities";
import type { MicroAppGrantPromptPayload } from "./microAppGrantModel";

export type MicroAppGrantCardDecision = {
  decision: MicroAppGrantDecision;
  allowlistEntry?: string;
};

/**
 * Chat-inline approval card for model-path grant_required (Phase 6 gap-close).
 * Writes MicroApp Grant via decide API; does not auto-retry the tool turn.
 */
export function MicroAppGrantConfirmCard({
  item,
  onDecide,
}: {
  item: MicroAppGrantPromptPayload;
  onDecide?: (d: MicroAppGrantCardDecision) => void;
}) {
  const pending = item.status === "pending";
  const settled =
    item.status === "allowed" ? "已允许" : item.status === "denied" ? "已拒绝" : "";
  const label = CAPABILITY_LABELS[item.capability] || item.capability;
  const isShell = item.capability === "host.shell.run";
  const [scopeToPrefix, setScopeToPrefix] = useState(Boolean(item.suggested_prefix));
  const [prefix, setPrefix] = useState(item.suggested_prefix || "");

  useEffect(() => {
    setPrefix(item.suggested_prefix || "");
    setScopeToPrefix(Boolean(item.suggested_prefix));
  }, [item.suggested_prefix, item.req_id]);

  const decide = (decision: MicroAppGrantDecision) => {
    if (!onDecide) return;
    if (isShell && decision === "always_allow") {
      onDecide({ decision, allowlistEntry: scopeToPrefix ? prefix.trim() : "" });
      return;
    }
    onDecide({ decision });
  };

  return (
    <div
      className="host-confirm-card"
      role="region"
      aria-label="微应用需要授权"
      data-capability={item.capability}
    >
      <div className="host-confirm-kicker">微应用需要授权</div>
      <div className="host-confirm-title">
        {label}
        <code className="ml-1 text-[11px] opacity-70">{item.capability}</code>
      </div>
      {item.reason ? <div className="host-confirm-reason">{item.reason}</div> : null}
      {item.high_sensitivity ? (
        <div className="host-confirm-reason host-confirm-risk-hint">
          高敏感能力：默认「仅一次」。授权后请再说一次让助手继续（本回合不自动重试）。
        </div>
      ) : (
        <div className="host-confirm-reason">授权后请再说一次让助手继续（本回合不自动重试）。</div>
      )}
      {isShell && item.command ? (
        <pre className="host-confirm-preview">{item.command}</pre>
      ) : null}

      {pending && isShell ? (
        <div className="mb-2 space-y-1.5 rounded-md border border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--muted)]">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={scopeToPrefix}
              onChange={(e) => setScopeToPrefix(e.target.checked)}
            />
            「始终允许」仅限此命令前缀
          </label>
          {scopeToPrefix ? (
            <input
              className="w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text)]"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="例如 git status"
              aria-label="命令前缀白名单"
            />
          ) : null}
        </div>
      ) : null}

      {pending && onDecide ? (
        <div className="host-confirm-actions host-confirm-actions-tri">
          <button
            type="button"
            className="host-confirm-allow-once primary"
            onClick={() => decide("allow_once")}
          >
            仅一次
          </button>
          <button
            type="button"
            className="host-confirm-always ghost"
            disabled={isShell && scopeToPrefix && !prefix.trim()}
            onClick={() => decide("always_allow")}
          >
            始终允许
            {isShell && scopeToPrefix && prefix.trim() ? `「${prefix.trim()}」` : ""}
          </button>
          <button
            type="button"
            className="host-confirm-deny ghost danger-outline"
            onClick={() => decide("deny")}
          >
            拒绝
          </button>
        </div>
      ) : pending ? (
        <div className="host-confirm-settled">等待确认</div>
      ) : (
        <div className={`host-confirm-settled${item.status === "denied" ? " denied" : ""}`}>
          {settled}
        </div>
      )}
    </div>
  );
}
