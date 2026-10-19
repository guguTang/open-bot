import { hasTauriLike, type ClientContext } from "../clientEnv";

export type CapabilityAvailability = {
  capability: string;
  available: boolean;
  reason?: string;
  /** Needs desktop host (Tauri) or connected machine. */
  host_required: boolean;
};

const HOST_CAPS = new Set([
  "host.screenshot",
  "host.clipboard.read",
  "host.clipboard.write",
  "host.fs.workspace",
  "host.app.find",
  "host.app.open",
  "host.shell.run",
]);

/** File picker based — works on web without Tauri. */
const FILE_PICKER_CAPS = new Set(["host.fs.read", "host.fs.write"]);

const ALWAYS_OK = new Set(["ui.notify", "chat.attach", "cloud.http", "account.profile"]);

export function isHostEnvironment(client?: ClientContext | null): boolean {
  if (client?.capabilities?.host_tools) return true;
  return hasTauriLike();
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
      host_required: HOST_CAPS.has(cap),
    };
  }
  if (ALWAYS_OK.has(cap) || FILE_PICKER_CAPS.has(cap)) {
    return { capability: cap, available: true, host_required: false };
  }
  if (HOST_CAPS.has(cap)) {
    const host = isHostEnvironment(opts.client);
    if (!host) {
      return {
        capability: cap,
        available: false,
        reason: "需要已连接的电脑（桌面端）。手机登录不等于本机 host。",
        host_required: true,
      };
    }
    return { capability: cap, available: true, host_required: true };
  }
  // device.* etc.
  if (cap.startsWith("device.")) {
    return {
      capability: cap,
      available: false,
      reason: "移动端能力将在后续版本提供",
      host_required: false,
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
