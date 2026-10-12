import type { UiMessage } from "../../types/app-ui";

const HANDOFF_CONTEXT_MAX_MSGS = 12;
const HANDOFF_CONTEXT_MAX_CHARS = 1200;

export function buildHandoffContext(
  msgs: UiMessage[],
  fromBotName: string,
): { role: string; content: string }[] {
  const usable = msgs
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim() && !m.streaming)
    .slice(-HANDOFF_CONTEXT_MAX_MSGS);
  if (usable.length === 0) {
    return [
      {
        role: "system",
        content: `用户从与「${fromBotName}」的对话转交给你；此前暂无更多上下文。`,
      },
    ];
  }
  const out: { role: string; content: string }[] = [
    {
      role: "system",
      content: `用户从与「${fromBotName}」的对话转交给你。以下是那边近期对话（供参考，不要复述这段说明）：`,
    },
  ];
  for (const m of usable) {
    let text = m.content.trim();
    if (text.length > HANDOFF_CONTEXT_MAX_CHARS) {
      text = `${text.slice(0, HANDOFF_CONTEXT_MAX_CHARS)}…`;
    }
    out.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  }
  return out;
}
