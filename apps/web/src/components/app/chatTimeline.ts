import type { Agent, Channel } from "../../api";
import type { UiMessage } from "../../types/app-ui";

export function indexMessages(messages: UiMessage[]) {
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
): string | undefined {
  if (!channelId) return undefined;
  if (message.role !== "assistant") return undefined;
  const name = (message.agent_name || agentNameById.get(message.agent_id || "") || "").trim();
  return name || undefined;
}

export function memberAgents(activeChannel: Channel | null | undefined, agents: Agent[]): Agent[] | undefined {
  if (!activeChannel?.members?.length) return undefined;
  return activeChannel.members
    .map((id): Agent | undefined => {
      const a = agents.find((x) => x.id === id);
      if (!a) return undefined;
      const p = activeChannel.member_profiles?.find((x) => x.agent_id === id);
      return {
        ...a,
        avatar_shape: a.avatar_shape || p?.avatar_shape,
        avatar_color: a.avatar_color || p?.avatar_color,
      };
    })
    .filter((a): a is Agent => Boolean(a));
}

export function resolveRunFaceAgent(
  runFaceAgentId: string,
  activeAgent: Agent | null | undefined,
  agents: Agent[],
  activeChannel: Channel | null | undefined,
  agentNameById: Map<string, string>,
): Agent | null | undefined {
  const id = runFaceAgentId.trim();
  if (!id) return activeAgent;
  const fromGroup = (memberAgents(activeChannel, agents) || []).find((a) => a.id === id);
  if (fromGroup) return fromGroup;
  const a = agents.find((x) => x.id === id);
  if (a) return a;
  const p = activeChannel?.member_profiles?.find((x) => x.agent_id === id);
  if (p) {
    return {
      id,
      name: p.name || agentNameById.get(id) || id,
      avatar_shape: p.avatar_shape,
      avatar_color: p.avatar_color,
    } as Agent;
  }
  return { id, name: agentNameById.get(id) || id } as Agent;
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

export function jumpToMessage(id: string) {
  const el = document.querySelector(`[data-msg-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-highlight");
  window.setTimeout(() => el.classList.remove("msg-highlight"), 1200);
}
