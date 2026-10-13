import type { FeedbackPolarity, FeedbackSource } from "../api";

export const NEGATIVE_REASONS = [
  { id: "wrong", label: "答错了 / 事实不准" },
  { id: "verbose", label: "太啰嗦" },
  { id: "not_followed", label: "没按要求做" },
  { id: "missed_steps", label: "漏了关键步骤" },
  { id: "tone", label: "语气/格式不对" },
  { id: "other", label: "其它" },
] as const;

export const POSITIVE_REASONS = [
  { id: "good", label: "答得好" },
  { id: "concise", label: "简洁有用" },
  { id: "format_ok", label: "格式对" },
] as const;

export type FeedbackTarget = {
  messageId: string;
  agentId: string;
  agentName: string;
  conversationId: string;
  polarity: FeedbackPolarity;
  source: FeedbackSource;
};
