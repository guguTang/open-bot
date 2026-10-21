import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  archiveMicroApp,
  microAppHasSurface,
  MICRO_APP_ENTRY_SURFACES,
  pinMicroApp,
  putMicroAppPlacements,
  type MicroApp,
  type MicroAppSurface,
} from "../api";
import { detectClientContext } from "../lib/clientEnv";
import { useSheetFormUi } from "./useIsTouchUi";
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
 * 「我的工具」 hub — dual-surface:
 * - sheetForm (touch-ui OR layout-narrow ≤860 / Capacitor): Settings-hub isomorphic
 *   (gray #F2F2F7 + white cards + ≥44 circular chrome).
 * - wide Web / desktop Tauri: hub list stays settings-dialog ~860×680; **open tool**
 *   uses settings-dialog--micro-fit (Dialog hugs tool content via resize postMessage).
 *   Stage has no card margin — iframe fills the snug shell under the top bar.
 */

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
  const sheetForm = useSheetFormUi();

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const openApp = apps.find((a) => a.id === openAppId) || null;

  function handleClose() {
    setOpenAppId(null);
    setCreatingRoutine(false);
    onClose();
  }

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
      const short = MICRO_APP_ENTRY_SURFACES.find((x) => x.surface === surface)?.short || surface;
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
          if (!v) handleClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          overlayClassName={cn(sheetForm && "settings-backdrop-shell")}
          className={cn(
            // border-0: DialogContent defaults include `border`; micro-fit also forces border:none in CSS.
            // overflow-clip: never paint an outer scrollbar on the dialog chrome.
            "modal settings-dialog max-w-none gap-0 overflow-hidden overflow-clip border-0 p-0 sm:max-w-none",
            sheetForm && "settings-dialog-shell",
            !sheetForm && openApp && "settings-dialog--micro-fit",
          )}
        >
          <DialogDescription className="sr-only">
            账号级固定入口。未确认不会自动出现在此列表。
          </DialogDescription>

          {openApp ? (
            <>
              <DialogTitle className="sr-only">{openApp.title}</DialogTitle>
              <MicroAppShell
                app={openApp}
                onBack={() => setOpenAppId(null)}
                onClose={handleClose}
                onArchive={() => void onArchive(openApp)}
                onAskPin={() => askPin(openApp)}
                onToggleSurface={(surface, enabled) => void toggleSurface(openApp, surface, enabled)}
                onAppUpdated={(a) => {
                  void refresh().then(() => setOpenAppId(a.id));
                }}
              />
            </>
          ) : creatingRoutine ? (
            <div
              className={cn(
                "micro-apps-hub",
                sheetForm
                  ? "settings-hub settings-hub-v2"
                  : "micro-apps-hub--desktop",
              )}
            >
              <DialogTitle className="sr-only">新建例行工具</DialogTitle>
              {sheetForm ? (
                <header className="settings-shell-subhead">
                  <button
                    type="button"
                    className="settings-shell-back"
                    aria-label="返回"
                    onClick={() => setCreatingRoutine(false)}
                  >
                    <ChevronLeft size={18} strokeWidth={2} aria-hidden />
                  </button>
                  <h2>新建例行工具</h2>
                  <button
                    type="button"
                    className="settings-hub-close"
                    aria-label="关闭"
                    onClick={handleClose}
                  >
                    <X size={16} strokeWidth={2} aria-hidden />
                  </button>
                </header>
              ) : (
                <header className="micro-apps-hub-desktop-head">
                  <button
                    type="button"
                    className="settings-close micro-apps-hub-desktop-icon"
                    aria-label="返回"
                    onClick={() => setCreatingRoutine(false)}
                  >
                    <ChevronLeft size={18} strokeWidth={2} aria-hidden />
                  </button>
                  <h2 className="micro-apps-hub-desktop-title">新建例行工具</h2>
                  <button
                    type="button"
                    className="settings-close"
                    aria-label="关闭"
                    onClick={handleClose}
                  >
                    <X size={16} strokeWidth={2} aria-hidden />
                  </button>
                </header>
              )}
              <div className={cn(sheetForm ? "settings-hub-scroll" : "micro-apps-hub-desktop-scroll")}>
                <section
                  className={cn(
                    "settings-card-padded micro-apps-hub-form-card",
                    sheetForm ? "settings-hub-card" : "settings-card micro-apps-hub-desktop-card",
                  )}
                >
                  <MicroAppRoutineCreateForm
                    onCancel={() => setCreatingRoutine(false)}
                    onCreated={(a) => {
                      setCreatingRoutine(false);
                      void refresh().then(() => askPin(a));
                    }}
                  />
                </section>
              </div>
            </div>
          ) : (
            <div
              className={cn(
                "micro-apps-hub",
                sheetForm
                  ? "settings-hub settings-hub-v2"
                  : "micro-apps-hub--desktop",
              )}
            >
              <DialogTitle className="sr-only">我的工具</DialogTitle>
              {sheetForm ? (
                <div className="settings-hub-top">
                  <h2 className="settings-hub-title">我的工具</h2>
                  <button
                    type="button"
                    className="settings-hub-close"
                    aria-label="关闭"
                    onClick={handleClose}
                  >
                    <X size={16} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              ) : (
                <header className="micro-apps-hub-desktop-head">
                  <h2 className="micro-apps-hub-desktop-title">我的工具</h2>
                  <button
                    type="button"
                    className="settings-close"
                    aria-label="关闭"
                    onClick={handleClose}
                  >
                    <X size={16} strokeWidth={2} aria-hidden />
                  </button>
                </header>
              )}

              <div className={cn(sheetForm ? "settings-hub-scroll" : "micro-apps-hub-desktop-scroll")}>
                {loading ? (
                  <div className="settings-empty" role="status">
                    <Loader2 className="size-4 animate-spin inline-block align-[-3px] mr-1.5" aria-hidden />
                    加载中…
                  </div>
                ) : error ? (
                  <div className="settings-empty" role="alert">
                    {error}
                  </div>
                ) : apps.length === 0 ? (
                  <EmptyHub onCreateRoutine={() => setCreatingRoutine(true)} />
                ) : (
                  <>
                    <section
                      className={cn(
                        sheetForm ? "settings-hub-card" : "settings-card micro-apps-hub-desktop-card",
                      )}
                    >
                      {apps.map((app) => (
                        <button
                          key={app.id}
                          type="button"
                          className={cn(
                            "settings-hub-row",
                            !sheetForm && "micro-apps-hub-desktop-row",
                            app.description || app.status === "draft" ? "settings-hub-row-account" : "",
                          )}
                          onClick={() => setOpenAppId(app.id)}
                        >
                          <span className="micro-apps-hub-icon" aria-hidden>
                            {app.icon?.trim() || "🛠️"}
                          </span>
                          <span className="settings-hub-row-main">
                            <span className="settings-hub-row-title">
                              {app.title}
                              {app.kind === "skill" || app.kind === "routine" ? (
                                <span className="micro-apps-hub-kind">
                                  {app.kind === "routine" ? "例行" : "skill"}
                                </span>
                              ) : null}
                            </span>
                            <span className="settings-hub-row-sub">
                              {app.description || statusLabel(app.status)}
                            </span>
                          </span>
                          {app.status === "draft" ? (
                            <span className="micro-apps-hub-badge">待固定</span>
                          ) : (
                            <ChevronRight className="settings-hub-chevron" size={16} strokeWidth={2} aria-hidden />
                          )}
                        </button>
                      ))}
                    </section>

                    <section
                      className={cn(
                        sheetForm ? "settings-hub-card" : "settings-card micro-apps-hub-desktop-card",
                      )}
                    >
                      <button
                        type="button"
                        className={cn("settings-hub-row", !sheetForm && "micro-apps-hub-desktop-row")}
                        onClick={() => setCreatingRoutine(true)}
                      >
                        <span className="settings-hub-row-main">
                          <span className="settings-hub-row-title">＋ 例行工具</span>
                          <span className="settings-hub-row-sub">到点自动运行的轻量工具</span>
                        </span>
                        <ChevronRight className="settings-hub-chevron" size={16} strokeWidth={2} aria-hidden />
                      </button>
                    </section>

                    {/* Placement / pin helpers stay reachable from shell more-sheet;
                        keep capability peek only for pinned apps with caps. */}
                    {apps.some((a) => a.status === "pinned" && (a.capabilities?.length || 0) > 0) ? (
                      <details className="micro-apps-hub-details">
                        <summary>能力矩阵预览</summary>
                        {apps
                          .filter((a) => a.status === "pinned" && (a.capabilities?.length || 0) > 0)
                          .map((app) => (
                            <div key={app.id} className="micro-apps-hub-details-block">
                              <div className="settings-hub-section-label">{app.title}</div>
                              <MicroAppCapabilityMatrix
                                capabilities={app.capabilities || []}
                                client={client}
                                compact
                              />
                              <div className="micro-apps-hub-surface-list">
                                {MICRO_APP_ENTRY_SURFACES.map(({ surface, label }) => (
                                  <label key={surface} className="micro-apps-hub-surface">
                                    <input
                                      type="checkbox"
                                      checked={microAppHasSurface(app, surface)}
                                      onChange={(e) => void toggleSurface(app, surface, e.target.checked)}
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                      </details>
                    ) : null}
                  </>
                )}
              </div>
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
        <DialogContent className="max-w-sm" showCloseButton={false}>
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
            {MICRO_APP_ENTRY_SURFACES.map(({ surface, label }) => (
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

function EmptyHub({ onCreateRoutine }: { onCreateRoutine: () => void }) {
  return (
    <div className="settings-empty micro-apps-hub-empty">
      <div>还没有固定的工具</div>
      <p>
        在对话里让助手做好一个小工具后，明确说「固定到我的工具」，或点确认卡同意后，才会出现在这里。
      </p>
      <button type="button" className="micro-apps-hub-empty-action" onClick={onCreateRoutine}>
        ＋ 例行工具
      </button>
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
