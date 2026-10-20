import { useEffect, useState } from "react";
import { Wrench, X } from "lucide-react";
import { toast } from "sonner";
import {
  getMicroApp,
  putMicroAppPlacements,
  listMicroApps,
  type MicroApp,
} from "../api";
import { useMicroAppsStore } from "../stores/microApps";
import { cn } from "@/lib/utils";

type Props = {
  onOpenApp: (app: MicroApp) => void;
  className?: string;
};

/**
 * chat_pin strip above the composer — apps with placement surface=chat_pin.
 * Chip opens the app; × cancels chat_pin only (does not archive the app).
 */
export function MicroAppChatPinBar({ onOpenApp, className }: Props) {
  const [pins, setPins] = useState<MicroApp[]>([]);
  const [unpinningId, setUnpinningId] = useState<string | null>(null);
  const hubOpen = useMicroAppsStore((s) => s.hubOpen);
  const appsVersion = useMicroAppsStore((s) => s.apps);

  useEffect(() => {
    let cancelled = false;
    void listMicroApps({ surface: "chat_pin", status: "pinned" })
      .then((list) => {
        if (!cancelled) setPins(list);
      })
      .catch(() => {
        if (!cancelled) setPins([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hubOpen, appsVersion]);

  async function cancelChatPin(app: MicroApp) {
    setUnpinningId(app.id);
    try {
      const full = await getMicroApp(app.id);
      const others = (full.placements || [])
        .filter((p) => p.surface !== "chat_pin")
        .map((p) => ({
          surface: p.surface,
          context_id: p.context_id || "",
          sort_rank: p.sort_rank,
          enabled: p.enabled,
          id: p.id,
        }));
      if (!others.some((p) => p.surface === "hub")) {
        others.unshift({ surface: "hub", context_id: "", sort_rank: 0, enabled: true, id: "" });
      }
      await putMicroAppPlacements(app.id, others);
      toast.success("已取消聊天栏快捷");
      await useMicroAppsStore.getState().refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "取消失败");
    } finally {
      setUnpinningId(null);
    }
  }

  if (pins.length === 0) return null;

  return (
    <div
      className={cn(
        "micro-app-chat-pin-bar flex items-center gap-1.5 overflow-x-auto px-1 pb-1.5 pt-0.5",
        className,
      )}
      role="toolbar"
      aria-label="聊天固定工具"
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--muted)]" title="chat_pin">
        <Wrench className="inline size-3 opacity-70" aria-hidden />
      </span>
      {pins.map((app) => (
        <span
          key={app.id}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded-full",
            "bg-[var(--bg-soft)] text-xs text-[var(--text)]",
          )}
        >
          <button
            type="button"
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent",
              "py-1 pl-2.5 pr-1 text-xs text-[var(--text)]",
              "hover:bg-[var(--bg-hover)]",
            )}
            title={app.description || app.title}
            onClick={() => onOpenApp(app)}
          >
            <span aria-hidden>{app.icon?.trim() || "🛠️"}</span>
            <span className="max-w-[8rem] truncate">{app.title}</span>
          </button>
          <button
            type="button"
            className={cn(
              "mr-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0",
              "bg-transparent text-[var(--muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
              "disabled:opacity-50",
            )}
            title="取消聊天栏快捷"
            aria-label={`取消「${app.title}」的聊天栏快捷`}
            disabled={unpinningId === app.id}
            onClick={(e) => {
              e.stopPropagation();
              void cancelChatPin(app);
            }}
          >
            <X size={12} strokeWidth={2.2} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
