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
