import { Button, Chip, Dialog, Label, Spinner, TextArea, Typography } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { View } from "react-native";

import { createMessageFeedback } from "@/api";
import type { FeedbackPolarity, FeedbackSource, Message, MessageFeedback } from "@/api/types";

/** 负面原因标签，文案对齐 Web 端 `FeedbackModal.tsx` */
const NEGATIVE_REASONS = [
  { id: "wrong", label: "答错了 / 事实不准" },
  { id: "verbose", label: "太啰嗦" },
  { id: "not_followed", label: "没按要求做" },
  { id: "missed_steps", label: "漏了关键步骤" },
  { id: "tone", label: "语气/格式不对" },
  { id: "other", label: "其它" },
] as const;

const POSITIVE_REASONS = [
  { id: "good", label: "答得好" },
  { id: "concise", label: "简洁有用" },
  { id: "format_ok", label: "格式对" },
] as const;

const NOTE_LIMIT = 500;

type Props = {
  visible: boolean;
  onClose: () => void;
  message: Message;
  /** 标题里显示的 Bot 名 */
  agentName?: string;
  /** 会话 id；消息自带时优先用消息上的 */
  conversationId?: string;
  /** 反馈来源：面板主动打开 = feedback_menu，负表情联动 = reaction_followup */
  source: FeedbackSource;
  /** 打开时的初始极性。Web 端两个入口都默认 negative */
  initialPolarity?: FeedbackPolarity;
  onSubmitted?: (feedback: MessageFeedback) => void;
};

/**
 * 消息反馈弹窗。
 *
 * 对齐 Web 端 `FeedbackModal.tsx`：极性二选一 + 原因标签 + 补充说明。
 * 差异只有一处 —— Web 用 `onSubmit` 把请求抛给聊天页，RN 端直接在这里调
 * `createMessageFeedback`，因为提交结果除了关窗没别的去处。
 *
 * 和 Web 一致的地方：原因标签**不是必选**，补充说明也不是；
 * 反馈本身才是提交这个动作的全部信息量。
 */
export function FeedbackModal({
  visible,
  onClose,
  message,
  agentName,
  conversationId,
  source,
  initialPolarity = "negative",
  onSubmitted,
}: Props): JSX.Element {
  const [polarity, setPolarity] = useState<FeedbackPolarity>(initialPolarity);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 每次打开都是干净的一张表：上一条消息的标签和说明不该漏到下一条。
  // 用 render 阶段的比较而不是 effect，避免每次开关多渲染一轮
  //（effect 里 setState 是 react-hooks/set-state-in-effect 管的写法）。
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setPolarity(initialPolarity);
      setReasons([]);
      setNote("");
      setError("");
      setBusy(false);
    }
  }

  const toggleReason = useCallback((id: string) => {
    setReasons((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const agentId = message.agent_id ?? "";
  const convId = message.conversation_id || conversationId || "";

  const submit = async (): Promise<void> => {
    if (busy) return;
    // 这两个字段是后端建 lesson 的依据，缺了整条反馈就没有归属
    if (!agentId || !convId) {
      setError("无法定位这条回复所属的会话或 Bot");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const feedback = await createMessageFeedback({
        message_id: message.id,
        agent_id: agentId,
        conversation_id: convId,
        polarity,
        reasons,
        note: note.trim().slice(0, NOTE_LIMIT) || undefined,
        source,
      });
      onSubmitted?.(feedback);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const presets = polarity === "negative" ? NEGATIVE_REASONS : POSITIVE_REASONS;

  return (
    <Dialog isOpen={visible} onOpenChange={(open: boolean) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress={!busy}>
          <Dialog.Content>
            <Dialog.Title numberOfLines={1}>给 {agentName || "助手"} 的反馈</Dialog.Title>
            <Dialog.Description>
              反馈经你确认经验后才会用来改进这个 Bot；表情反应本身不会进记忆。
            </Dialog.Description>

            <View className="mt-4 gap-4">
              <View className="gap-2">
                <Typography.Paragraph color="muted" className="text-xs">
                  极性
                </Typography.Paragraph>
                <View className="flex-row gap-2">
                  {(["positive", "negative"] as const).map((p) => (
                    <Chip
                      key={p}
                      size="sm"
                      variant={polarity === p ? "primary" : "secondary"}
                      color={polarity === p ? "accent" : "default"}
                      disabled={busy}
                      onPress={() => {
                        // 换极性就清空标签：两套标签没有交集，留着会提交出矛盾的 reasons
                        setPolarity(p);
                        setReasons([]);
                      }}
                    >
                      <Chip.Label>{p === "positive" ? "正面" : "负面"}</Chip.Label>
                    </Chip>
                  ))}
                </View>
              </View>

              <View className="gap-2">
                <Typography.Paragraph color="muted" className="text-xs">
                  原因标签（可多选）
                </Typography.Paragraph>
                <View className="flex-row flex-wrap gap-2">
                  {presets.map((r) => (
                    <Chip
                      key={r.id}
                      size="sm"
                      variant={reasons.includes(r.id) ? "primary" : "secondary"}
                      color={reasons.includes(r.id) ? "accent" : "default"}
                      disabled={busy}
                      onPress={() => toggleReason(r.id)}
                    >
                      <Chip.Label>{r.label}</Chip.Label>
                    </Chip>
                  ))}
                </View>
              </View>

              <View className="gap-2">
                <Label>
                  <Label.Text>补充说明（可选）</Label.Text>
                </Label>
                <TextArea
                  value={note}
                  onChangeText={setNote}
                  editable={!busy}
                  placeholder="想让它下次怎么改？"
                  maxLength={NOTE_LIMIT}
                  className="min-h-[88px]"
                />
                <View className="flex-row justify-end">
                  <Typography.Paragraph color="muted" className="text-[10px]">
                    {note.length}/{NOTE_LIMIT}
                  </Typography.Paragraph>
                </View>
              </View>

              {error ? (
                <Typography.Paragraph className="text-xs text-danger">{error}</Typography.Paragraph>
              ) : null}
            </View>

            <View className="mt-4 flex-row justify-end gap-3 pb-safe-or-2">
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={onClose}>
                <Button.Label>取消</Button.Label>
              </Button>
              <Button size="sm" isDisabled={busy} onPress={() => void submit()}>
                {busy ? <Spinner size="sm" color="accent-foreground" /> : null}
                <Button.Label>{busy ? "提交中…" : "提交反馈"}</Button.Label>
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}
