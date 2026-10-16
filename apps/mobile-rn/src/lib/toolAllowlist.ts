/**
 * Optimistic client cache for Always-allow（审批三态）。
 *
 * 对齐 `apps/web/src/lib/toolAllowlist.ts`；RN 用 AsyncStorage（`readJson`/`writeJson`）
 * 替代 localStorage。服务端 list/revoke 就绪后以远程为准，本地作离线兜底。
 */

import { readJson, writeJson } from "@/lib/storage";

export type ApprovalDecision = "allow_once" | "always_allow" | "deny";

export type ToolFamilyId =
  | "shell"
  | "git"
  | "file_write"
  | "file_delete"
  | "file_move"
  | "ssh_exec"
  | "ssh_write"
  | "ssh_delete"
  | "email"
  | "computer_use"
  | "other";

export type ToolAllowEntry = {
  family: ToolFamilyId;
  /** Stable tool label shown on the card (e.g. host_shell). */
  tool: string;
  /** Chinese display name for 设置 · 审核. */
  label: string;
  /** ISO time when Always allow was granted. */
  granted_at: string;
};

const STORAGE_PREFIX = "openbot_tool_allowlist_v1_";

const FAMILY_LABEL: Record<ToolFamilyId, string> = {
  shell: "本机命令",
  git: "Git 操作",
  file_write: "写入文件",
  file_delete: "删除文件",
  file_move: "移动/重命名",
  ssh_exec: "远程命令",
  ssh_write: "远程写入",
  email: "邮件发送",
  ssh_delete: "远程删除",
  computer_use: "操作界面",
  other: "其他操作",
};

const GIT_WRITE_RE =
  /\bgit\s+(push|commit|reset|rebase|merge|cherry-pick|tag|branch\s+-[dD]|checkout\s+-B|clean)\b/i;
const GIT_CMD_RE = /(^|[;&|]\s*)git(\s|$)/i;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId || "anon"}`;
}

function readRaw(userId: string): ToolAllowEntry[] {
  const parsed = readJson<ToolAllowEntry[]>(storageKey(userId), []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e) => e && typeof e.family === "string" && typeof e.label === "string");
}

function writeRaw(userId: string, entries: ToolAllowEntry[]): void {
  writeJson(storageKey(userId), entries);
}

/** Map host_confirm op + path to a tool family (MVP: family-level). */
export function toolFamilyForHostOp(op: string, path = ""): ToolFamilyId {
  const o = (op || "").trim();
  const p = (path || "").trim();
  if (o === "shell" || o === "ssh_exec") {
    if (GIT_CMD_RE.test(p) || /\bgit\b/i.test(p)) return "git";
    return o === "ssh_exec" ? "ssh_exec" : "shell";
  }
  if (o === "write") return "file_write";
  if (o === "delete") return "file_delete";
  if (o === "move") return "file_move";
  if (o === "ssh_write") return "ssh_write";
  if (o === "ssh_delete") return "ssh_delete";
  if (o === "email_send") return "email";
  if (
    o === "click" ||
    o === "type" ||
    o === "key" ||
    o === "scroll" ||
    o === "mouse_move" ||
    o === "drag"
  ) {
    return "computer_use";
  }
  return "other";
}

/** Card / API tool label (host_shell style). */
export function toolLabelForHostOp(op: string, path = ""): string {
  const family = toolFamilyForHostOp(op, path);
  if (family === "git") return "host_shell";
  switch (op) {
    case "shell":
      return "host_shell";
    case "write":
      return "host_write";
    case "delete":
      return "host_delete";
    case "move":
      return "host_move";
    case "ssh_exec":
      return "host_ssh_exec";
    case "ssh_write":
      return "host_ssh_write";
    case "ssh_delete":
      return "host_ssh_delete";
    case "ls":
      return "host_ls";
    case "read":
      return "host_read";
    case "find_app":
      return "host_find_app";
    case "open":
      return "host_open";
    case "screenshot":
      return "host_screenshot";
    case "click":
      return "host_click";
    case "type":
      return "host_type";
    case "key":
      return "host_key";
    case "scroll":
      return "host_scroll";
    case "mouse_move":
      return "host_mouse_move";
    case "drag":
      return "host_drag";
    case "list_windows":
      return "host_list_windows";
    case "ax":
      return "host_ax";
    case "tcc_status":
      return "host_tcc_status";
    case "email_send":
      return "gmail_send";
    default:
      return op ? `host_${op}` : "host_tool";
  }
}

export function toolFamilyLabel(family: ToolFamilyId): string {
  return FAMILY_LABEL[family] || FAMILY_LABEL.other;
}

/** True when Always-allow on this family would cover git write ops. */
export function isGitWriteRisk(op: string, path = ""): boolean {
  if (toolFamilyForHostOp(op, path) !== "git") return false;
  return GIT_WRITE_RE.test(path) || /\bgit\s+push\b/i.test(path);
}

export function listToolAllowEntries(userId: string): ToolAllowEntry[] {
  return readRaw(userId)
    .slice()
    .sort((a, b) => (a.granted_at < b.granted_at ? 1 : -1));
}

export function isToolFamilyAlwaysAllowed(userId: string, family: ToolFamilyId): boolean {
  return readRaw(userId).some((e) => e.family === family);
}

export function grantToolFamilyAlwaysAllow(
  userId: string,
  family: ToolFamilyId,
  tool: string
): ToolAllowEntry[] {
  const prev = readRaw(userId).filter((e) => e.family !== family);
  const next: ToolAllowEntry[] = [
    {
      family,
      tool: tool || family,
      label: toolFamilyLabel(family),
      granted_at: new Date().toISOString(),
    },
    ...prev,
  ];
  writeRaw(userId, next);
  return next;
}

export function revokeToolFamilyAlwaysAllow(userId: string, family: ToolFamilyId): ToolAllowEntry[] {
  const next = readRaw(userId).filter((e) => e.family !== family);
  writeRaw(userId, next);
  return next;
}

export const ALWAYS_ALLOW_TOAST = "之后同类操作将不再询问，可在设置 · 审核里撤销";

export const REVIEW_EMPTY_COPY = "还没有始终允许的操作";
