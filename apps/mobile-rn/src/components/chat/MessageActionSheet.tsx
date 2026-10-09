import * as Clipboard from "expo-clipboard";
import { Menu, Typography } from "heroui-native";
import { useEffect, useRef, useState, type JSX } from "react";
import { Pressable, Text, View } from "react-native";

import { REACTION_EMOJIS } from "@/api";
import type { Message } from "@/api/types";
import { Icon } from "@/components/Icon";

type Props = {
  /** 显隐由外部控制（长按 400ms 触发在聊天页里） */
  visible: boolean;
  onClose: () => void;
  message: Message;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onFeedback: () => void;
  /** 当前会话不允许回复时隐藏「回复」项 */
  canReply?: boolean;
};

/**
 * 消息长按操作面板。
 *
 * 对齐 Web 端 `MessageActionSheet.tsx`（触屏版），底层换成 heroui-native 的
 * `Menu presentation="bottom-sheet"` —— 和 `Composer` 的附件选择同一个组件，
 * 免得同一个 App 里出现两种底部弹层手感。
 *
 * 注意 `presentation` 要在 Root 和 Content 上都写：heroui-native 在 `__DEV__` 下
 * 会校验两者一致，不一致直接抛错。
 *
 * 这里**不自己调 API**：表情的乐观更新和回滚都在 `ReactionBar` 里，
 * 面板只负责把选中的 emoji 递出去，避免同一条消息出现两套状态源。
 */
export function MessageActionSheet({
  visible,
  onClose,
  message,
  onReact,
  onReply,
  onFeedback,
  canReply = true,
}: Props): JSX.Element {
  const [emojiPage, setEmojiPage] = useState(false);
  const [copied, setCopied] = useState<"content" | "request" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // 收起时把内部页面状态复位：下次长按要回到主列表，而不是停在上一次的
  // 子页面。这里用 render 阶段的比较而不是 effect —— effect 版本会多渲染一轮，
  // 而且 effect 里 setState 正是 react-hooks/set-state-in-effect 管的写法。
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) {
      setEmojiPage(false);
      setCopied(null);
    }
  }

  // RN 没有全局 toast（根布局只挂了 ConfirmProvider），所以复制提示就地显示在行内 ——
  // 和 Markdown.tsx 代码块的「复制/已复制」同一套做法。闪完顺手把面板收掉，
  // 不然用户复制完还得再点一次「取消」才能继续。
  const copy = async (text: string, which: "content" | "request"): Promise<void> => {
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      setCopied(which);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(null);
        onClose();
      }, 1500);
    } catch {
      // 剪贴板失败（比如系统限制）不该把面板留着不放
      onClose();
    }
  };

  const pick = (emoji: string): void => {
    onReact(emoji);
    onClose();
  };

  const isBot = message.role === "assistant";

  return (
    <Menu
      presentation="bottom-sheet"
      isOpen={visible}
      onOpenChange={(open: boolean) => !open && onClose()}
    >
      <Menu.Portal>
        <Menu.Overlay />
        <Menu.Content presentation="bottom-sheet">
          {emojiPage ? (
            <View className="gap-3">
              <Typography.Paragraph color="muted" className="text-xs">
                选择表情
              </Typography.Paragraph>
              <View className="flex-row flex-wrap gap-2 px-1 pb-2">
                {REACTION_EMOJIS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => pick(emoji)}
                    accessibilityRole="button"
                    accessibilityLabel={`回应 ${emoji}`}
                    className="size-11 items-center justify-center rounded-xl bg-surface-secondary"
                  >
                    <Text className="text-xl">{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              <Menu.Item onPress={() => setEmojiPage(false)}>
                <Icon name="chevron-back-outline" size={18} tone="muted" />
                <Menu.ItemTitle>返回</Menu.ItemTitle>
              </Menu.Item>
            </View>
          ) : (
            <View>
              <Menu.Item onPress={() => setEmojiPage(true)}>
                <Icon name="happy-outline" size={18} tone="muted" />
                <Menu.ItemTitle>加表情</Menu.ItemTitle>
              </Menu.Item>

              {canReply ? (
                <Menu.Item
                  onPress={() => {
                    onReply();
                    onClose();
                  }}
                >
                  <Icon name="return-down-forward-outline" size={18} tone="muted" />
                  <Menu.ItemTitle>回复</Menu.ItemTitle>
                </Menu.Item>
              ) : null}

              <View className="my-1 h-px bg-separator" />

              <Menu.Item onPress={() => void copy(message.content, "content")}>
                <Icon name="copy-outline" size={18} tone="muted" />
                <Menu.ItemTitle>{copied === "content" ? "已复制" : "复制正文"}</Menu.ItemTitle>
              </Menu.Item>

              {/* 只有助手回复带 run id，用户自己的消息没有可报障的请求 */}
              {message.request_id ? (
                <Menu.Item onPress={() => void copy(message.request_id ?? "", "request")}>
                  <Icon name="copy-outline" size={18} tone="muted" />
                  <Menu.ItemTitle>
                    {copied === "request" ? "已复制请求 ID" : "复制请求 ID"}
                  </Menu.ItemTitle>
                </Menu.Item>
              ) : null}

              {isBot ? (
                <Menu.Item
                  onPress={() => {
                    onFeedback();
                    onClose();
                  }}
                >
                  <Icon name="flag-outline" size={18} tone="muted" />
                  <Menu.ItemTitle>反馈</Menu.ItemTitle>
                </Menu.Item>
              ) : null}

              <View className="my-1 h-px bg-separator" />

              <Menu.Item onPress={onClose}>
                <Icon name="close" size={18} tone="muted" />
                <Menu.ItemTitle>取消</Menu.ItemTitle>
              </Menu.Item>
            </View>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}
