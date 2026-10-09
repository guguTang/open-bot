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
  replyTo: QuoteTarget | null;
  onClose: () => void;
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
 * 对齐 Web 端 `Composer.tsx` 的 `composer-quote-bar`，但 Web 用单行
 * `title` 提示原文，RN 没有悬浮提示，所以这里多截一段摘要直接铺在条上 ——
 * 长按消息时能确认自己到底要回哪条，比一个问号图标有用得多。
 */
export function QuoteBar({ replyTo, onClose }: Props): JSX.Element | null {
  if (!replyTo) return null;

  const speaker = replyTo.role === "user" ? "你" : replyTo.agentName || "助手";

  return (
    <View className="mb-1.5 flex-row items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2">
      <Icon name="return-down-forward-outline" size={16} tone="muted" />

      <View className="flex-1 gap-0.5">
        <Typography.Paragraph color="muted" className="text-[10px]" numberOfLines={1}>
          回复 {speaker}
        </Typography.Paragraph>
        <Typography.Paragraph className="text-xs" numberOfLines={2}>
          {summarize(replyTo.content)}
        </Typography.Paragraph>
      </View>

      <CloseButton onPress={onClose} accessibilityLabel="取消回复" />
    </View>
  );
}
