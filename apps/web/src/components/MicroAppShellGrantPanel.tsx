import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  deleteMicroAppGrant,
  listMicroAppGrants,
  putMicroAppGrant,
  type MicroAppGrant,
  type MicroAppGrantDecision,
} from "../api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  microAppId: string;
  className?: string;
};

const CAP = "host.shell.run";

type Mode = "ask" | MicroAppGrantDecision;

const MODE_LABEL: Record<Mode, string> = {
  ask: "每次询问（默认，弹「仅一次」）",
  allow_once: "仅一次（用后即失效）",
  always_allow: "始终允许（按白名单）",
  deny: "拒绝",
};

/**
 * host.shell.run approval settings per app grant (Phase 3).
 * Not default-disabled: no row = prompt with allow_once suggested.
 * Host Auto-review hard deny / exec_policy=deny always win over this.
 */
export function MicroAppShellGrantPanel({ microAppId, className }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [grant, setGrant] = useState<MicroAppGrant | null>(null);
  const [mode, setMode] = useState<Mode>("ask");
  const [allowText, setAllowText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMicroAppGrants(microAppId);
      // Account-wide row (machine_id="") is what the Host Bridge writes by default.
      const g =
        res.grants.find((x) => x.capability === CAP && !x.machine_id) ||
        res.grants.find((x) => x.capability === CAP) ||
        null;
      setGrant(g);
      const expired = g?.expires_at ? new Date(g.expires_at).getTime() <= Date.now() : false;
      setMode(!g || expired ? "ask" : ((g.decision as Mode) ?? "ask"));
      setAllowText((g?.command_allowlist || []).join("\n"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取授权失败");
    } finally {
      setLoading(false);
    }
  }, [microAppId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const machineId = grant?.machine_id || "";
      if (mode === "ask") {
        if (grant) await deleteMicroAppGrant(microAppId, CAP, machineId);
        toast.success("已恢复为每次询问");
      } else {
        const list = allowText
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        await putMicroAppGrant(microAppId, CAP, {
          decision: mode,
          machine_id: machineId,
          command_allowlist: mode === "always_allow" ? list : [],
        });
        toast.success("已保存命令授权");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 text-[11px] text-[var(--muted)]", className)}>
        <Loader2 className="size-3 animate-spin" /> 读取命令授权…
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 text-[11px] text-[var(--muted)]", className)}>
      <div className="flex flex-col gap-1">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={`shell-grant-${microAppId}`}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            <span className={m === "deny" ? "text-[var(--danger)]" : undefined}>{MODE_LABEL[m]}</span>
          </label>
        ))}
      </div>
      {mode === "always_allow" ? (
        <div className="space-y-1">
          <textarea
            className="h-20 w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px] text-[var(--text)]"
            value={allowText}
            onChange={(e) => setAllowText(e.target.value)}
            placeholder={"每行一个命令前缀，例如\ngit status\nls\nnpm run build"}
            aria-label="命令白名单"
          />
          <p>
            按词边界前缀匹配；含 <code>; &amp; | ` &lt; &gt; $(</code> 的复合命令永远重新询问。
            留空 = 任意简单命令（Auto-review 要确认的仍会询问）。
          </p>
        </div>
      ) : null}
      <p>宿主 Auto-review 硬拒绝（如 curl|sh、rm -rf /）与本机执行策略始终优先，授权无法绕过。</p>
      <div className="flex justify-end">
        <Button type="button" size="sm" className="h-7 text-xs" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-3 animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  );
}
