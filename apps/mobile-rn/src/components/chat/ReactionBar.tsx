import { Chip, Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { Text, View } from "react-native";

import { deleteReaction, NEGATIVE_REACTION_EMOJIS, REACTION_EMOJIS, toggleReaction } from "@/api";
import type { ReactionSummary, ReactionUpdatedEvent } from "@/api/types";
import { Icon } from "@/components/Icon";

/**
 * `as const` 元组只接受字面量，这里先摊平成 string[] 才能拿运行时 emoji 去 includes。
 */
const NEGATIVE: readonly string[] = NEGATIVE_REACTION_EMOJIS;

type Props = {
  messageId: string;
  /** 服务端可能给 null（没有表情时）；count 为 0 的条目也直接不显示 */
  reactions?: ReactionSummary[] | null;
  /** 服务端确认后的权威事件，由聊天页写回消息列表 */
  onChanged: (evt: ReactionUpdatedEvent) => void;
  /** 本地临时消息、正在流式输出等不可回应的场景 */
  disabled?: boolean;
  /** 新增 👎 / ❌ 成功后回调，弹反馈窗由外面控制 */
  onRequestFeedback?: (messageId: string) => void;
  /** 传了就交给外面提示；不传则在本条消息下方显示一行红字 */
  onError?: (message: string) => void;
};

/**
 * 乐观更新：先算出点完之后的列表立刻渲染，服务端回来之前不空等。
 *
 * `removing` 时 count 掉到 0 就整条移除 —— 留着「👍 0」是个永远点不掉的僵尸 chip。
 */
function applyOptimistic(
  list: ReactionSummary[],
  emoji: string,
  removing: boolean
): ReactionSummary[] {
  const index = list.findIndex((r) => r.emoji === emoji);
  if (removing) {
    if (index < 0) return list;
    const next = [...list];
    const count = next[index].count - 1;
    if (count <= 0) {
      next.splice(index, 1);
    } else {
      next[index] = { ...next[index], count, me: false };
    }
    return next;
  }
  if (index < 0) return [...list, { emoji, count: 1, me: true }];
  const next = [...list];
  next[index] = { ...next[index], count: next[index].count + 1, me: true };
  return next;
}

/**
 * 表情回应条。
 *
 * 对齐 Web 端 `MessageReactions.tsx`，但补了移动端特有的两件事：
 * - **「+」入口**：Web 靠 hover 栏加表情，触屏没有 hover，加号就地展开白名单即可，
 *   不用跳去长按面板再选一次
 * - **组件内自己调 API**：Web 端由聊天页持有 messages 状态，这里为了能做乐观更新
 *   和回滚，把请求收在组件内，最终结果仍通过 `onChanged` 交回聊天页
 */
export function ReactionBar({
  messageId,
  reactions,
  onChanged,
  disabled,
  onRequestFeedback,
  onError,
}: Props): JSX.Element {
  // 乐观值只在下一次请求返回前生效，之后交回 props —— props 才是唯一真相
  const [optimistic, setOptimistic] = useState<ReactionSummary[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const base = (reactions ?? []).filter((r) => r.count > 0);
  const list = optimistic ?? base;

  const apply = useCallback(
    async (emoji: string) => {
      if (disabled || busy) return;

      const removing = Boolean(base.find((r) => r.emoji === emoji)?.me);
      setOptimistic(applyOptimistic(base, emoji, removing));
      setError("");
      setBusy(true);
      try {
        const evt = removing
          ? await deleteReaction(messageId, emoji)
          : await toggleReaction(messageId, emoji);
        setOptimistic(null);
        onChanged(evt);
        // 负表情只在「新增」时追问原因；取消不算，别在用户改主意时弹窗
        if (!removing && NEGATIVE.includes(emoji)) onRequestFeedback?.(messageId);
      } catch (err) {
        // 回滚到 props，并提示失败原因
        setOptimistic(null);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onError?.(message);
      } finally {
        setBusy(false);
      }
    },
    [base, busy, disabled, messageId, onChanged, onError, onRequestFeedback]
  );

  const locked = Boolean(disabled || busy);

  return (
    <View className="gap-1.5">
      <View className="flex-row flex-wrap items-center gap-1.5">
        {list.map((r) => (
          <Chip
            key={r.emoji}
            size="sm"
            // 自己点过的用 accent 高亮，和别人点的区分开
            variant={r.me ? "primary" : "secondary"}
            color={r.me ? "accent" : "default"}
            disabled={locked}
            onPress={() => void apply(r.emoji)}
            accessibilityLabel={r.me ? `取消反应 ${r.emoji}` : `添加反应 ${r.emoji}`}
          >
            <Chip.Label>
              <Text className="text-sm">
                {r.emoji} {r.count}
              </Text>
            </Chip.Label>
          </Chip>
        ))}

        <Chip
          size="sm"
          variant="secondary"
          color="default"
          disabled={locked}
          onPress={() => setPickerOpen((v) => !v)}
          accessibilityLabel={pickerOpen ? "收起表情选择" : "添加表情回应"}
        >
          <Chip.Label>
            <Icon name={pickerOpen ? "close" : "add"} size={14} tone="muted" />
          </Chip.Label>
        </Chip>
      </View>

      {pickerOpen ? (
        <View className="flex-row flex-wrap gap-1.5">
          {REACTION_EMOJIS.map((emoji) => {
            const mine = Boolean(base.find((r) => r.emoji === emoji)?.me);
            return (
              <Chip
                key={emoji}
                size="sm"
                variant={mine ? "primary" : "secondary"}
                color={mine ? "accent" : "default"}
                disabled={locked}
                onPress={() => void apply(emoji)}
                accessibilityLabel={`回应 ${emoji}`}
              >
                <Chip.Label>
                  <Text className="text-base">{emoji}</Text>
                </Chip.Label>
              </Chip>
            );
          })}
        </View>
      ) : null}

      {error && !onError ? (
        <Typography.Paragraph className="text-[10px] text-danger">{error}</Typography.Paragraph>
      ) : null}
    </View>
  );
}
