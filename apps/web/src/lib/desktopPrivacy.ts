import type { ClientContext } from "./clientEnv";

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
