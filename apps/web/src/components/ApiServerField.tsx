import { useCallback, useState } from "react";
import {
  DEFAULT_API_BASE,
  formatApiHealthProbe,
  getApiBase,
  probeApiHealth,
  setApiBase,
  type ApiHealthProbeResult,
} from "../api";
import { Button, Input, Label, TextField } from "@heroui/react";
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
  const [advancedOpen, setAdvancedOpen] = useState(variant === "settings");

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

  if (variant === "login" && !advancedOpen) {
    return (
      <div className={cn("mt-2 flex flex-col gap-1")}>
        <button
          type="button"
          className="self-start border-0 bg-transparent p-0 text-xs text-muted underline-offset-2 hover:underline"
          onClick={() => setAdvancedOpen(true)}
        >
          高级 · 服务器地址（当前 {getApiBase()}）
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", variant === "login" && "mt-2")}>
      <TextField
        name="api-server-url"
        value={draft}
        onChange={(v) => {
          setDraft(v);
          setProbe(null);
        }}
        isDisabled={busy}
      >
        <Label>服务器地址</Label>
        <Input
          variant="secondary"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={DEFAULT_API_BASE}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
        />
      </TextField>
      <p className="m-0 text-xs leading-snug text-muted">{help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" isDisabled={busy} onPress={() => void runProbe(draft)}>
          {busy ? "检测中…" : "检测连接"}
        </Button>
        <Button type="button" variant="secondary" isDisabled={busy} onPress={() => void apply()}>
          {variant === "settings" ? "保存并使用" : "使用此服务器"}
        </Button>
        {draft.trim().replace(/\/$/, "") !== DEFAULT_API_BASE.replace(/\/$/, "") ? (
          <Button type="button" variant="ghost" isDisabled={busy} onPress={resetDefault}>
            恢复默认
          </Button>
        ) : null}
      </div>
      {probe ? (
        <p className={cn("m-0 text-sm leading-snug", probe.ok ? "text-success" : "text-danger")} role="status">
          {formatApiHealthProbe(probe)}
        </p>
      ) : (
        <p className="m-0 text-xs text-muted">当前：{getApiBase()}</p>
      )}
      {variant === "login" ? (
        <button
          type="button"
          className="self-start border-0 bg-transparent p-0 text-xs text-muted underline-offset-2 hover:underline"
          onClick={() => setAdvancedOpen(false)}
        >
          收起
        </button>
      ) : null}
    </div>
  );
}
