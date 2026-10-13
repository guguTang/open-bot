/** Build-time default (Vite). Runtime override lives in localStorage — see getApiBase / setApiBase. */
export const DEFAULT_API_BASE = (import.meta.env.VITE_API_BASE || "http://127.0.0.1:18080").replace(
  /\/$/,
  "",
);

export const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL || "http://127.0.0.1:5174").replace(
  /\/$/,
  "",
);

const API_BASE_KEY = "openbot_api_base";
const TOKEN_KEY = "openbot_token";
const USER_KEY = "openbot_user";

export function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function readStoredApiBase(): string | null {
  try {
    const v = localStorage.getItem(API_BASE_KEY);
    if (!v) return null;
    const n = normalizeApiBase(v);
    return n || null;
  } catch {
    return null;
  }
}

/**
 * Active API origin. Live-binding: setApiBase() updates this and all importers see it.
 * Prefer getApiBase() in new code; keep exporting API_BASE for existing call sites.
 */
export let API_BASE = readStoredApiBase() || DEFAULT_API_BASE;

export function getApiBase(): string {
  return API_BASE;
}

export function getDefaultApiBase(): string {
  return DEFAULT_API_BASE;
}

/** Persist override (empty / same as default → clear override). Does not clear auth. */
export function setApiBase(url: string): string {
  const cleaned = normalizeApiBase(url);
  const next = cleaned || DEFAULT_API_BASE;
  API_BASE = next;
  try {
    if (cleaned && cleaned !== DEFAULT_API_BASE) {
      localStorage.setItem(API_BASE_KEY, cleaned);
    } else {
      localStorage.removeItem(API_BASE_KEY);
    }
  } catch {
    /* private mode */
  }
  return API_BASE;
}

export function clearApiBaseOverride(): string {
  try {
    localStorage.removeItem(API_BASE_KEY);
  } catch {
    /* ignore */
  }
  API_BASE = DEFAULT_API_BASE;
  return API_BASE;
}

export type ApiHealthProbeResult = {
  ok: boolean;
  detail: string;
  service?: string;
  latency_ms?: number;
  error?: string;
  http_status?: number;
};

/** Probe GET {base}/healthz — same UX shape as list-models / probe-tools. */
export async function probeApiHealth(baseUrl?: string): Promise<ApiHealthProbeResult> {
  const base = normalizeApiBase(baseUrl ?? API_BASE) || DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(base)) {
    return {
      ok: false,
      detail: "地址需以 http:// 或 https:// 开头",
      error: "invalid_url",
    };
  }
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const headers: HeadersInit = {};
    if (/ngrok/i.test(base)) {
      headers["ngrok-skip-browser-warning"] = "1";
    }
    const res = await fetch(`${base}/healthz`, { method: "GET", headers, signal: ctrl.signal });
    const latency = Math.round(performance.now() - started);
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
        detail: `健康检查未通过${service ? `（${service}）` : ""}`,
        service,
        latency_ms: latency,
        http_status: res.status,
        error: "not_ok",
      };
    }
    return {
      ok: true,
      detail: service ? `连接正常（${service} · ${latency}ms）` : `连接正常（${latency}ms）`,
      service,
      latency_ms: latency,
      http_status: res.status,
    };
  } catch (err) {
    const latency = Math.round(performance.now() - started);
    const aborted = err instanceof DOMException && err.name === "AbortError";
    const msg = aborted
      ? "超时（8s）——检查地址、局域网或 ngrok 是否可达"
      : err instanceof Error
        ? err.message
        : String(err);
    return {
      ok: false,
      detail: `连不上：${msg}`,
      latency_ms: latency,
      error: aborted ? "timeout" : "network",
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export function formatApiHealthProbe(result: ApiHealthProbeResult): string {
  return result.detail;
}

export type User = {
  id: string;
  username: string;
  email?: string;
  org_id?: string;
  role?: "platform_admin" | "org_admin" | "member" | string;
  created_at?: string;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/** Bearer token in localStorage: required for Capacitor/WebView and LAN API pairing (no httpOnly cookie on static SPA). XSS risk accepted for this client. */
export function setSession(token: string, user: User) {
  // react-doctor-disable-next-line react-doctor/auth-token-in-web-storage -- SPA/Capacitor client; httpOnly cookies unavailable on static web host
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function apiExtraHeaders(): HeadersInit {
  // ngrok free interstitial breaks Capacitor/WebView JSON unless skipped.
  if (/ngrok/i.test(API_BASE)) {
    return { "ngrok-skip-browser-warning": "1" };
  }
  return {};
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...apiExtraHeaders(),
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: string; message?: string };
    return j.error || j.message || text || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export function isImageAttachmentMime(mime?: string | null): boolean {
  return Boolean(mime && /^image\//i.test(mime.trim()));
}

/** Absolute API URL (no token). Relative paths are joined to API_BASE. */
export function absolutizeApiUrl(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (/^(https?:|blob:|data:)/i.test(u)) return u;
  if (u.startsWith("//")) return `${typeof location !== "undefined" ? location.protocol : "https:"}${u}`;
  if (u.startsWith("/")) return `${API_BASE}${u}`;
  return `${API_BASE}/${u}`;
}

/**
 * Build an <img>-safe URL for an attachment (or markdown auth path).
 * - blob:/data: returned as-is (optimistic local preview)
 * - relative/absolute attachment GET gets ?access_token= from getToken()
 * Does not log the token.
 */
export function attachmentDisplayUrl(attOrUrl: { url?: string } | string | null | undefined): string | null {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl?.url;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
  const abs = absolutizeApiUrl(trimmed);
  if (!abs) return null;
  if (/[?&]access_token=/.test(abs) || /[?&]token=/.test(abs)) return abs;
  const token = getToken();
  if (!token) return abs;
  const sep = abs.includes("?") ? "&" : "?";
  return `${abs}${sep}access_token=${encodeURIComponent(token)}`;
}

/** Path without secrets — safe to copy / show in UI. */
export function attachmentCopyUrl(attOrUrl: { url?: string } | string | null | undefined): string | null {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl?.url;
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^(blob:|data:)/i.test(trimmed)) return trimmed;
  return absolutizeApiUrl(trimmed.split(/[?#]/)[0] || trimmed);
}

/** Relative path looks like authenticated attachment GET. */
export function isAttachmentAuthUrl(url: string): boolean {
  return /\/v1\/conversations\/[^/]+\/attachments\/[^/?#]+/i.test(url || "");
}

function extFromNameOrMime(name?: string, mime?: string): string {
  const fromName = (name || "").match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
  };
  return map[(mime || "").toLowerCase()] || "png";
}

/** `image-YYYYMMDD-HHmmss` + original extension (design v2 §2.2). */
export function imageDownloadFilename(name?: string, mime?: string, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `image-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${stamp}.${extFromNameOrMime(name, mime)}`;
}

/** Fetch attachment bytes with Bearer (preferred for download) or fall back to display URL. */
export async function fetchAttachmentBlob(attOrUrl: { url?: string } | string): Promise<Blob> {
  const raw = typeof attOrUrl === "string" ? attOrUrl : attOrUrl.url;
  if (!raw) throw new Error("no attachment url");
  if (/^(blob:|data:)/i.test(raw)) {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`blob fetch ${res.status}`);
    return res.blob();
  }
  const abs = absolutizeApiUrl(raw.split(/[?#]/)[0] || raw);
  const token = getToken();
  const res = await fetch(abs, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}

export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  triggerBrowserDownload(new Blob([text], { type: mime }), filename || "download");
}
