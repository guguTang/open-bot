import { Button, CloseButton, Input, Menu, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { Icon } from "@/components/Icon";
import { avatarColor, avatarForeground, avatarInitials, formatSize } from "@/lib/format";
import { validateAttachment, type PickedFile } from "@/lib/attachments";

export type MentionMember = { id: string; name: string; description?: string };

/** 被引用的消息；聊天页把它渲染成作曲框上方的引用条。 */
export type QuoteTarget = { id: string; role: string; agentName?: string; content: string };

export type SkillOption = { name: string; description?: string };

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
  /** 单聊时也能 @ 其它助手 —— Web 端叫「转交」，插入同样的 @名字 */
  dmCandidates?: MentionMember[];
  /** 群聊才提供 @所有人 */
  allowEveryone?: boolean;
  /** `/` 补全用：本 Bot 已启用的技能 */
  skills?: SkillOption[];
  /** `@routine:` 补全用 */
  routines?: { name: string }[];
  /** `@mcp:` 补全用 */
  mcpServers?: { name: string }[];
  /** 附件上传中，禁用一切交互 */
  busy?: boolean;
};

type MentionState = { start: number; query: string };

/** `@` 候选。插入文本与 Web 端保持一致，后端按这些字面量解析。 */
type MentionOption = {
  key: string;
  name: string;
  sub?: string;
  insert: string;
  /** 助手候选才画头像 */
  agentId?: string;
};

/**
 * 识别光标前的 `@`。规则照搬 Web 端 `detectMention`：
 * `@` 必须在行首或空白之后，且 `@` 与光标之间不能有空白。
 *
 * `@routine:` / `@mcp:` 里的冒号与斜杠不算空白，所以同一套规则天然覆盖，
 * 不需要为它们再开一条分支。
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

/**
 * 识别光标前的 `/`，用于技能补全。规则与 `@` 对称：
 * 必须在行首（`/foo`）或空白之后（`帮我 /foo`），且中间没有空白。
 */
function detectSlash(value: string, caret: number): MentionState | null {
  const before = value.slice(0, caret);
  const slash = before.lastIndexOf("/");
  if (slash < 0) return null;
  if (slash > 0) {
    const prev = before[slash - 1];
    if (prev && !/\s/.test(prev)) return null;
  }
  const query = before.slice(slash + 1);
  if (/\s/.test(query)) return null;
  return { start: slash, query };
}

/** 单个助手头像，和 Web 端 `AgentAvatar` 取色一致。 */
function MentionAvatar({ member }: { member: MentionMember }): JSX.Element {
  const bg = avatarColor(member.id || member.name);
  return (
    <View
      className="size-6 items-center justify-center rounded-full"
      style={{ backgroundColor: bg }}
    >
      <Typography.Paragraph className="text-[10px]" style={{ color: avatarForeground(bg) }}>
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
  dmCandidates,
  allowEveryone,
  skills = [],
  routines = [],
  mcpServers = [],
  busy,
}: Props): JSX.Element {
  const [mention, setMention] = useState<MentionState | null>(null);
  const [slash, setSlash] = useState<MentionState | null>(null);
  const [caret, setCaret] = useState(0);

  const canSend = Boolean(value.trim() || files.length > 0);
  const locked = Boolean(disabled || busy);

  const mentionOptions: MentionOption[] = (() => {
    if (!mention) return [];
    const q = mention.query.trim().toLowerCase();

    const agents: MentionOption[] = (mentionMembers ?? []).map((m) => ({
      key: `agent:${m.id}`,
      name: m.name,
      sub: `@${m.id}`,
      insert: `@${m.name} `,
      agentId: m.id,
    }));
    const dm: MentionOption[] = (dmCandidates ?? [])
      .filter((m) => !(mentionMembers ?? []).some((x) => x.id === m.id))
      .map((m) => ({
        key: `dm:${m.id}`,
        name: m.name,
        sub: "转交给这个助手",
        insert: `@${m.name} `,
        agentId: m.id,
      }));
    const everyone: MentionOption[] = allowEveryone
      ? [
          { key: "everyone", name: "@所有人", sub: "全体成员都回复", insert: "@everyone " },
          { key: "all", name: "@all", sub: "同 @所有人", insert: "@all " },
        ]
      : [];
    const routine: MentionOption[] =
      q.startsWith("routine:") || !q
        ? routines.map((r) => ({
            key: `routine:${r.name}`,
            name: `例行：${r.name}`,
            sub: "@routine:",
            insert: `@routine:${r.name} `,
          }))
        : [];
    const mcp: MentionOption[] =
      q.startsWith("mcp:") || !q
        ? mcpServers.map((s) => ({
            key: `mcp:${s.name}`,
            name: `插件：${s.name}`,
            sub: "@mcp:",
            insert: `@mcp:${s.name} `,
          }))
        : [];

    const all = [...agents, ...dm, ...everyone, ...routine, ...mcp];
    if (!q) return all.slice(0, 10);
    return all
      .filter((o) => o.name.toLowerCase().includes(q) || (o.sub ?? "").toLowerCase().includes(q))
      .slice(0, 10);
  })();

  const slashOptions: SkillOption[] = (() => {
    if (!slash || skills.length === 0) return [];
    const q = slash.query.trim().toLowerCase();
    if (!q) return skills.slice(0, 8);
    return skills
      .filter(
        (s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  })();

  const applyMention = (option: MentionOption): void => {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(caret);
    onChange(before + option.insert + after);
    setMention(null);
  };

  /**
   * `/` 补全插入的是一句提示而不是裸路径 —— 后端把 `@mcp:` / `@routine:` 当作
   * 作曲框提示文案，真正的执行仍走 Bot 自己的工具（见 docs/缺口与下一批.md）。
   * 技能同理，插入「请 load_skill X」让助手自己决定怎么用。
   */
  const applySlash = (skill: SkillOption): void => {
    if (!slash) return;
    const before = value.slice(0, slash.start);
    const after = value.slice(caret);
    onChange(`${before}请 load_skill ${skill.name} ${after}`);
    setSlash(null);
  };

  const hasMentionSources =
    Boolean(mentionMembers?.length) ||
    Boolean(dmCandidates?.length) ||
    Boolean(allowEveryone) ||
    routines.length > 0 ||
    mcpServers.length > 0;

  const handleChange = (next: string): void => {
    onChange(next);
    if (hasMentionSources) {
      setMention(detectMention(next, caret));
    }
    setSlash(skills.length > 0 ? detectSlash(next, caret) : null);
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
            {mentionOptions.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => applyMention(o)}
                accessibilityRole="button"
                accessibilityLabel={`插入 ${o.name}`}
                className="flex-row items-center gap-2 rounded-xl bg-surface-secondary px-3 py-1.5"
              >
                {o.agentId ? (
                  <MentionAvatar member={{ id: o.agentId, name: o.name }} />
                ) : (
                  <Icon name="at-outline" size={16} tone="muted" />
                )}
                <View>
                  <Typography.Paragraph className="text-xs">{o.name}</Typography.Paragraph>
                  {o.sub ? (
                    <Typography.Paragraph color="muted" className="text-[10px]">
                      {o.sub}
                    </Typography.Paragraph>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      {/* `/` 技能补全。插入的是「请 load_skill X」，最终由助手自己决定怎么用。 */}
      {slash && slashOptions.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-2 pr-2">
            {slashOptions.map((s) => (
              <Pressable
                key={s.name}
                onPress={() => applySlash(s)}
                accessibilityRole="button"
                accessibilityLabel={`使用技能 ${s.name}`}
                className="max-w-56 flex-row items-center gap-2 rounded-xl bg-surface-secondary px-3 py-1.5"
              >
                <Icon name="flash-outline" size={16} tone="muted" />
                <View className="flex-1">
                  <Typography.Paragraph className="text-xs">{s.name}</Typography.Paragraph>
                  {s.description ? (
                    <Typography.Paragraph color="muted" className="text-[10px]" numberOfLines={1}>
                      {s.description}
                    </Typography.Paragraph>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      ) : null}

      <View className="flex-row items-end gap-1">
        {/* 附件入口同时是底部动作表的 trigger —— 一个控件两段语义，
            比「点加号 → 弹 Dialog → 再选来源」少一次往返。 */}
        {/* presentation 必须和 Menu.Content 一致：heroui-native 在 __DEV__ 下
            会校验两者相等，不等直接 throw。Root 的默认值是 popover，
            而这里要的是底部动作表，两处都得显式写。 */}
        <Menu presentation="bottom-sheet">
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
            if (hasMentionSources) {
              setMention(detectMention(value, next));
            }
            setSlash(skills.length > 0 ? detectSlash(value, next) : null);
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
