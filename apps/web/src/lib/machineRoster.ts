/**
 * Machine roster helpers (prefer-host filter, presence labels).
 * Separated from clientEnv so UI copy changes do not touch native detection.
 */

/** Machine row is phone / Capacitor → login-only, never prefer-host. */
export function isLoginOnlyMachine(m: {
  device_type?: string | null;
  platform?: string | null;
  app?: string | null;
}): boolean {
  const dt = (m.device_type || "").toLowerCase();
  if (dt === "mobile") return true;
  if (dt === "desktop" || dt === "browser") return false;
  const plat = (m.platform || "").toLowerCase();
  if (plat === "ios" || plat === "android") return true;
  if ((m.app || "").toLowerCase() === "capacitor") return true;
  return false;
}

/** Presence from register/heartbeat (API ApplyOnlineStatus, ~90s). Not host-exec socket. */
export function machineIsOnline(m: { status?: string | null }): boolean {
  return (m.status || "").toLowerCase() === "online";
}

/** Short presence label for selects / hints (all clients). */
export function machinePresenceLabel(m: {
  status?: string | null;
  connected?: boolean | null;
}): string {
  if (machineIsOnline(m)) {
    return m.connected === true ? "在线 · 可操作" : "在线";
  }
  return m.connected === true ? "可操作" : "离线";
}

/** Prefer-computer / 优先电脑 dropdown: desktop hosts only. */
export function preferHostMachines<T extends {
  device_type?: string | null;
  platform?: string | null;
  app?: string | null;
}>(machines: T[]): T[] {
  return machines.filter((m) => !isLoginOnlyMachine(m));
}

