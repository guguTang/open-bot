import type { ClientContext } from "./clientEnv";

/**
 * Install from the DMG, then grant TCC to that Open Bot.app.
 * The raw Contents/MacOS binary is linker-signed and will not hold the grant.
 */
export const DESKTOP_CAPTURE_PERMISSION_HINT =
  "请从 DMG 把 Open Bot 拖进「应用程序」后再打开。屏幕录制、辅助功能要授给这个已安装的 Open Bot；较新的 macOS 若还列出「输入监控」（Input Monitoring）或「事件发布」（Event Posting），同样允许 Open Bot。直接运行 .app 里 Contents/MacOS/open-bot-desktop 会先打开终端，系统设置也对不准这个应用。授权后回到对话再试。手机和浏览器不能截这台电脑的屏幕。";

/** macOS desktop is the only host that can capture the screen for the agent. */
export function shouldShowDesktopCapturePermissions(client: ClientContext): boolean {
  return client.app === "tauri" && client.platform === "macos";
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } })
    .__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

/** Open the macOS Privacy pane for Screen Recording or Accessibility. */
export async function openDesktopPrivacyPane(pane: "screen" | "accessibility"): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) {
    throw new Error("请在 macOS 桌面应用里打开系统设置");
  }
  const result = (await invoke("host_open_privacy", { pane })) as { ok?: boolean; error?: string };
  if (result && result.ok === false) {
    throw new Error(result.error || "无法打开系统设置");
  }
}
