import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Ellipsis, Loader2, Pin, PinOff, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMicroAppRuntime,
  microAppHasSurface,
  MICRO_APP_ENTRY_SURFACES,
  uploadMicroAppBundle,
  type MicroApp,
  type MicroAppSurface,
} from "../api";
import { detectClientContext } from "../lib/clientEnv";
import { summarizeUnavailable } from "../lib/microApp/capabilities";
import { MicroAppCapabilityMatrix } from "./MicroAppCapabilityMatrix";
import { buildMicroAppSrcdoc } from "../lib/microApp/sdk";
import {
  clampMicroShellSize,
  microShellHeightOverflow,
  MICRO_SHELL_DEFAULT_HEIGHT,
  MICRO_SHELL_DEFAULT_WIDTH,
  MICRO_SHELL_MIN_HEIGHT,
  MICRO_SHELL_MIN_WIDTH,
  type MicroShellSize,
} from "../lib/microApp/shellSize";
import {
  createMicroAppMessageHandler,
  type GrantPromptOptions,
  type GrantPromptResult,
  type ActionConfirmOptions,
} from "../lib/microApp/hostBridge";
import { useWorkspaceStore } from "../stores/workspace";
import { Button } from "@/components/ui/button";
import { MicroAppGrantDialog } from "./MicroAppGrantDialog";
import { MicroAppShellGrantPanel } from "./MicroAppShellGrantPanel";
import { MicroAppRoutinePanel } from "./MicroAppRoutinePanel";
import { MicroAppMoreSheet } from "./MicroAppMoreSheet";
import { useConfirm } from "./ConfirmProvider";
import { useSheetFormUi } from "./useIsTouchUi";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Props = {
  app: MicroApp;
  onBack: () => void;
  /** Close entire「我的工具」hub (Settings subpage ×). */
  onClose: () => void;
  onArchive?: () => void;
  onAskPin?: () => void;
  /** Toggle chat_pin / desktop_shortcut / mobile_shortcut via PUT placements. */
  onToggleSurface?: (surface: MicroAppSurface, enabled: boolean) => void;
  onAppUpdated?: (app: MicroApp) => void;
};

type GrantPromptState = GrantPromptOptions & {
  resolve: (d: GrantPromptResult | null) => void;
};

export function MicroAppShell({
  app,
  onBack,
  onClose,
  onArchive,
  onAskPin,
  onToggleSurface,
  onAppUpdated,
}: Props) {
  const conversation = useWorkspaceStore((s) => s.conversation);
  const confirm = useConfirm();
  const sheetForm = useSheetFormUi();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [grantPrompt, setGrantPrompt] = useState<GrantPromptState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const revokeRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameSize, setFrameSize] = useState<MicroShellSize | null>(null);
  const [frameScroll, setFrameScroll] = useState(false);

  const client = useMemo(() => {
    try {
      return detectClientContext();
    } catch {
      return null;
    }
  }, []);

  const unavailable = useMemo(
    () => summarizeUnavailable(app.capabilities || [], client),
    [app.capabilities, client],
  );

  const promptGrant = (opts: GrantPromptOptions) =>
    new Promise<GrantPromptResult | null>((resolve) => {
      setGrantPrompt({
        ...opts,
        suggested: String(opts.suggested || "allow_once"),
        resolve,
      });
    });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSrcdoc(null);
    setFrameSize(null);
    setFrameScroll(false);
    revokeRef.current?.();
    revokeRef.current = null;

    void (async () => {
      try {
        const runtime = await fetchMicroAppRuntime(app.id);
        if (cancelled) return;
        const built = buildMicroAppSrcdoc(runtime.entrypoint, runtime.files);
        revokeRef.current = built.revoke;
        setSrcdoc(built.srcdoc);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      revokeRef.current?.();
      revokeRef.current = null;
    };
  }, [app.id, app.bundle_hash, app.updated_at]);

  useEffect(() => {
    const promptActionConfirm = (opts: ActionConfirmOptions) =>
      confirm({
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel || "确认",
        cancelLabel: opts.cancelLabel || "取消",
      });

    const handler = createMicroAppMessageHandler({
      microAppId: app.id,
      declared: app.capabilities || [],
      agentId: app.agent_id || null,
      conversationId: conversation?.id,
      client,
      promptGrant,
      promptActionConfirm,
    });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [app.id, app.agent_id, app.capabilities, conversation?.id, client, confirm]);

  // Content-fit: sandboxed iframe has no allow-same-origin — size via postMessage only.
  useEffect(() => {
    const onResizeMsg = (ev: MessageEvent) => {
      const data = ev.data as {
        source?: string;
        type?: string;
        width?: number;
        height?: number;
      } | null;
      if (!data || data.source !== "openbot.micro" || data.type !== "resize") return;
      const iframe = iframeRef.current;
      if (iframe?.contentWindow && ev.source && ev.source !== iframe.contentWindow) return;
      const rawW = Number(data.width);
      const rawH = Number(data.height);
      if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) return;
      const clamped = clampMicroShellSize({
        width: rawW,
        height: rawH,
        narrow: sheetForm,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      setFrameSize(clamped);
      setFrameScroll(microShellHeightOverflow(rawH, clamped.height));
    };
    window.addEventListener("message", onResizeMsg);
    return () => window.removeEventListener("message", onResizeMsg);
  }, [app.id, sheetForm]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const res = await uploadMicroAppBundle(app.id, file);
      toast.success("Bundle 已上传");
      onAppUpdated?.(res.micro_app);
      const runtime = await fetchMicroAppRuntime(app.id);
      revokeRef.current?.();
      const built = buildMicroAppSrcdoc(runtime.entrypoint, runtime.files);
      revokeRef.current = built.revoke;
      setFrameSize(null);
      setFrameScroll(false);
      setSrcdoc(built.srcdoc);
      setError("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  const canPin = app.status === "draft" && Boolean(onAskPin);
  const canUpload = true;
  const hasBundle = Boolean(app.bundle_hash) || Boolean(srcdoc);
  const canArchive = Boolean(onArchive);
  const canManageShortcuts = app.status === "pinned" && Boolean(onToggleSurface);
  const shortcutActions = canManageShortcuts
    ? MICRO_APP_ENTRY_SURFACES.map(({ surface, cancelLabel, addLabel }) => {
        const pinned = microAppHasSurface(app, surface);
        return {
          key: surface,
          label: pinned ? cancelLabel : addLabel,
          pinned,
          onClick: () => onToggleSurface?.(surface, !pinned),
        };
      })
    : [];

  return (
    <div
      className={cn(
        "micro-app-shell",
        "micro-app-shell--fit",
        sheetForm ? "settings-hub" : "micro-app-shell--desktop",
      )}
      style={
        !sheetForm
          ? {
              ["--micro-shell-content-w" as string]: `${frameSize?.width ?? MICRO_SHELL_DEFAULT_WIDTH}px`,
              ["--micro-shell-content-h" as string]: `${frameSize?.height ?? MICRO_SHELL_DEFAULT_HEIGHT}px`,
            }
          : undefined
      }
    >
      <header
        className={cn(
          sheetForm
            ? "settings-shell-subhead micro-app-shell-subhead"
            : "micro-apps-hub-desktop-head micro-app-shell-desktop-head",
        )}
      >
        <button
          type="button"
          className={sheetForm ? "settings-shell-back" : "settings-close micro-apps-hub-desktop-icon"}
          aria-label="返回"
          onClick={onBack}
        >
          <ChevronLeft size={18} strokeWidth={2} aria-hidden />
        </button>
        <h2 className={sheetForm ? undefined : "micro-apps-hub-desktop-title"}>{app.title}</h2>
        <div className="micro-app-shell-subhead-actions">
          {sheetForm ? (
            <button
              type="button"
              className="settings-hub-close"
              aria-label="更多"
              onClick={() => setMoreOpen(true)}
            >
              <Ellipsis size={16} strokeWidth={2} aria-hidden />
            </button>
          ) : (
            <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button" className="settings-close" aria-label="更多">
                  <Ellipsis size={16} strokeWidth={2} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                {canPin && onAskPin ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      onAskPin();
                    }}
                  >
                    <Pin size={16} strokeWidth={2} aria-hidden />
                    固定到我的工具
                  </DropdownMenuItem>
                ) : null}
                {shortcutActions.map((a) => (
                  <DropdownMenuItem
                    key={a.key}
                    onSelect={() => {
                      a.onClick();
                    }}
                  >
                    {a.pinned ? (
                      <PinOff size={16} strokeWidth={2} aria-hidden />
                    ) : (
                      <Pin size={16} strokeWidth={2} aria-hidden />
                    )}
                    {a.label}
                  </DropdownMenuItem>
                ))}
                {shortcutActions.length > 0 && canUpload ? <DropdownMenuSeparator /> : null}
                {canUpload ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      fileRef.current?.click();
                    }}
                  >
                    <Upload size={16} strokeWidth={2} aria-hidden />
                    {hasBundle ? "重新上传 Bundle" : "手动上传 Bundle（可选）"}
                  </DropdownMenuItem>
                ) : null}
                {canArchive && onArchive ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        onArchive();
                      }}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                      下架
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            type="button"
            className={sheetForm ? "settings-hub-close" : "settings-close"}
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onUpload(f);
        }}
      />

      <div className="micro-app-shell-body">
        {(app.capabilities?.length || 0) > 0 ? (
          <details className="micro-app-shell-panel">
            <summary>
              能力矩阵
              {unavailable.length > 0
                ? ` · ${unavailable.length} 项在此端不可用`
                : " · 本端均可尝试"}
            </summary>
            <MicroAppCapabilityMatrix
              className="mt-2"
              capabilities={app.capabilities || []}
              client={client}
              compact
            />
          </details>
        ) : null}

        {(app.capabilities || []).includes("host.shell.run") ? (
          <details className="micro-app-shell-panel">
            <summary>命令授权（host.shell.run · 三态 + 白名单）</summary>
            <MicroAppShellGrantPanel className="mt-2" microAppId={app.id} />
          </details>
        ) : null}

        <div
          className={cn(
            "micro-app-shell-stage",
            frameSize && "micro-app-shell-stage--sized",
            frameScroll && "micro-app-shell-stage--scroll",
          )}
        >
          {app.kind === "routine" && !loading && (!srcdoc || /bundle_not_found|404/i.test(error)) ? (
            <div className="micro-app-shell-placeholder">
              <p className="micro-app-shell-placeholder-title">例行型微应用</p>
              <MicroAppRoutinePanel app={app} />
            </div>
          ) : app.kind === "skill" && !loading && (!srcdoc || /bundle_not_found|404/i.test(error)) ? (
            <div className="micro-app-shell-placeholder">
              <p className="micro-app-shell-placeholder-title">技能型微应用</p>
              <p className="settings-empty" style={{ padding: 0 }}>
                已绑定技能 <code>{app.skill_slug || "（未设置 skill_slug）"}</code>。
                固定到「我的工具」时会在账号与来源 Bot 上启用对应 agent_skills。
              </p>
              <MicroAppCapabilityMatrix
                capabilities={app.capabilities || []}
                client={client}
                className="w-full max-w-sm text-left"
              />
            </div>
          ) : loading ? (
            <div className="micro-app-shell-placeholder settings-empty" role="status">
              <Loader2 className="size-4 animate-spin inline-block align-[-3px] mr-1.5" aria-hidden /> 加载中…
            </div>
          ) : error ? (
            <div className="micro-app-shell-placeholder">
              <p className="micro-app-shell-placeholder-title">
                {error.includes("bundle_not_found") || error.includes("404")
                  ? "还没有 UI Bundle"
                  : "加载失败"}
              </p>
              <p className="settings-empty" style={{ padding: 0 }}>
                {error.includes("bundle_not_found") || error.includes("404")
                  ? "可在对话里让 Bot 生成界面并自动上传；无需手传 zip。若已有本地包，也可手动上传作为备用。"
                  : error}
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                手动上传 zip（可选）
              </Button>
              <p className="settings-empty" style={{ paddingTop: 8 }}>
                zip 通常含 index.html / manifest.json。沙箱 iframe 无 allow-same-origin；能力经父页面 Host Bridge。
              </p>
            </div>
          ) : srcdoc ? (
            <iframe
              ref={iframeRef}
              title={app.title}
              className={cn(
                "micro-app-shell-frame",
                "micro-app-shell-frame--fit",
                frameSize && "micro-app-shell-frame--sized",
              )}
              sandbox="allow-scripts allow-forms"
              srcDoc={srcdoc}
              style={{
                width: "100%",
                height: frameSize?.height ?? MICRO_SHELL_DEFAULT_HEIGHT,
                minHeight: MICRO_SHELL_MIN_HEIGHT,
                minWidth: MICRO_SHELL_MIN_WIDTH,
              }}
            />
          ) : null}
        </div>
      </div>

      {sheetForm ? (
        <MicroAppMoreSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          title={app.title}
          canPin={canPin}
          canUpload={canUpload}
          hasBundle={hasBundle}
          canArchive={canArchive}
          onPin={onAskPin}
          onUpload={() => fileRef.current?.click()}
          onArchive={onArchive}
          shortcutActions={shortcutActions}
        />
      ) : null}

      <MicroAppGrantDialog
        open={Boolean(grantPrompt)}
        capability={grantPrompt?.capability || ""}
        suggested={grantPrompt?.suggested}
        highSensitivity={grantPrompt?.highSensitivity}
        command={grantPrompt?.command}
        suggestedPrefix={grantPrompt?.suggestedPrefix}
        overridingAlwaysAllow={grantPrompt?.overridingAlwaysAllow}
        reason={grantPrompt?.reason}
        onCancel={() => {
          grantPrompt?.resolve(null);
          setGrantPrompt(null);
        }}
        onDecide={(d) => {
          grantPrompt?.resolve(d);
          setGrantPrompt(null);
        }}
      />
    </div>
  );
}
