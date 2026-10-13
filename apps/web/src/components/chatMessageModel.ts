import type { AttachmentMeta, HandoffPayload, MessageSource, ReactionSummary } from "../api";

export type ChatMessageData = {
  id: string;
  role: string;
  content: string;
  streaming?: boolean;
  attachments?: AttachmentMeta[];
  agent_id?: string;
  agent_name?: string;
  created_at?: string;
  reply_to_id?: string;
  thread_root_id?: string;
  agent_message_id?: string;
  /** Runtime run id on Bot replies (More → 复制请求 ID); absent on historical messages. */
  request_id?: string;
  /** Citation links when retrieval was used; omitted otherwise. */
  sources?: MessageSource[];
  reactions?: ReactionSummary[];
  handoff?: HandoffPayload;
};

export function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
