/**
 * OpenUI 动作 → 宿主行为（web 与 mobile-rn 共用，两份文件必须逐字节一致）。
 *
 * 纯函数：只决定「发什么消息 / 打开什么链接」，真正发送由各端聊天层完成。
 */

import type { ActionEvent } from "@openuidev/react-lang";

export type OpenUiHostAction =
  | { kind: "send"; text: string }
  | { kind: "open_url"; url: string }
  | { kind: "ignore"; reason: string };

const MAX_MESSAGE_CHARS = 4000;

function scalar(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(scalar).filter((x): x is string => Boolean(x));
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    return scalar((v as Record<string, unknown>).value);
  }
  return null;
}

/**
 * 表单状态拍平成「字段: 值」行。OpenUI 的 formState 可能按表单名嵌套一层，
 * 字段值也可能包成 `{ value }`，这里都兼容。
 */
export function formStateLines(formState: unknown, formName?: string): string[] {
  if (!formState || typeof formState !== "object") return [];
  let src = formState as Record<string, unknown>;
  const nested = formName ? src[formName] : undefined;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    src = nested as Record<string, unknown>;
  }
  const lines: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    const s = scalar(v);
    if (s) lines.push(`${k}: ${s}`);
  }
  return lines;
}

function safeUrl(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 把 Renderer 的 onAction 事件翻译成宿主动作。 */
export function resolveOpenUiAction(event: ActionEvent): OpenUiHostAction {
  if (event.type === "open_url") {
    const url = safeUrl(event.params?.url);
    return url ? { kind: "open_url", url } : { kind: "ignore", reason: "unsafe-url" };
  }
  if (event.type === "continue_conversation") {
    const head = (event.humanFriendlyMessage || "").trim();
    const lines = formStateLines(event.formState, event.formName);
    const text = [head, ...lines].filter(Boolean).join("\n").slice(0, MAX_MESSAGE_CHARS);
    return text ? { kind: "send", text } : { kind: "ignore", reason: "empty" };
  }
  return { kind: "ignore", reason: `unsupported:${event.type}` };
}
