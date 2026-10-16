import type { ClientContext } from "./clientEnv";

/**
 * Install from the DMG, then grant TCC to that Open Bot.app.
 * The raw Contents/MacOS binary is linker-signed and will not hold the grant.
 */
export const DESKTOP_CAPTURE_PERMISSION_HINT =
  "请从 DMG 把 Open Bot 拖进「应用程序」后再打开。屏幕录制、辅助功能要授给这个已安装的 Open Bot（标识 com.openbot.desktop）；较新的 macOS 若还列出「输入监控」（Input Monitoring）或「事件发布」（Event Posting），同样允许 Open Bot。直接运行 Contents/MacOS/open-bot-desktop、make dev-desktop 或 cargo run 会换成另一个代码签名（adhoc 的 CDHash 每次打包都变），系统设置里勾选了也不生效。授权后请完全退出并重开 Open Bot，再回到对话试。手机和浏览器不能截这台电脑的屏幕。";

const DESKTOP_PLATFORMS = new Set(["macos", "windows", "linux"]);

/** Desktop apps that can capture the screen and post input for the agent. */
export function shouldShowDesktopCapturePermissions(client: ClientContext): boolean {
  return client.app === "tauri" && DESKTOP_PLATFORMS.has(client.platform);
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } })
    .__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

/** Open the desktop privacy or input settings page for screen, accessibility, or event posting. */
export async function openDesktopPrivacyPane(
  pane: "screen" | "accessibility" | "event_posting",
): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) {
    throw new Error("请在桌面应用里打开系统设置");
  }
  const result = (await invoke("host_open_privacy", { pane })) as { ok?: boolean; error?: string };
  if (result && result.ok === false) {
    throw new Error(result.error || "无法打开系统设置");
  }
}
