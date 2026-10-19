import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { MicroAppGrantDecision } from "../api";
import type { GrantPromptResult } from "../lib/microApp/hostBridge";

type Props = {
  open: boolean;
  capability: string;
  suggested?: string;
  highSensitivity?: boolean;
  /** host.shell.run: exact command requested by the micro-app. */
  command?: string;
  /** host.shell.run: default allowlist prefix for 「始终允许」. */
  suggestedPrefix?: string;
  /** An always_allow grant exists but didn't cover this command. */
  overridingAlwaysAllow?: boolean;
  reason?: string;
  onDecide: (r: GrantPromptResult) => void;
  onCancel: () => void;
};

const LABELS: Record<string, string> = {
  "host.screenshot": "截取屏幕",
  "host.fs.read": "读取你选择的文件",
  "host.fs.write": "保存文件到你选择的位置",
  "host.shell.run": "在本机运行命令",
  "cloud.http": "由服务端代发网络请求",
  "chat.attach": "把结果发到当前会话",
  "ui.notify": "显示应用内通知",
};

const DECISION_LABEL: Record<string, string> = {
  allow_once: "仅一次",
  always_allow: "始终允许",
  deny: "拒绝",
};

/**
 * Tri-state approval (deny / allow_once / always_allow). Default focus is 「仅一次」.
 * host.shell.run shows the command and lets 「始终允许」 scope to a command-prefix allowlist.
 */
export function MicroAppGrantDialog({
  open,
  capability,
  suggested,
  highSensitivity,
  command,
  suggestedPrefix,
  overridingAlwaysAllow,
  reason,
  onDecide,
  onCancel,
}: Props) {
  const label = LABELS[capability] || capability;
  const isShell = capability === "host.shell.run";
  const [scopeToPrefix, setScopeToPrefix] = useState(true);
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrefix(suggestedPrefix || "");
    setScopeToPrefix(Boolean(suggestedPrefix));
  }, [open, suggestedPrefix, command]);

  const decide = (decision: MicroAppGrantDecision) => {
    if (isShell && decision === "always_allow") {
      onDecide({ decision, allowlistEntry: scopeToPrefix ? prefix.trim() : "" });
      return;
    }
    onDecide({ decision });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>授权微应用能力</DialogTitle>
          <DialogDescription asChild>
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
              {highSensitivity ? (
                <span className="block text-[11px] text-amber-700">
                  高敏感能力：默认「仅一次」。宿主 Auto-review 硬拒绝仍然生效，任何授权都绕不过。
                </span>
              ) : null}
              {suggested ? (
                <span className="block text-[11px]">建议：{DECISION_LABEL[suggested] || suggested}</span>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button type="button" autoFocus onClick={() => decide("allow_once")}>
            仅一次
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isShell && scopeToPrefix && !prefix.trim()}
            onClick={() => decide("always_allow")}
          >
            始终允许{isShell && scopeToPrefix && prefix.trim() ? `「${prefix.trim()}」` : ""}
          </Button>
          <Button type="button" variant="ghost" className="text-[var(--danger)]" onClick={() => decide("deny")}>
            {overridingAlwaysAllow ? "拒绝本次" : "拒绝"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
