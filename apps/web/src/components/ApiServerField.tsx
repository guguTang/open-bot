import { useCallback, useState } from "react";
import {
  DEFAULT_API_BASE,
  formatApiHealthProbe,
  getApiBase,
  probeApiHealth,
  setApiBase,
  type ApiHealthProbeResult,
} from "../api";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

  return (
    <FieldGroup
      className={cn(
        "gap-2",
        variant === "login" && "mt-3 border-t border-border pt-3",
      )}
    >
      <Field>
        <FieldLabel htmlFor="api-server-url">服务器地址</FieldLabel>
        <Input
          id="api-server-url"
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
        <FieldDescription>{help}</FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void runProbe(draft)}>
          {busy ? "检测中…" : "检测连接"}
        </Button>
        <Button type="button" disabled={busy} onClick={() => void apply()}>
          {variant === "settings" ? "保存并使用" : "使用此服务器"}
        </Button>
        {draft.trim().replace(/\/$/, "") !== DEFAULT_API_BASE ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={resetDefault}>
            恢复默认
          </Button>
        ) : null}
      </div>
      {probe ? (
        <p
          className={cn(
            "m-0 text-sm leading-snug",
            probe.ok ? "text-green-700 dark:text-green-400" : "text-destructive",
          )}
          role="status"
        >
          {formatApiHealthProbe(probe)}
        </p>
      ) : (
        <FieldDescription>当前：{getApiBase()}</FieldDescription>
      )}
    </FieldGroup>
  );
}
