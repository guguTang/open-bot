import { fetch as expoFetch } from "expo/fetch";

import { API_BASE } from "./config";
import { getToken } from "./session";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: string; message?: string };
    return j.error || j.message || text || `HTTP ${res.status}`;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** 非流式请求。统一走 `expo/fetch`，与 SSE 用同一个网络栈。 */
export async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const merged = auth ? await authHeaders(headers as Record<string, string>) : headers;

  const res = await expoFetch(`${API_BASE}${path}`, { ...rest, headers: merged });
  if (!res.ok) throw new ApiError(res.status, await readError(res));

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * multipart 上传。
 *
 * **不要手动设 `Content-Type`**：boundary 由网络层自己生成，手动设会让后端
 * 收到一个没有 boundary 的 multipart body，解析必然失败。
 */
export async function upload<T>(
  path: string,
  form: FormData,
  init: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const merged = auth ? await authHeaders(headers as Record<string, string>) : headers;

  const res = await expoFetch(`${API_BASE}${path}`, {
    ...rest,
    method: "POST",
    headers: merged,
    body: form,
  });
  if (!res.ok) throw new ApiError(res.status, await readError(res));
  return (await res.json()) as T;
}

/** 本地文件 → FormData 里的 `{ uri, name, type }` 三元组（RN 的 FormData 不吃 Blob）。 */
export function filePart(
  uri: string,
  name: string,
  mime: string
): { uri: string; name: string; type: string } {
  return { uri, name, type: mime };
}

/** 把 http(s) 基址换成 ws(s)，用于 `/v1/agent-bus/ws`。 */
export function toWebSocketBase(httpBase: string): string {
  return httpBase.replace(/^http/i, (scheme) => (scheme.toLowerCase() === "https" ? "wss" : "ws"));
}

export { expoFetch };
