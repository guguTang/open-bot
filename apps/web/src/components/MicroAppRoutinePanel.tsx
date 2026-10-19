import { useCallback, useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { listRoutines, runRoutine, updateRoutine, type MicroApp, type Routine } from "../api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  app: MicroApp;
  className?: string;
};

function fmtTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

/**
 * kind=routine micro-app (Phase 3): shows the recipe and the bound /v1/routines row.
 * Pin (user_intent) materializes routine_config → routines; archive pauses it.
 */
export function MicroAppRoutinePanel({ app, className }: Props) {
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const cfg = app.routine_config || null;

  const load = useCallback(async () => {
    if (!app.routine_id) {
      setRoutine(null);
      return;
    }
    setLoading(true);
    try {
      const list = await listRoutines();
      setRoutine(list.find((r) => r.id === app.routine_id) || null);
    } catch {
      setRoutine(null);
    } finally {
      setLoading(false);
    }
  }, [app.routine_id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRun() {
    if (!routine) return;
    setBusy(true);
    try {
      const res = await runRoutine(routine.id);
      toast.success(`已运行：${res.run?.status || "ok"}`);
      setRoutine(res.routine || routine);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "运行失败");
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(enabled: boolean) {
    if (!routine) return;
    setBusy(true);
    try {
      setRoutine(await updateRoutine(routine.id, { enabled }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  const schedule = routine?.schedule_cron || cfg?.schedule_cron || "";
  const tz = routine?.timezone || cfg?.timezone || "Asia/Shanghai";
  const triggers = routine?.triggers || cfg?.triggers || [];

  return (
    <div className={cn("w-full max-w-sm space-y-2 text-left text-xs text-[var(--muted)]", className)}>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
        <dt>计划</dt>
        <dd className="font-mono text-[var(--text)]">{schedule || "（仅事件触发）"} · {tz}</dd>
        <dt>触发</dt>
        <dd className="text-[var(--text)]">
          {triggers.length
            ? triggers.map((t) => `${t.source}:${t.type}`).join("，")
            : "—"}
        </dd>
        <dt>提示词</dt>
        <dd className="line-clamp-3 whitespace-pre-wrap text-[var(--text)]">
          {routine?.prompt || cfg?.prompt || "—"}
        </dd>
        {routine ? (
          <>
            <dt>上次运行</dt>
            <dd>
              {fmtTime(routine.last_run_at)}
              {routine.last_run?.status ? ` · ${routine.last_run.status}` : ""}
            </dd>
            {routine.last_error ? (
              <>
                <dt>最近错误</dt>
                <dd className="text-[var(--danger)]">{routine.last_error}</dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>

      {app.routine_id ? (
        loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="size-3 animate-spin" /> 读取例行任务…
          </div>
        ) : routine ? (
          <div className="flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={routine.enabled}
                disabled={busy}
                onChange={(e) => void onToggle(e.target.checked)}
              />
              启用定时/触发
            </label>
            <Button type="button" size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void onRun()}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
              立即运行
            </Button>
          </div>
        ) : (
          <p className="text-[var(--danger)]">绑定的例行任务不存在（可能已在设置中删除）。</p>
        )
      ) : (
        <p>
          {app.status === "pinned"
            ? "尚未绑定例行任务。"
            : "固定到「我的工具」后，将按此配方创建例行任务（设置 → 例行任务 可见）。"}
        </p>
      )}
      <p className="text-[11px]">结果写入例行会话「例行 · 名称」。事件触发（Slack/GitHub/HTTP）需在设置里先配好入站 Hook。</p>
    </div>
  );
}
