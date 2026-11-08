import { API_BASE, authHeaders, readError } from "./client";

export type LLMConnection = {
  id: string;
  user_id: string;
  name: string;
  base_url: string;
  model: string;
  enable_tools: boolean;
  /** Probe result stored on the connection. Absent on older responses means unknown. */
  supports_vision?: boolean;
  is_default: boolean;
  context_window?: number | null;
  api_key_set: boolean;
  api_key_hint?: string;
  created_at: string;
  updated_at: string;
};

export async function listLLMConnections(): Promise<LLMConnection[]> {
  const res = await fetch(`${API_BASE}/v1/llm-connections`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.connections ?? [];
}

/** Personal default, or org default when the user has no connection — same as chat runs. */
export async function fetchEffectiveLLMConnection(): Promise<LLMConnection | null> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/effective`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return (data.connection as LLMConnection | null | undefined) ?? null;
}

export type LLMInput = {
  name: string;
  base_url: string;
  api_key?: string;
  model: string;
  enable_tools?: boolean;
  is_default?: boolean;
  /** tokens; omit/null/empty = auto (model heuristic) */
  context_window?: number | null;
};

export type LLMSavedConnection = LLMConnection & {
  vision_probe?: LLMVisionProbeResult;
};

export async function createLLMConnection(body: LLMInput): Promise<LLMSavedConnection> {
  const res = await fetch(`${API_BASE}/v1/llm-connections`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateLLMConnection(id: string, body: Partial<LLMInput>): Promise<LLMSavedConnection> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteLLMConnection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function setDefaultLLMConnection(id: string): Promise<LLMConnection> {
  const res = await fetch(`${API_BASE}/v1/llm-connections/${id}/default`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type LLMToolsProbeResult = {
  ok: boolean;
  can_enable_tools: boolean;
  supports_tools: boolean;
  mode: "native" | "markup" | "forced_only" | "none" | "error" | string;
  detail: string;
  hint?: string;
  error?: string;
  http_status?: number;
};

export async function probeLLMTools(body: {
  base_url?: string;
  api_key?: string;
  model?: string;
  connection_id?: string;
}): Promise<LLMToolsProbeResult> {
  const res = await fetch(`${API_BASE}/v1/llm/probe-tools`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type LLMListModelsResult = {
  ok: boolean;
  models: string[];
  detail?: string;
  error?: string;
  http_status?: number;
};

export async function listLLMModels(body: {
  base_url?: string;
  api_key?: string;
  connection_id?: string;
}): Promise<LLMListModelsResult> {
  const res = await fetch(`${API_BASE}/v1/llm/list-models`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type LLMVisionProbeResult = {
  ok: boolean;
  supports_vision: boolean;
  detail: string;
  hint?: string;
  error?: string;
  http_status?: number;
};

export async function probeLLMVision(body: {
  base_url?: string;
  api_key?: string;
  model?: string;
  connection_id?: string;
}): Promise<LLMVisionProbeResult> {
  const res = await fetch(`${API_BASE}/v1/llm/probe-vision`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function formatLLMVisionProbe(result: LLMVisionProbeResult | null | undefined): string {
  if (!result) return "";
  if (!result.ok) {
    return result.hint || "未能确认视觉能力，附图将仅文本提及";
  }
  const head = result.supports_vision ? "支持看图" : "不支持看图";
  return [head, result.detail, result.hint].filter(Boolean).join(" ");
}

export function formatLLMToolsProbe(result: LLMToolsProbeResult): string {
  const modeLabel: Record<string, string> = {
    native: "原生 function calling",
    markup: "文本工具协议",
    forced_only: "仅强制 tool_choice",
    none: "不支持 tools",
    error: "检测失败",
  };
  const label = modeLabel[result.mode] || result.mode;
  const head = result.can_enable_tools ? `可用（${label}）` : `不可用（${label}）`;
  const bits = [head, result.detail];
  if (result.hint) bits.push(result.hint);
  return bits.filter(Boolean).join(" ");
}

export type LLMPromptCacheProbeResult = {
  ok: boolean;
  supports_prompt_cache: boolean;
  mode: "blocks" | "key" | "none" | "error" | string;
  detail: string;
  hint?: string;
  error?: string;
  http_status?: number;
  heuristic_mode?: string;
};

export async function probeLLMPromptCache(body: {
  base_url?: string;
  api_key?: string;
  model?: string;
  connection_id?: string;
}): Promise<LLMPromptCacheProbeResult> {
  const res = await fetch(`${API_BASE}/v1/llm/probe-cache`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export function formatLLMPromptCacheProbe(result: LLMPromptCacheProbeResult): string {
  const modeLabel: Record<string, string> = {
    blocks: "cache_control 内容块",
    key: "prompt_cache_key",
    none: "不支持",
    error: "检测失败",
  };
  const label = modeLabel[result.mode] || result.mode;
  const head = result.supports_prompt_cache
    ? `Prompt cache：支持（${label}）`
    : `Prompt cache：不支持（${label}）`;
  const bits = [head, result.detail];
  if (result.hint) bits.push(result.hint);
  return bits.filter(Boolean).join(" ");
}
