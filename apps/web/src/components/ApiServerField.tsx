import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_API_BASE,
  formatApiHealthProbe,
  getApiBase,
  probeApiHealth,
  setApiBase,
  type ApiHealthProbeResult,
} from "../api";
import { cn } from "@/lib/utils";

type Props = {
  /** Compact for login card; full for settings. */
  variant?: "login" | "settings";
  /** Called after a successful apply (health ok + setApiBase). */
  onApplied?: (url: string) => void;
};

/**
 * Runtime API base editor + /healthz probe (P1-4).
 * Copy: switch server / pairing — same LAN or tunnel as the desktop API.
 */
export function ApiServerField({ variant = "login", onApplied }: Props) {
  const [draft, setDraft] = useState(() => getApiBase());
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<ApiHealthProbeResult | null>(null);

  useEffect(() => {
    setDraft(getApiBase());
  }, []);

  const runProbe = useCallback(async (url: string) => {
    setBusy(true);
    setProbe(null);
    try {
      const result = await probeApiHealth(url);
      setProbe(result);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = useCallback(async () => {
    const next = draft.trim() || DEFAULT_API_BASE;
    const result = await runProbe(next);
    if (!result.ok) return;
    const applied = setApiBase(next);
    setDraft(applied);
    onApplied?.(applied);
  }, [draft, onApplied, runProbe]);

  const resetDefault = useCallback(() => {
    setDraft(DEFAULT_API_BASE);
    setProbe(null);
  }, []);

  const help =
    variant === "settings"
      ? "与电脑同一局域网，或填 ngrok 等 https 隧道。改地址后先「检测连接」，通过再保存；切换后保留本机登录态，连不上请退出重登。"
      : "填写电脑上的 API 地址以配对（局域网如 http://192.168.x.x:18080，或 ngrok https 隧道）。先检测连接，通过后再登录。";

  const btnSecondary =
    "min-h-10 cursor-pointer rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-55";
  const btnPrimary =
    "min-h-10 cursor-pointer rounded-xl border-none bg-[var(--accent)] px-3.5 py-2.5 text-white disabled:opacity-55";

  return (
    <div
      className={cn(
        "mt-1 flex flex-col gap-2",
        variant === "login" && "mt-3 border-t border-[var(--border)] pt-3",
      )}
    >
      <label className="flex flex-col gap-1.5 text-[13px] text-[var(--muted)]">
        服务器地址
        <input
          className="box-border min-h-11 w-full rounded-[10px] border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={DEFAULT_API_BASE}
          value={draft}
          disabled={busy}
          onChange={(e) => {
            setDraft(e.target.value);
            setProbe(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
        />
      </label>
      <p className="m-0 text-xs leading-[1.45] text-[var(--muted)]">{help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => void runProbe(draft)}>
          {busy ? "检测中…" : "检测连接"}
        </button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void apply()}>
          {variant === "settings" ? "保存并使用" : "使用此服务器"}
        </button>
        {draft.trim().replace(/\/$/, "") !== DEFAULT_API_BASE ? (
          <button type="button" className={btnSecondary} disabled={busy} onClick={resetDefault}>
            恢复默认
          </button>
        ) : null}
      </div>
      {probe ? (
        <p
          className={cn(
            "m-0 text-[13px] leading-[1.4]",
            probe.ok ? "text-[var(--success,#1a7f37)]" : "text-[var(--danger)]",
          )}
          role="status"
        >
          {formatApiHealthProbe(probe)}
        </p>
      ) : (
        <p className="m-0 text-xs text-[var(--muted)]">当前：{getApiBase()}</p>
      )}
    </div>
  );
}
