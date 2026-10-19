import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createMicroApp, type MicroApp } from "../api";
import { Button } from "@/components/ui/button";

type Props = {
  onCreated: (app: MicroApp) => void;
  onCancel: () => void;
};

const field =
  "w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--text)]";

/**
 * Manual kind=routine draft (Phase 3). Clicking 「保存草稿」 is an explicit user save
 * (user_intent=user_save); pin is still a separate confirm step.
 */
export function MicroAppRoutineCreateForm({ onCreated, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("⏰");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [tz, setTz] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
    } catch {
      return "Asia/Shanghai";
    }
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const app = await createMicroApp({
        title: title.trim(),
        icon: icon.trim(),
        kind: "routine",
        description: cron.trim() ? `例行 · ${cron.trim()}` : "例行",
        routine_config: {
          name: title.trim(),
          prompt: prompt.trim(),
          schedule_cron: cron.trim(),
          timezone: tz.trim(),
        },
        user_intent: "user_save",
      });
      toast.success("已保存为草稿，确认固定后才会创建例行任务");
      onCreated(app);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded-xl border border-[var(--border)] p-3">
      <div className="text-xs font-medium text-[var(--text)]">新建例行工具（固定计划配方）</div>
      <div className="flex gap-2">
        <input className={`${field} w-12 text-center`} value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="图标" />
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="名称，例如 工作日早报" />
      </div>
      <textarea
        className={`${field} h-16`}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="到点让助手做什么，例如：汇总昨天的 GitHub PR 和待办"
      />
      <div className="flex gap-2">
        <input className={`${field} font-mono`} value={cron} onChange={(e) => setCron(e.target.value)} placeholder="cron：分 时 日 月 周" aria-label="cron" />
        <input className={field} value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Shanghai" aria-label="时区" />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={saving || !title.trim() || !prompt.trim()}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : null}
          保存草稿
        </Button>
      </div>
    </div>
  );
}
