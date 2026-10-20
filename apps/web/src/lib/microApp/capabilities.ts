import { hasTauriLike, type ClientContext } from "../clientEnv";

export type CapabilityAvailability = {
  capability: string;
  available: boolean;
  reason?: string;
  /** Stable reject code for client gray/prompt (Phase 6). */
  code?:
    | "capability_not_declared"
    | "host_required"
    | "device_required"
    | "capability_unavailable";
  /** Needs desktop host (Tauri) or connected machine. */
  host_required: boolean;
  /** Needs Capacitor native plugins (camera / notify / share). */
  device_required?: boolean;
};

const HOST_CAPS = new Set([
  "host.screenshot",
  "host.clipboard.read",
  "host.clipboard.write",
  "host.app.find",
  "host.app.open",
  "host.shell.run",
]);

/** Bot workspace (/workspace) via sandbox APIs — all clients; path must stay under root. */
const WORKSPACE_CAPS = new Set(["host.fs.workspace"]);

/** File picker based — works on web without Tauri. */
const FILE_PICKER_CAPS = new Set(["host.fs.read", "host.fs.write"]);

const ALWAYS_OK = new Set([
  "ui.notify",
  "chat.attach",
  "cloud.http",
  "account.profile",
  "agent.invoke",
  "skill.toggle",
  "routine.manage",
]);

/** Android / iOS P1 device caps — wired when Capacitor plugin bridge exists. */
export const DEVICE_CAPS = new Set([
  "device.camera",
  "device.notify",
  "device.share",
  "device.mic",
  "device.geo",
]);

export function isHostEnvironment(client?: ClientContext | null): boolean {
  if (client?.capabilities?.host_tools) return true;
  return hasTauriLike();
}

export function isCapacitorNative(client?: ClientContext | null): boolean {
  if (client?.app === "capacitor") return true;
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Runtime probe: plugin registered on native bridge (no npm import required). */
export function devicePluginAvailable(capability: string): boolean {
  if (typeof window === "undefined") return false;
  const plugins = window.Capacitor?.Plugins as Record<string, Record<string, unknown>> | undefined;
  if (!plugins) return false;
  switch (capability) {
    case "device.camera":
      return typeof plugins.Camera?.getPhoto === "function" || typeof plugins.Camera?.takePicture === "function";
    case "device.notify":
      return (
        typeof plugins.LocalNotifications?.schedule === "function" ||
        typeof plugins.LocalNotifications?.requestPermissions === "function"
      );
    case "device.share":
      return typeof plugins.Share?.share === "function";
    case "device.mic":
      return (
        typeof plugins.Microphone?.requestPermissions === "function" ||
        typeof plugins.Microphone?.startRecording === "function" ||
        typeof plugins.VoiceRecorder?.startRecording === "function" ||
        typeof plugins.SpeechRecognition?.start === "function"
      );
    case "device.geo":
      return typeof plugins.Geolocation?.getCurrentPosition === "function";
    default:
      return false;
  }
}

export function capabilityAvailability(
  capability: string,
  opts: { client?: ClientContext | null; declared: string[] },
): CapabilityAvailability {
  const cap = capability.trim();
  if (!opts.declared.includes(cap)) {
    return {
      capability: cap,
      available: false,
      reason: "未在微应用中声明该能力",
      code: "capability_not_declared",
      host_required: HOST_CAPS.has(cap),
      device_required: DEVICE_CAPS.has(cap),
    };
  }
  if (ALWAYS_OK.has(cap) || FILE_PICKER_CAPS.has(cap) || WORKSPACE_CAPS.has(cap)) {
    return { capability: cap, available: true, host_required: false };
  }
  if (HOST_CAPS.has(cap)) {
    const host = isHostEnvironment(opts.client);
    if (!host) {
      return {
        capability: cap,
        available: false,
        reason: "需要已连接的电脑（桌面端）。手机登录不等于本机 host。",
        code: "host_required",
        host_required: true,
      };
    }
    return { capability: cap, available: true, host_required: true };
  }
  if (DEVICE_CAPS.has(cap)) {
    const native = isCapacitorNative(opts.client);
    if (!native) {
      return {
        capability: cap,
        available: false,
        reason: "仅 Android / iOS 原生壳可用（请在手机 App 中打开）",
        code: "device_required",
        host_required: false,
        device_required: true,
      };
    }
    if (!devicePluginAvailable(cap)) {
      return {
        capability: cap,
        available: false,
        reason: "原生插件未注册（需 Capacitor 壳 + cap sync）；若已接入则检查系统权限设置",
        code: "device_required",
        host_required: false,
        device_required: true,
      };
    }
    return { capability: cap, available: true, host_required: false, device_required: true };
  }
  if (cap.startsWith("device.")) {
    return {
      capability: cap,
      available: false,
      reason: "该设备能力尚未开放",
      code: "capability_unavailable",
      host_required: false,
      device_required: true,
    };
  }
  return { capability: cap, available: true, host_required: false };
}

export function summarizeUnavailable(
  capabilities: string[],
  client?: ClientContext | null,
): CapabilityAvailability[] {
  return capabilities
    .map((c) => capabilityAvailability(c, { client, declared: capabilities }))
    .filter((c) => !c.available);
}

/** Full matrix (available + unavailable) for UI. */
export function capabilityMatrix(
  capabilities: string[],
  client?: ClientContext | null,
): CapabilityAvailability[] {
  return (capabilities || []).map((c) => capabilityAvailability(c, { client, declared: capabilities }));
}

export const CAPABILITY_LABELS: Record<string, string> = {
  "host.screenshot": "截屏",
  "host.clipboard.read": "读取剪贴板",
  "host.clipboard.write": "写入剪贴板",
  "host.fs.read": "读取所选文件",
  "host.fs.write": "保存到所选位置",
  "host.fs.workspace": "读写 Bot 工作区",
  "host.app.find": "查找本机应用",
  "host.app.open": "打开本机应用",
  "host.shell.run": "本机命令",
  "cloud.http": "云端 HTTP",
  "ui.notify": "应用内通知",
  "chat.attach": "发到会话",
  "account.profile": "账号资料（只读）",
  "routine.manage": "管理例行任务",
  "agent.invoke": "唤起绑定 Bot 一轮对话",
  "skill.toggle": "开关技能",
  "device.camera": "相机",
  "device.notify": "系统通知",
  "device.share": "系统分享",
  "device.mic": "麦克风",
  "device.geo": "定位",
};
