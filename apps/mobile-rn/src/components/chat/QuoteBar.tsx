import { CloseButton, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { Icon } from "@/components/Icon";

/** 引用条上正文摘要的截断长度，再长就没法一眼扫完了 */
const SUMMARY_LIMIT = 120;

type QuoteTarget = {
  id: string;
  role: string;
  /** 助手消息才有；用户消息直接显示「你」 */
  agentName?: string;
  content: string;
};

type Props = {
  replyTo: QuoteTarget;
  onClose: () => void;
  /**
   * 嵌在作曲卡内时用单行紧凑版（对齐 Web composer-quote-bar）；
   * 独立放置时保留双行摘要。
   */
  compact?: boolean;
};

/** 摘要：压掉换行再截断，否则一整段代码块会把引用条撑成一大块。 */
function summarize(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= SUMMARY_LIMIT) return flat;
  return `${flat.slice(0, SUMMARY_LIMIT)}…`;
}

/**
 * 引用条：正在回复谁。
 *
 * 对齐 Web 端 `composer-quote-bar`。compact 时单行「回复 X · 摘要」，
 * 否则双行铺开，方便独立确认目标。
 */
export function QuoteBar({ replyTo, onClose, compact }: Props): JSX.Element {
  const speaker = replyTo.role === "user" ? "你" : replyTo.agentName || "助手";
  const summary = summarize(replyTo.content);

  if (compact) {
    return (
      <View className="flex-row items-center gap-2 px-3 py-2.5">
        <Icon name="return-down-forward-outline" size={16} tone="muted" />
        <Typography.Paragraph color="muted" className="flex-1 text-[13px]" numberOfLines={1}>
          回复 {speaker} · {summary}
        </Typography.Paragraph>
        <CloseButton onPress={onClose} accessibilityLabel="取消回复" />
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2">
      <Icon name="return-down-forward-outline" size={16} tone="muted" />

      <View className="flex-1 gap-0.5">
        <Typography.Paragraph color="muted" className="text-[10px]" numberOfLines={1}>
          回复 {speaker}
        </Typography.Paragraph>
        <Typography.Paragraph className="text-xs" numberOfLines={2}>
          {summary}
        </Typography.Paragraph>
      </View>

      <CloseButton onPress={onClose} accessibilityLabel="取消回复" />
    </View>
  );
}
