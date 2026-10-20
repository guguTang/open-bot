import { useEffect, useState } from "react";
import type { MicroAppGrantDecision } from "../api";
import { CAPABILITY_LABELS } from "../lib/microApp/capabilities";

export type MicroAppGrantDecisionResult = {
  decision: MicroAppGrantDecision;
  allowlistEntry?: string;
};

export type MicroAppGrantDecisionPanelProps = {
  capability: string;
  command?: string;
  reason?: string;
  highSensitivity?: boolean;
  suggested?: string;
  suggestedPrefix?: string;
  overridingAlwaysAllow?: boolean;
  /** pending shows actions; otherwise settled label */
  pending?: boolean;
  status?: "pending" | "allowed" | "denied" | string;
  /** card = chat inline; dialog = modal body (shared copy + controls) */
  variant?: "card" | "dialog";
  onDecide?: (d: MicroAppGrantDecisionResult) => void;
};

const DECISION_LABEL: Record<string, string> = {
  allow_once: "仅一次",
  always_allow: "始终允许",
  deny: "拒绝",
};

/**
 * Shared three-state grant UX for iframe dialog and chat grant card.
 * Decisions: allow_once / always_allow / deny (+ shell prefix allowlist).
 */
export function MicroAppGrantDecisionPanel({
  capability,
  command,
  reason,
  highSensitivity,
  suggested,
  suggestedPrefix,
  overridingAlwaysAllow,
  pending = true,
  status,
  variant = "card",
  onDecide,
}: MicroAppGrantDecisionPanelProps) {
  const label = CAPABILITY_LABELS[capability] || capability;
  const isShell = capability === "host.shell.run";
  const [scopeToPrefix, setScopeToPrefix] = useState(Boolean(suggestedPrefix));
  const [prefix, setPrefix] = useState(suggestedPrefix || "");

  useEffect(() => {
    setPrefix(suggestedPrefix || "");
    setScopeToPrefix(Boolean(suggestedPrefix));
  }, [suggestedPrefix, capability, command]);

  const decide = (decision: MicroAppGrantDecision) => {
    if (!onDecide) return;
    if (isShell && decision === "always_allow") {
      onDecide({ decision, allowlistEntry: scopeToPrefix ? prefix.trim() : "" });
      return;
    }
    onDecide({ decision });
  };

  const isPending = pending && status !== "allowed" && status !== "denied";
  const settled =
    status === "allowed" ? "已允许" : status === "denied" ? "已拒绝" : "";

  const continueHint = highSensitivity
    ? "高敏感能力：默认「仅一次」。允许后将在同一工具调用内继续；若服务重启导致无法恢复，将提示你发一条续跑消息。拒绝则停止。"
    : "允许后将在同一工具调用内继续；若服务重启导致无法恢复，将提示你发一条续跑消息。拒绝则停止。";

  if (variant === "dialog") {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5 text-sm text-[var(--muted)]">
          <div>
            该工具请求：<strong className="text-[var(--text)]">{label}</strong>
            <code className="mt-1 block text-[11px]">{capability}</code>
          </div>
          {isShell && command ? (
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-soft)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)]">
              {command}
            </pre>
          ) : null}
          {reason ? <span className="block text-[11px] text-amber-700">{reason}</span> : null}
          <span className="block text-[11px] text-amber-700">{continueHint}</span>
          {suggested ? (
            <span className="block text-[11px]">建议：{DECISION_LABEL[suggested] || suggested}</span>
          ) : null}
        </div>

        {isShell ? (
          <div className="space-y-1.5 rounded-md border border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--muted)]">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={scopeToPrefix}
                onChange={(e) => setScopeToPrefix(e.target.checked)}
              />
              「始终允许」仅限此命令前缀（写入白名单）
            </label>
            {scopeToPrefix ? (
              <input
                className="w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text)]"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="例如 git status"
                aria-label="命令前缀白名单"
              />
            ) : (
              <span className="block text-amber-700">
                不限前缀：此工具的简单命令都将自动执行（复合命令、Auto-review 要确认的命令仍会询问）。
              </span>
            )}
            {overridingAlwaysAllow ? (
              <span className="block">
                已有「始终允许」：选「仅一次 / 拒绝」只影响这一次；「始终允许」会把前缀加入白名单（白名单非空时仅名单内命令自动执行）。
              </span>
            ) : null}
          </div>
        ) : null}

        {isPending && onDecide ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="host-confirm-allow-once primary inline-flex h-9 items-center justify-center rounded-md bg-[var(--primary)] px-3 text-sm text-white"
              autoFocus
              onClick={() => decide("allow_once")}
            >
              仅一次
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--border)] px-3 text-sm"
              disabled={isShell && scopeToPrefix && !prefix.trim()}
              onClick={() => decide("always_allow")}
            >
              始终允许{isShell && scopeToPrefix && prefix.trim() ? `「${prefix.trim()}」` : ""}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-[var(--danger)]"
              onClick={() => decide("deny")}
            >
              {overridingAlwaysAllow ? "拒绝本次" : "拒绝"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // card variant (chat inline)
  return (
    <>
      <div className="host-confirm-kicker">微应用需要授权</div>
      <div className="host-confirm-title">
        {label}
        <code className="ml-1 text-[11px] opacity-70">{capability}</code>
      </div>
      {reason ? <div className="host-confirm-reason">{reason}</div> : null}
      <div className="host-confirm-reason host-confirm-risk-hint">{continueHint}</div>
      {isShell && command ? <pre className="host-confirm-preview">{command}</pre> : null}

      {isPending && isShell ? (
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

      {isPending && onDecide ? (
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
            {overridingAlwaysAllow ? "拒绝本次" : "拒绝"}
          </button>
        </div>
      ) : isPending ? (
        <div className="host-confirm-settled">等待确认</div>
      ) : (
        <div className={`host-confirm-settled${status === "denied" ? " denied" : ""}`}>
          {settled}
        </div>
      )}
    </>
  );
}
