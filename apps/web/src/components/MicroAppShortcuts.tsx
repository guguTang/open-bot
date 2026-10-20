import { useEffect, useState } from "react";
import { listMicroApps, type MicroApp } from "../api";
import { useMicroAppsStore } from "../stores/microApps";
import { cn } from "@/lib/utils";

type Props = {
  /** desktop_shortcut (desktop / wide home) or mobile_shortcut (mobile entry). */
  surface: "desktop_shortcut" | "mobile_shortcut";
  className?: string;
};

/**
 * In-app shortcut area (Phase 3) — NOT an OS widget. Lists pinned apps whose placement
 * surface matches; click opens MicroAppShell inside 「我的工具」.
 */
export function MicroAppShortcuts({ surface, className }: Props) {
  const [items, setItems] = useState<MicroApp[]>([]);
  const appsVersion = useMicroAppsStore((s) => s.apps);

  useEffect(() => {
    let cancelled = false;
    void listMicroApps({ surface, status: "pinned" })
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [surface, appsVersion]);

  if (items.length === 0) return null;

  const open = (app: MicroApp) => {
    const st = useMicroAppsStore.getState();
    st.setHubOpen(true);
    st.setOpenAppId(app.id);
  };

  const mobile = surface === "mobile_shortcut";
  return (
    <section
      className={cn("micro-app-shortcuts shrink-0 px-2 pb-1.5 pt-1", className)}
      aria-label={mobile ? "手机快捷工具" : "桌面快捷工具"}
      data-surface={surface}
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-[var(--muted)]">快捷工具</div>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map((app) => (
          <button
            key={app.id}
            type="button"
            title={app.description || app.title}
            onClick={() => open(app)}
            className={cn(
              "flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-xl border-0 bg-transparent px-1 py-1.5",
              "hover:bg-[var(--bg-soft)] active:bg-[var(--bg-soft)]",
              mobile ? "min-h-16" : "",
            )}
          >
            <span
              className={cn(
                "grid place-items-center rounded-lg bg-[var(--bg-soft)]",
                mobile ? "size-11 text-lg" : "size-8 text-sm",
              )}
              aria-hidden
            >
              {app.icon?.trim() || "🛠️"}
            </span>
            <span className="w-full truncate text-center text-[11px] text-[var(--text)]">{app.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
