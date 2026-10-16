/**
 * Optimistic client cache for Always-allow (审批三态).
 *
 * Source of truth is the server allowlist written by `decision: always_allow`
 * on POST .../approve (and host-confirms when backend supports it). This module
 * only caches grants so host_exec can skip the gate before the list API lands,
 * and so 设置 · 审核 stays usable offline. Prefer listToolAllowlist() /
 * revokeToolAllowlistEntry() from api.ts when the server responds.
 *
 * Hard deny (Auto-review) and machine exec_policy=ask still win — callers must
 * check those before skipping the gate.
 */

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

const GIT_WRITE_RE = /\bgit\s+(push|commit|reset|rebase|merge|cherry-pick|tag|branch\s+-[dD]|checkout\s+-B|clean)\b/i;
const GIT_CMD_RE = /(^|[;&|]\s*)git(\s|$)/i;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId || "anon"}`;
}

function readRaw(userId: string): ToolAllowEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ToolAllowEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.family === "string" && typeof e.label === "string");
  } catch {
    return [];
  }
}

function writeRaw(userId: string, entries: ToolAllowEntry[]) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(entries));
  } catch {
    /* quota / private mode — ignore */
  }
}

/** Map host_confirm op + path to a tool family (MVP: family-level, not param fingerprint). */
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

/** True when Always-allow on this family would cover git write ops (push/commit/…). */
export function isGitWriteRisk(op: string, path = ""): boolean {
  if (toolFamilyForHostOp(op, path) !== "git") return false;
  return GIT_WRITE_RE.test(path) || /\bgit\s+push\b/i.test(path);
}

export function listToolAllowEntries(userId: string): ToolAllowEntry[] {
  return readRaw(userId).slice().sort((a, b) => (a.granted_at < b.granted_at ? 1 : -1));
}

export function isToolFamilyAlwaysAllowed(userId: string, family: ToolFamilyId): boolean {
  return readRaw(userId).some((e) => e.family === family);
}

export function grantToolFamilyAlwaysAllow(
  userId: string,
  family: ToolFamilyId,
  tool: string,
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

/** Toast after 「始终允许」— UE lock, no shell/allowlist jargon. */
export const ALWAYS_ALLOW_TOAST = "之后同类操作将不再询问，可在设置 · 审核里撤销";

/** Empty state for 设置 · 审核. */
export const REVIEW_EMPTY_COPY = "还没有始终允许的操作";
