export type MicroAppGrantPromptPayload = {
  req_id: string;
  micro_app_id: string;
  capability: string;
  tool?: string;
  command?: string;
  machine_id?: string;
  reason?: string;
  suggested_decision?: string;
  high_sensitivity?: boolean;
  suggested_prefix?: string;
  /** Serialized original tool args for auto-retry after allow. */
  pending_args?: string;
  /** Durable run / turn request_id when the tool was blocked. */
  run_request_id?: string;
  /** @deprecated New-turn auto-retry removed; park resume is server-side. */
  auto_retry?: boolean;
  /** True when runtime unblocked the parked same tool call. */
  park_resolved?: boolean;
  status: "pending" | "allowed" | "denied" | string;
  decision?: string;
  allowlist_entry?: string;
};

export function parseMicroAppGrantPrompt(content: string): MicroAppGrantPromptPayload | null {
  try {
    const data = JSON.parse(content) as MicroAppGrantPromptPayload;
    if (!data?.req_id || !data.micro_app_id || !data.capability) return null;
    return data;
  } catch {
    return null;
  }
}

/** Fallback continue text when park was not resolved (process restart / no waiter). */
export function microAppGrantRetryUserText(item: MicroAppGrantPromptPayload): string {
  const tool = (item.tool || "").trim();
  const command = (item.command || "").trim();
  let text = tool
    ? `继续（微应用已授权，请立即重试 ${tool}）`
    : "继续（微应用已授权，请立即重试刚才被拦截的工具）";
  if (command) {
    text += `\n原命令：${command}`;
  } else if (item.pending_args?.trim()) {
    const args = item.pending_args.trim();
    text += `\n原参数：${args.length > 280 ? `${args.slice(0, 280)}…` : args}`;
  }
  return text;
}
