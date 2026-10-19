import { useEffect, useState } from "react";
import { Loader2, Pin, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  archiveMicroApp,
  pinMicroApp,
  putMicroAppPlacements,
  type MicroApp,
  type MicroAppSurface,
} from "../api";
import { detectClientContext } from "../lib/clientEnv";
import { useMicroAppsStore } from "../stores/microApps";
import { Button } from "@/components/ui/button";
import { MicroAppShell } from "./MicroAppShell";
import { MicroAppCapabilityMatrix } from "./MicroAppCapabilityMatrix";
import { MicroAppRoutineCreateForm } from "./MicroAppRoutineCreateForm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * 「我的工具」 hub — list + MicroAppShell + capability matrix.
 * Entry surfaces: hub (always) / chat_pin (Phase 2) / desktop_shortcut / mobile_shortcut (Phase 3,
 * in-app shortcut areas — not OS widgets).
 */

const ENTRY_SURFACES: Array<{ surface: MicroAppSurface; label: string; short: string }> = [
  { surface: "chat_pin", label: "聊天输入框上方快捷条（chat_pin）", short: "聊天栏" },
  { surface: "desktop_shortcut", label: "桌面端首页快捷区（desktop_shortcut）", short: "桌面快捷" },
  { surface: "mobile_shortcut", label: "手机端首页快捷区（mobile_shortcut）", short: "手机快捷" },
];

function hasSurface(app: MicroApp, surface: MicroAppSurface): boolean {
  return (app.placements || []).some((pl) => pl.surface === surface && pl.enabled);
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export function MicroAppsHub({ open, onClose }: Props) {
  const apps = useMicroAppsStore((s) => s.apps);
  const loading = useMicroAppsStore((s) => s.loading);
  const error = useMicroAppsStore((s) => s.error);
  const openAppId = useMicroAppsStore((s) => s.openAppId);
  const setOpenAppId = useMicroAppsStore((s) => s.setOpenAppId);
  const refresh = useMicroAppsStore((s) => s.refresh);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [confirmPin, setConfirmPin] = useState<MicroApp | null>(null);
  const [pinSurfaces, setPinSurfaces] = useState<MicroAppSurface[]>([]);
  const [creatingRoutine, setCreatingRoutine] = useState(false);
  const client = detectClientContext();

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const openApp = apps.find((a) => a.id === openAppId) || null;

  async function onConfirmPin() {
    if (!confirmPin) return;
    setPinningId(confirmPin.id);
    try {
      await pinMicroApp(confirmPin.id, "user_pin", {
        chat_pin: pinSurfaces.includes("chat_pin"),
        surfaces: pinSurfaces.filter((x) => x !== "chat_pin"),
      });
      toast.success(`已固定「${confirmPin.title}」到我的工具`);
      setConfirmPin(null);
      setPinSurfaces([]);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "固定失败");
    } finally {
      setPinningId(null);
    }
  }

  async function toggleSurface(app: MicroApp, surface: MicroAppSurface, enabled: boolean) {
    const others = (app.placements || [])
      .filter((p) => p.surface !== surface)
      .map((p) => ({
        surface: p.surface,
        context_id: p.context_id || "",
        sort_rank: p.sort_rank,
        enabled: p.enabled,
        id: p.id,
      }));
    if (enabled) {
      others.push({ surface, context_id: "", sort_rank: 0, enabled: true, id: "" });
    }
    if (!others.some((p) => p.surface === "hub")) {
      others.unshift({ surface: "hub", context_id: "", sort_rank: 0, enabled: true, id: "" });
    }
    try {
      await putMicroAppPlacements(app.id, others);
      const short = ENTRY_SURFACES.find((x) => x.surface === surface)?.short || surface;
      toast.success(enabled ? `已加入${short}` : `已从${short}移除`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "更新入口失败");
    }
  }

  async function onArchive(app: MicroApp) {
    try {
      await archiveMicroApp(app.id);
      toast.success(`已下架「${app.title}」`);
      if (openAppId === app.id) setOpenAppId(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "下架失败");
    }
  }

  function askPin(app: MicroApp) {
    setPinSurfaces([]);
    setConfirmPin(app);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setOpenAppId(null);
            onClose();
          }
        }}
      >
        <DialogContent className="flex max-h-[min(720px,90vh)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="shrink-0 border-b border-[var(--border)] px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4 opacity-70" aria-hidden />
              我的工具
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--muted)]">
              账号级固定入口。未确认不会自动出现在此列表。可挂到聊天栏、桌面/手机首页快捷区。
            </DialogDescription>
          </DialogHeader>

          {openApp ? (
            <MicroAppShell
              app={openApp}
              onBack={() => setOpenAppId(null)}
              onAppUpdated={(a) => {
                void refresh().then(() => setOpenAppId(a.id));
              }}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {creatingRoutine ? (
                <MicroAppRoutineCreateForm
                  onCancel={() => setCreatingRoutine(false)}
                  onCreated={(a) => {
                    setCreatingRoutine(false);
                    void refresh().then(() => askPin(a));
                  }}
                />
              ) : (
                <div className="mb-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-[var(--muted)]"
                    onClick={() => setCreatingRoutine(true)}
                  >
                    ＋ 例行工具
                  </Button>
                </div>
              )}
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--muted)]">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  加载中…
                </div>
              ) : error ? (
                <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-[var(--danger)]">
                  {error}
                </div>
              ) : apps.length === 0 ? (
                <EmptyHub />
              ) : (
                <ul className="flex flex-col gap-1">
                  {apps.map((app) => (
                    <li key={app.id}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left",
                          "hover:bg-[var(--bg-soft)]",
                        )}
                        onClick={() => setOpenAppId(app.id)}
                      >
                        <span
                          className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--bg-soft)] text-sm"
                          aria-hidden
                        >
                          {app.icon?.trim() || "🛠️"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--text)]">
                            {app.title}
                            {app.kind === "skill" || app.kind === "routine" ? (
                              <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">
                                {app.kind === "routine" ? "例行" : "skill"}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                            {app.description || statusLabel(app.status)}
                          </span>
                        </span>
                        {app.status === "draft" ? (
                          <span
                            role="presentation"
                            className="mt-1 shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-800"
                            onClick={(e) => {
                              e.stopPropagation();
                              askPin(app);
                            }}
                          >
                            待固定
                          </span>
                        ) : null}
                      </button>
                      {app.status === "draft" ? (
                        <div className="mb-1 flex justify-end gap-2 px-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={pinningId === app.id}
                            onClick={() => askPin(app)}
                          >
                            <Pin className="size-3" aria-hidden />
                            固定到我的工具
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-[var(--muted)]"
                            onClick={() => void onArchive(app)}
                          >
                            下架
                          </Button>
                        </div>
                      ) : app.status === "pinned" ? (
                        <div className="mb-2 space-y-1 px-3">
                          {ENTRY_SURFACES.map(({ surface, label }) => (
                            <label
                              key={surface}
                              className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--muted)]"
                            >
                              <input
                                type="checkbox"
                                checked={hasSurface(app, surface)}
                                onChange={(e) => void toggleSurface(app, surface, e.target.checked)}
                              />
                              {label}
                            </label>
                          ))}
                          {(app.capabilities?.length || 0) > 0 ? (
                            <details>
                              <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
                                能力矩阵
                              </summary>
                              <MicroAppCapabilityMatrix
                                className="mt-1"
                                capabilities={app.capabilities || []}
                                client={client}
                                compact
                              />
                            </details>
                          ) : null}
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-[var(--muted)]"
                              onClick={() => void onArchive(app)}
                            >
                              下架
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(confirmPin)}
        onOpenChange={(v) => {
          if (!v) {
            setConfirmPin(null);
            setPinSurfaces([]);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认固定？</DialogTitle>
            <DialogDescription>
              将「{confirmPin?.title}」固定到「我的工具」。仅在你确认后才会出现在各端入口；不会静默固定。
              {confirmPin?.kind === "skill" && confirmPin.skill_slug ? (
                <span className="mt-2 block text-xs">
                  技能型：固定后将启用 <code>{confirmPin.skill_slug}</code>
                  （账号{confirmPin.agent_id ? " + 来源 Bot" : ""}）。
                </span>
              ) : null}
              {confirmPin?.kind === "routine" ? (
                <span className="mt-2 block text-xs">
                  例行型：
                  {confirmPin.routine_id
                    ? "固定后绑定已有例行任务。"
                    : `固定后按配方创建例行任务${
                        confirmPin.routine_config?.schedule_cron
                          ? `（${confirmPin.routine_config.schedule_cron} · ${confirmPin.routine_config.timezone || "Asia/Shanghai"}）`
                          : ""
                      }，到点自动运行。`}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <div className="text-[11px] text-[var(--muted)]">同时放到（应用内入口，非系统小组件）：</div>
            {ENTRY_SURFACES.map(({ surface, label }) => (
              <label key={surface} className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={pinSurfaces.includes(surface)}
                  onChange={(e) =>
                    setPinSurfaces((cur) =>
                      e.target.checked ? [...cur.filter((x) => x !== surface), surface] : cur.filter((x) => x !== surface),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmPin(null)}>
              取消
            </Button>
            <Button type="button" disabled={Boolean(pinningId)} onClick={() => void onConfirmPin()}>
              {pinningId ? <Loader2 className="size-4 animate-spin" /> : null}
              确认固定
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptyHub() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-[var(--bg-soft)] text-2xl" aria-hidden>
        🛠️
      </span>
      <div className="text-sm font-medium text-[var(--text)]">还没有固定的工具</div>
      <p className="max-w-xs text-xs leading-relaxed text-[var(--muted)]">
        在对话里让助手做好一个小工具后，明确说「固定到我的工具」，或点确认卡同意后，才会出现在这里。
      </p>
    </div>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case "draft":
      return "草稿（待你确认固定）";
    case "pinned":
      return "已固定";
    case "archived":
      return "已下架";
    default:
      return status;
  }
}
