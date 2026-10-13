/**
 * Host Approval — HITL 三态 + allowlist 合并。
 *
 * Card 与「设置 · 审核」共用：parse → family/tool → decide（含 always_allow 写本地）
 * → list/revoke（本地 + 远端合并）。ApprovalDecision 以 toolAllowlist 为准。
 */

import {
  decideHostConfirm,
  listToolAllowlist,
  revokeToolAllowlistEntry,
  type ToolAllowlistEntry,
} from "@/api";
import type { HostConfirmPayload, Message } from "@/api/types";
import {
  ALWAYS_ALLOW_TOAST,
  REVIEW_EMPTY_COPY,
  grantToolFamilyAlwaysAllow,
  isGitWriteRisk,
  listToolAllowEntries,
  revokeToolFamilyAlwaysAllow,
  toolFamilyForHostOp,
  toolFamilyLabel,
  toolLabelForHostOp,
  type ApprovalDecision,
  type ToolAllowEntry,
  type ToolFamilyId,
} from "@/lib/toolAllowlist";

export type { ApprovalDecision, ToolAllowEntry, ToolFamilyId };

export {
  ALWAYS_ALLOW_TOAST,
  REVIEW_EMPTY_COPY,
  isGitWriteRisk,
  listToolAllowEntries,
  toolFamilyForHostOp,
  toolFamilyLabel,
  toolLabelForHostOp,
};

/** 与 Web `parseHostConfirm` 同思路：优先结构化字段，否则试一次 JSON。 */
export function parseHostConfirm(message: Message): HostConfirmPayload | null {
  if (message.host_confirm?.op) return message.host_confirm;
  try {
    const data = JSON.parse(message.content) as HostConfirmPayload;
    if (data?.req_id && data.op) return data;
  } catch {
    /* 不是确认载荷 */
  }
  return null;
}

export type HostDecisionResult = {
  updated: Message | null;
  hint: string | null;
  error: string | null;
};

/**
 * 提交三态决策：always_allow 先乐观写本地，再打远端；失败由调用方回滚 UI。
 */
export async function submitHostDecision(opts: {
  conversationId: string;
  messageId: string;
  payload: HostConfirmPayload;
  decision: ApprovalDecision;
  userId: string;
}): Promise<HostDecisionResult> {
  const { conversationId, messageId, payload, decision, userId } = opts;
  const ok = decision !== "deny";
  const status = ok ? "allowed" : "denied";
  const family = toolFamilyForHostOp(payload.op, payload.path);
  const tool = toolLabelForHostOp(payload.op, payload.path);
  const scope = { tool, tool_group: family };

  let hint: string | null = null;
  if (decision === "always_allow") {
    grantToolFamilyAlwaysAllow(userId, family, tool);
    hint = ALWAYS_ALLOW_TOAST;
  }

  try {
    const updated = await decideHostConfirm(conversationId, messageId, status, {
      decision,
      scope,
      reason: payload.reason || "",
    });
    return { updated, hint, error: null };
  } catch (err) {
    return {
      updated: null,
      hint: null,
      error: err instanceof Error ? err.message : "提交失败，请重试",
    };
  }
}

/** 合并远端 allowlist 与本地乐观条目（远端优先）。 */
export function mergeAllowlistEntries(
  local: ToolAllowEntry[],
  remote: ToolAllowlistEntry[]
): ToolAllowEntry[] {
  if (remote.length === 0) return local;
  const mapped: ToolAllowEntry[] = remote.map((e) => ({
    family: (e.tool_group || "other") as ToolFamilyId,
    tool: e.tool || e.tool_group,
    label: e.label || toolFamilyLabel((e.tool_group || "other") as ToolFamilyId),
    granted_at: e.granted_at || new Date().toISOString(),
  }));
  const remoteFamilies = new Set(mapped.map((m) => m.family));
  return [...mapped, ...local.filter((l) => !remoteFamilies.has(l.family))];
}

export async function loadMergedAllowlist(userId: string): Promise<{
  entries: ToolAllowEntry[];
  serverOk: boolean;
}> {
  const local = listToolAllowEntries(userId);
  try {
    const remote = await listToolAllowlist();
    if (remote.length > 0) {
      return { entries: mergeAllowlistEntries(local, remote), serverOk: true };
    }
  } catch {
    /* fall through */
  }
  return { entries: local, serverOk: false };
}

export async function revokeAllowlistEntry(
  userId: string,
  entry: ToolAllowEntry
): Promise<{ entries: ToolAllowEntry[]; serverOk: boolean }> {
  const ok = await revokeToolAllowlistEntry({ tool_group: entry.family });
  const entries = revokeToolFamilyAlwaysAllow(userId, entry.family);
  return { entries, serverOk: ok };
}
