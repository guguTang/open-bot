import { Button, CloseButton, Input, Menu, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Icon } from "@/components/Icon";
import { avatarColor, avatarForeground, avatarInitials, formatSize } from "@/lib/format";
import { validateAttachment, type PickedFile } from "@/lib/attachments";

export type MentionMember = { id: string; name: string; description?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  /**
   * 请求添加附件。Composer 只负责弹出「文件 / 相册 / 拍照」入口，
   * 真正的系统选择器与文件解析交给聊天页 —— 它才知道怎么转成可上传的 uri。
   */
  onRequestAttach: (source: "files" | "images" | "camera") => void;
  onRemoveFile: (key: string) => void;
  files?: PickedFile[];
  sending?: boolean;
  disabled?: boolean;
  agentName?: string;
  /** 群聊时传入成员，启用 @ 点名 */
  mentionMembers?: MentionMember[];
  /** 附件上传中，禁用一切交互 */
  busy?: boolean;
};

type MentionState = { start: number; query: string };

/**
 * 识别光标前的 `@`。规则照搬 Web 端 `detectMention`：
 * `@` 必须在行首或空白之后，且 `@` 与光标之间不能有空白。
 */
function detectMention(value: string, caret: number): MentionState | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0) {
    const prev = before[at - 1];
    if (prev && !/\s/.test(prev)) return null;
  }
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/** 单个助手头像，和 Web 端 `AgentAvatar` 取色一致。 */
function MentionAvatar({ member }: { member: MentionMember }): JSX.Element {
  const bg = avatarColor(member.id || member.name);
  return (
    <View
      className="size-6 items-center justify-center rounded-full"
      style={{ backgroundColor: bg }}
    >
      <Typography.Paragraph
        className="text-[10px]"
        style={{ color: avatarForeground(bg) }}
      >
        {avatarInitials(member.name)}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * 作曲栏：附件 + 多行输入 + @点名 + 发送/停止。
 *
 * 与 Web 端 `Composer.tsx` 的行为差异：
 * - 附件入口多一步「文件 / 相册」选择（RN 没有 `<input type=file>`）
 * - @候试用**点选**而非方向键（移动端没有物理方向键）
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  onRequestAttach,
  onRemoveFile,
  files = [],
  sending,
  disabled,
  agentName,
  mentionMembers,
  busy,
}: Props): JSX.Element {
  const [mention, setMention] = useState<MentionState | null>(null);
  const [caret, setCaret] = useState(0);

  const canSend = Boolean(value.trim() || files.length > 0);
  const locked = Boolean(disabled || busy);

  const mentionOptions: MentionMember[] = (() => {
    if (!mention || !mentionMembers?.length) return [];
    const q = mention.query.trim().toLowerCase();
    if (!q) return mentionMembers.slice(0, 8);
    return mentionMembers
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          (m.description || "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  })();

  const applyMention = (member: MentionMember): void => {
    if (!mention) return;
    const insert = `@${member.name} `;
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    const next = before + insert + after;
    onChange(next);
    setMention(null);
  };

  const handleChange = (next: string): void => {
    onChange(next);
    if (mentionMembers?.length) {
      setMention(detectMention(next, caret));
    }
  };

  const placeholder = mentionMembers?.length
    ? "给群聊发消息，@ 点名助手"
    : `给 ${agentName || "助手"} 发消息`;

  return (
    <View className="gap-2 px-4 pt-3">
      {files.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2 pr-2">
            {files.map((f) => {
              const issue = validateAttachment(f);
              return (
                <View
                  key={f.key}
                  className={`flex-row items-center gap-2 rounded-xl py-1.5 pr-1 pl-3 ${
                    issue ? "bg-danger-soft" : "bg-surface-secondary"
                  }`}
                >
                  <View className="flex-1">
                    <Typography.Paragraph
                      className={`text-xs ${issue ? "text-danger-soft-foreground" : ""}`}
                      numberOfLines={1}
                    >
                      {f.name}
                    </Typography.Paragraph>
                    <Typography.Paragraph
                      className={`text-[10px] ${issue ? "text-danger" : "text-muted"}`}
                      numberOfLines={1}
                    >
                      {issue ?? (typeof f.size === "number" ? formatSize(f.size) : "")}
                    </Typography.Paragraph>
                  </View>
                  <CloseButton
                    isDisabled={sending || busy}
                    onPress={() => onRemoveFile(f.key)}
                    accessibilityLabel={`移除 ${f.name}`}
                  />
                </View>
              );
            })}
          </View>
        </ScrollView>
      ) : null}

      {mention && mentionOptions.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2 pr-2">
            {mentionOptions.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => applyMention(m)}
                accessibilityRole="button"
                className="flex-row items-center gap-2 rounded-xl bg-surface-secondary px-3 py-1.5"
              >
                <MentionAvatar member={m} />
                <View>
                  <Typography.Paragraph className="text-xs">{m.name}</Typography.Paragraph>
                  <Typography.Paragraph color="muted" className="text-[10px]">
                    @{m.id}
                  </Typography.Paragraph>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View className="flex-row items-end gap-1">
        {/* 附件入口同时是底部动作表的 trigger —— 一个控件两段语义，
            比「点加号 → 弹 Dialog → 再选来源」少一次往返。 */}
        <Menu>
          <Menu.Trigger isDisabled={locked || sending}>
            <Button
              isIconOnly
              variant="ghost"
              accessibilityLabel="添加附件"
              isDisabled={locked || sending}
            >
              <Icon name="attach-outline" size={22} />
            </Button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content presentation="bottom-sheet">
              <Menu.Label>添加附件</Menu.Label>
              <Menu.Item onPress={() => onRequestAttach("files")}>
                <Menu.ItemTitle>从文件中选择</Menu.ItemTitle>
              </Menu.Item>
              <Menu.Item onPress={() => onRequestAttach("images")}>
                <Menu.ItemTitle>从相册选择</Menu.ItemTitle>
              </Menu.Item>
              <Menu.Item onPress={() => onRequestAttach("camera")}>
                <Menu.ItemTitle>拍照</Menu.ItemTitle>
              </Menu.Item>
              <Typography.Paragraph color="muted" className="px-4 pt-3 pb-1 text-xs">
                支持图片、文本、pdf、json、md、csv 与代码文件，单个不超过 20MB
              </Typography.Paragraph>
            </Menu.Content>
          </Menu.Portal>
        </Menu>

        <Input
          className="flex-1"
          containerClassName="flex-1"
          value={value}
          onChangeText={handleChange}
          onSelectionChange={(e) => {
            const next = e.nativeEvent.selection.end;
            setCaret(next);
            if (mentionMembers?.length) {
              setMention(detectMention(value, next));
            }
          }}
          placeholder={placeholder}
          multiline
          editable={!disabled && !busy}
          onSubmitEditing={() => {
            if (sending) {
              if (!canSend) onStop?.();
            } else if (canSend) {
              onSend();
            }
          }}
        />

        {sending ? (
          <Button
            isIconOnly
            variant="danger-soft"
            onPress={() => onStop?.()}
            accessibilityLabel="停止生成"
          >
            <Icon name="stop" size={20} tone="danger-soft-foreground" />
          </Button>
        ) : (
          <Button
            isIconOnly
            isDisabled={!canSend || busy}
            onPress={onSend}
            accessibilityLabel="发送"
          >
            <Icon name="arrow-up" size={20} tone="accent-foreground" />
          </Button>
        )}
      </View>

      {busy ? (
        <Typography.Paragraph color="muted" className="text-center text-xs">
          正在上传附件…
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}