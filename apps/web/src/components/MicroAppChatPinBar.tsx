import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { listMicroApps, type MicroApp } from "../api";
import { useMicroAppsStore } from "../stores/microApps";
import { cn } from "@/lib/utils";

type Props = {
  onOpenApp: (app: MicroApp) => void;
  className?: string;
};

/**
 * chat_pin strip above the composer — apps with placement surface=chat_pin.
 */
export function MicroAppChatPinBar({ onOpenApp, className }: Props) {
  const [pins, setPins] = useState<MicroApp[]>([]);
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
        <button
          key={app.id}
          type="button"
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border-0",
            "bg-[var(--bg-soft)] px-2.5 py-1 text-xs text-[var(--text)]",
            "hover:bg-[var(--bg-hover)]",
          )}
          title={app.description || app.title}
          onClick={() => onOpenApp(app)}
        >
          <span aria-hidden>{app.icon?.trim() || "🛠️"}</span>
          <span className="max-w-[8rem] truncate">{app.title}</span>
        </button>
      ))}
    </div>
  );
}
