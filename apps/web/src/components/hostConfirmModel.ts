export type HostConfirmPayload = {
  req_id: string;
  op: string;
  path: string;
  dest?: string;
  preview?: string;
  status: "pending" | "allowed" | "denied" | string;
  /** Auto-review structured reason (why confirm). */
  reason?: string;
  review_tier?: string;
};

export function parseHostConfirm(content: string): HostConfirmPayload | null {
  try {
    const data = JSON.parse(content) as HostConfirmPayload;
    if (!data?.req_id || !data.op) return null;
    return data;
  } catch {
    return null;
  }
}

export function hostConfirmReqId(content: string): string {
  return parseHostConfirm(content)?.req_id || "";
}
