import Constants from "expo-constants";
import { Platform } from "react-native";

import { readJson, removeKey, writeJson } from "@/lib/storage";

/**
 * 后端地址。优先级：AsyncStorage 运行时覆盖 > EXPO_PUBLIC_OPENBOT_API_BASE > Expo Metro host > 平台默认。
 *
 * 开发启动（`pnpm start` / `make dev-mobile-rn`）经 `scripts/with-lan-api.mjs`
 * 自动探测电脑局域网 IP 并注入 `EXPO_PUBLIC_OPENBOT_API_BASE`，真机可直接连。
 * 若仍是环回地址（旧 .env / 未走包装脚本），真机会改用 Expo 已连通的 Metro host。
 * 未走该脚本时的平台回退：
 * - iOS 模拟器 / web：`127.0.0.1`
 * - Android 模拟器：`10.0.2.2`
 *
 * 对齐 Web `apps/web/src/api/client.ts` 的 getApiBase / setApiBase。
 * 模块加载时内存镜像可能尚未 hydrate；根布局会在 `hydratePrefs()` 后
 * 调用 `reloadApiBaseFromStorage()`。
 */
const API_PORT = "18080";

const PLATFORM_DEFAULT =
  Platform.OS === "android" ? `http://10.0.2.2:${API_PORT}` : `http://127.0.0.1:${API_PORT}`;

/** 真机访问不到的宿主机别名（环回 / Android 模拟器网关）。 */
function isDeviceUnreachableHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "10.0.2.2"
  );
}

function isDeviceUnreachableBase(url: string): boolean {
  try {
    return isDeviceUnreachableHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Expo 开发时手机已经能打到的电脑地址（Metro / Expo Go debugger host）。
 * 比 `os.networkInterfaces()` 更可靠：选错网卡时 Metro 仍通、API 却不通。
 */
function getExpoPackagerHostname(): string | null {
  const go = Constants.expoGoConfig as { debuggerHost?: string } | null;
  const legacy = Constants.manifest as { debuggerHost?: string } | null;
  const candidates: Array<string | null | undefined> = [
    Constants.expoConfig?.hostUri,
    go?.debuggerHost,
    legacy?.debuggerHost,
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const host = raw.split(":")[0]?.trim();
    if (host && !isDeviceUnreachableHost(host)) return host;
  }
  return null;
}

function resolveDefaultApiBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_OPENBOT_API_BASE?.trim();
  if (fromEnv && !isDeviceUnreachableBase(fromEnv)) {
    return normalizeApiBase(fromEnv);
  }

  // 原生端：环回 / 缺失时优先用 Metro host（证明手机可达）
  if (Platform.OS !== "web") {
    const host = getExpoPackagerHostname();
    if (host) return `http://${host}:${API_PORT}`;
  }

  if (fromEnv) return normalizeApiBase(fromEnv);
  return PLATFORM_DEFAULT;
}

export const DEFAULT_API_BASE = resolveDefaultApiBase();

const API_BASE_KEY = "openbot_api_base";

export function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function readStoredApiBase(): string | null {
  const v = readJson<string | null>(API_BASE_KEY, null);
  if (typeof v !== "string" || !v.trim()) return null;
  const n = normalizeApiBase(v);
  if (!n) return null;
  // 旧会话可能把 127.0.0.1 写进本地偏好；真机上会一直连不上，有 Metro host 时丢掉。
  if (isDeviceUnreachableBase(n) && getExpoPackagerHostname()) {
    removeKey(API_BASE_KEY);
    return null;
  }
  return n;
}

/**
 * Active API origin — private. Callers must use getApiBase() so hydrate / setApiBase
 * never leave a stale live-binding import behind.
 */
let currentApiBase = readStoredApiBase() || DEFAULT_API_BASE;

/** `hydratePrefs()` 之后调用，用落盘覆盖刷新 origin。 */
export function reloadApiBaseFromStorage(): string {
  currentApiBase = readStoredApiBase() || DEFAULT_API_BASE;
  return currentApiBase;
}

export function getApiBase(): string {
  return currentApiBase;
}

export function getDefaultApiBase(): string {
  return DEFAULT_API_BASE;
}

/** Persist override (empty / same as default → clear override). Does not clear auth. */
export function setApiBase(url: string): string {
  const cleaned = normalizeApiBase(url);
  const next = cleaned || DEFAULT_API_BASE;
  currentApiBase = next;
  if (cleaned && cleaned !== DEFAULT_API_BASE) {
    writeJson(API_BASE_KEY, cleaned);
  } else {
    removeKey(API_BASE_KEY);
  }
  return currentApiBase;
}

export function clearApiBaseOverride(): string {
  removeKey(API_BASE_KEY);
  currentApiBase = DEFAULT_API_BASE;
  return currentApiBase;
}

export type ApiHealthProbeResult = {
  ok: boolean;
  detail: string;
  service?: string;
  latency_ms?: number;
  error?: string;
  http_status?: number;
};

/** Probe GET {base}/healthz — 对齐 Web probeApiHealth. */
export async function probeApiHealth(baseUrl?: string): Promise<ApiHealthProbeResult> {
  const { expoFetch, isAbortError } = await import("./http");
  const base = normalizeApiBase(baseUrl ?? currentApiBase) || DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(base)) {
    return {
      ok: false,
      detail: "地址需以 http:// 或 https:// 开头",
      error: "invalid_url",
    };
  }
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const headers: Record<string, string> = {};
    if (/ngrok/i.test(base)) {
      headers["ngrok-skip-browser-warning"] = "1";
    }
    const res = await expoFetch(`${base}/healthz`, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    const latency = Date.now() - started;
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        detail: `HTTP ${res.status}`,
        http_status: res.status,
        latency_ms: latency,
        error: "http_error",
      };
    }
    const service = typeof body?.service === "string" ? body.service : undefined;
    const markedOk = body?.ok === true || body?.ok === "true" || body == null;
    if (!markedOk && body) {
      return {
        ok: false,
        detail: "健康检查未通过",
        service,
        latency_ms: latency,
        error: "unhealthy",
      };
    }
    return {
      ok: true,
      detail: service ? `OK · ${service}` : "OK",
      service,
      latency_ms: latency,
    };
  } catch (err) {
    const aborted = isAbortError(err);
    return {
      ok: false,
      detail: aborted ? "连接超时（8s）" : err instanceof Error ? err.message : "连接失败",
      error: aborted ? "timeout" : "network",
      latency_ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function formatApiHealthProbe(probe: ApiHealthProbeResult): string {
  if (probe.ok) {
    const ms = probe.latency_ms != null ? ` · ${probe.latency_ms}ms` : "";
    return `${probe.detail}${ms}`;
  }
  return probe.detail || "连接失败";
}

/** 登录等网络错误时附上当前 API 地址，方便对照设置页。 */
export function formatApiNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "请求失败，请检查网络后重试";
  const base = getApiBase();
  const looksNetwork =
    /fetch failed|network|connect|ECONNREFUSED|timed out|超时|Could not connect/i.test(msg);
  if (!looksNetwork) return msg;
  return `${msg}\n当前服务器：${base}`;
}
