import type { Agent } from "../../api";
import type { UiMessage } from "../../types/app-ui";

export type IndexedMessages = {
  messageById: Map<string, UiMessage>;
  replyCountByRoot: Map<string, number>;
  mainTimeline: UiMessage[];
};

export function indexMessages(messages: UiMessage[]): IndexedMessages {
  const messageById = new Map<string, UiMessage>();
  const replyCountByRoot = new Map<string, number>();
  const mainTimeline: UiMessage[] = [];
  for (const m of messages) {
    messageById.set(m.id, m);
    const root = (m.thread_root_id || "").trim();
    if (!root) {
      mainTimeline.push(m);
      continue;
    }
    if (m.role === "summary") continue;
    replyCountByRoot.set(root, (replyCountByRoot.get(root) || 0) + 1);
  }
  return { messageById, replyCountByRoot, mainTimeline };
}

export function threadMessages(messages: UiMessage[], rootId: string | null) {
  const root = (rootId || "").trim();
  if (!root) return [];
  return messages.filter((m) => m.id === root || (m.thread_root_id || "") === root);
}

export function quoteForMessage(
  message: UiMessage,
  messageById: Map<string, UiMessage>,
  agentNameById: Map<string, string>,
): { who: string; text: string } | null {
  const pid = (message.reply_to_id || "").trim();
  if (!pid) return null;
  const parent = messageById.get(pid);
  if (!parent) return null;
  const who =
    parent.role === "assistant"
      ? parent.agent_name || agentNameById.get(parent.agent_id || "") || parent.agent_id || "助手"
      : "你";
  return { who, text: parent.content || "" };
}

export function speakerNameForMessage(
  message: UiMessage,
  channelId: string | undefined,
  agentNameById: Map<string, string>,
  conversationAgentId?: string,
): string | undefined {
  if (message.role !== "assistant") return undefined;
  const name = (message.agent_name || agentNameById.get(message.agent_id || "") || "").trim();
  if (!name) return undefined;
  if (channelId) return name;
  const speakerId = (message.agent_id || "").trim();
  const ownerId = (conversationAgentId || "").trim();
  if (speakerId && ownerId && speakerId !== ownerId) return `来自 ${name}`;
  return undefined;
}

export function speakerFaceForMessage(
  message: UiMessage,
  conversation: { channel_id?: string; agent_id?: string } | null | undefined,
  agents: Agent[],
): { id: string; name: string; shape?: string | null; color?: string | null } | undefined {
  if (message.role !== "assistant") return undefined;
  if (conversation?.channel_id) return undefined;
  const speakerId = (message.agent_id || "").trim();
  const ownerId = (conversation?.agent_id || "").trim();
  if (!speakerId || !ownerId || speakerId === ownerId) return undefined;
  const agent = agents.find((a) => a.id === speakerId);
  const name = (agent?.name || message.agent_name || speakerId).trim();
  return {
    id: speakerId,
    name,
    shape: agent?.avatar_shape,
    color: agent?.avatar_color,
  };
}

export function replyTargetFromMessage(message: UiMessage, agentNameById: Map<string, string>) {
  const who =
    message.role === "assistant"
      ? message.agent_name || agentNameById.get(message.agent_id || "") || message.agent_id || "助手"
      : "你";
  const text = (message.content || "")
    .replace(/```\w*/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return { id: message.id, who, text: text || "（无正文）" };
}
