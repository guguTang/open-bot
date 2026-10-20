import { Typography } from "heroui-native";
import type { JSX } from "react";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type {
  AttachmentMeta,
  HandoffPayload,
  HostConfirmPayload,
  MessageSource,
} from "@/api/types";
import { isImageAttachmentMime } from "@/api";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ArtifactCards } from "@/components/ArtifactCards";
import { Icon } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";
import { OpenUIBlock } from "@/openui/OpenUIBlock";
import {
  HtmlDiagramCard,
  ImageDiagramCard,
  MermaidDiagramCard,
} from "@/components/chat/DiagramCards";
import { HandoffCard } from "@/components/chat/HandoffCard";
import { HostConfirmCard } from "@/components/chat/HostConfirmCard";
import { MessageSourcesFooter } from "@/components/chat/MessageSourcesFooter";
import { ReactionBar } from "@/components/chat/ReactionBar";
import { formatSize } from "@/lib/format";
import { buildAssistantBody } from "@/lib/messageBody";

export type UiMessage = {
  id: string;
  role: string;
  content: string;
  streaming?: boolean;
  attachments?: AttachmentMeta[];
  agent_id?: string;
  agent_name?: string;
  reactions?: { emoji: string; count: number; me: boolean }[];
  /** 运行时 run id，用户报障时复制这个 */
  request_id?: string;
  /** 引用回复的父消息 id */
  reply_to_id?: string;
  /** 线程根 id；非空说明这是一条线程内回复 */
  thread_root_id?: string;
  sources?: MessageSource[];
  handoff?: HandoffPayload;
  host_confirm?: HostConfirmPayload;
  /** 停止标记，用于把服务端封口行和本地气泡对上 */
  stopped?: boolean;
};

export type MessageBubbleProps = {
  message: UiMessage;
  /** 消息没带 agent_id 时回落到会话所属助手 */
  fallbackAgentId?: string;
  fallbackAgentName?: string;
  /** robot-heads / silhouette: resolve from agents by message.agent_id */
  avatarShape?: string | null;
  avatarColor?: string | null;
  /** 群聊才需要逐条标注发言者；单聊里助手名每条都一样，是纯噪音 */
  showAgentName?: boolean;
  /** 单聊所属助手。别的助手插进来的气泡标成「来自于」 */
  ownerAgentId?: string;
  /** `sandbox:` 链接点击回调；不传则用系统浏览器打开 */
  onSandboxLink?: (path: string) => void;
  /** 被这条消息引用的原消息，用于渲染引用块 */
  quoted?: UiMessage | null;
  /** 本条下面的线程回复条数；>0 时显示「N 条回复」 */
  threadCount?: number;
  onOpenThread?: (rootId: string) => void;
  /** 长按 400ms 打开操作面板 */
  onLongPress?: () => void;
  onReply?: () => void;
  /** 表情变化后由聊天页写回服务端权威值 */
  onReactionChange: (
    messageId: string,
    evt: { emoji: string; count: number; me: boolean; action: string }
  ) => void;
  /** 新增负表情后请求打开反馈弹窗 */
  onRequestFeedback?: (messageId: string) => void;
  /** 本机确认卡提交结果 */
  onDecidedHostConfirm?: (updated: unknown) => void;
  /** host 确认卡需要会话 id */
  conversationId?: string;
  /** 不可互动场景（历史消息、只读） */
  readonly?: boolean;
};

/**
 * 用户侧附件小标签。与 Web 端 `msg-attach-chip` 一致：
 * 文件名 + 体积，体积缺失时不占位。
 */
function AttachmentChips({ items }: { items: AttachmentMeta[] }): JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1.5">
      <View className="flex-row gap-1.5">
        {items.map((a) => (
          <View
            key={a.id || a.name}
            className="flex-row items-center gap-1.5 rounded-lg bg-background/25 px-2 py-1"
          >
            <Typography.Paragraph className="text-[11px] text-accent-foreground" numberOfLines={1}>
              {a.name}
            </Typography.Paragraph>
            {a.size ? (
              <Typography.Paragraph className="text-[10px] text-accent-foreground/80">
                {formatSize(a.size)}
              </Typography.Paragraph>
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * 消息气泡。
 *
 * 对齐 `apps/web/src/components/ChatMessage.tsx`：
 * - 用户消息只显示附件标签 + 纯文本（助手的话不需要 Markdown）
 * - 助手消息经 `buildAssistantBody` 抽出产物 / 图表 / 引用后再渲染
 * - 群聊里按 `agent_id` 显示发言者归属
 *
 * 圆角：用户 22px / 助手 18px（对齐 Web bubble），朝向头像/自己的那一角再收一档。
 * 两边同角会显得像一排没有指向的方块，收角之后气泡自然"贴"着它所属的那个头像。
 */
export function MessageBubble({
  message,
  fallbackAgentId,
  fallbackAgentName,
  avatarShape,
  avatarColor,
  showAgentName,
  ownerAgentId,
  onSandboxLink,
  quoted,
  threadCount = 0,
  onOpenThread,
  onLongPress,
  onReply,
  onReactionChange,
  onRequestFeedback,
  onDecidedHostConfirm,
  conversationId,
  readonly,
}: MessageBubbleProps): JSX.Element {
  const isUser = message.role === "user";
  const isSummary = message.role === "summary";

  const body = useMemo(
    () =>
      isUser
        ? null
        : buildAssistantBody({
            content: message.content,
            sources: message.sources,
            streaming: Boolean(message.streaming),
            messageId: message.id,
          }),
    [isUser, message.content, message.sources, message.streaming, message.id]
  );

  const reactions = useMemo(
    () => (message.reactions ?? []).filter((r) => r.count > 0),
    [message.reactions]
  );
  const canInteract = !readonly && !message.streaming && !message.id.startsWith("local-");

  if (message.role === "ask_notice") {
    const label = (message.content || "").trim() || "消息通知了同事";
    return (
      <View className="items-center">
        <Typography.Paragraph className="rounded-full border border-border bg-surface px-3 py-1 text-[12px] text-muted">
          {label}
        </Typography.Paragraph>
      </View>
    );
  }

  if (isUser) {
    return (
      <View className="flex-row justify-end">
        <View className="max-w-[85%] gap-1">
          <Pressable
            onLongPress={canInteract ? onLongPress : undefined}
            delayLongPress={400}
            className="gap-1.5 rounded-[22px] rounded-br-lg bg-accent px-4 py-2.5"
          >
            {quoted ? <QuoteBlock quoted={quoted} onUserBubble /> : null}
            {message.attachments?.length ? <AttachmentChips items={message.attachments} /> : null}
            {message.content ? (
              <Typography.Paragraph selectable className="text-[14.5px] leading-[1.45] text-accent-foreground">
                {message.content}
              </Typography.Paragraph>
            ) : null}
          </Pressable>
          {canInteract && reactions.length > 0 ? (
            <View className="flex-row justify-end">
              <ReactionBar
                messageId={message.id}
                reactions={reactions}
                onChanged={(evt) => onReactionChange(message.id, evt)}
              />
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  const agentId = message.agent_id || fallbackAgentId;
  const fromOtherBot =
    !showAgentName &&
    Boolean(ownerAgentId) &&
    Boolean(message.agent_id) &&
    message.agent_id !== ownerAgentId;
  const otherName = (message.agent_name || fallbackAgentName || "").trim();
  const agentName = fromOtherBot
    ? otherName
      ? `来自于 ${otherName} 的消息`
      : "来自于同事的消息"
    : showAgentName
      ? message.agent_name || fallbackAgentName
      : message.agent_name || undefined;

  return (
    <View className="flex-row items-start gap-2.5">
      <AgentAvatar
        id={agentId}
        name={agentName || "AI"}
        size={28}
        shape={avatarShape}
        color={avatarColor}
      />

      <View className="max-w-[85%] gap-1">
        {agentName ? (
          <Typography.Paragraph color="muted" className="px-1 text-[11px]">
            {agentName}
          </Typography.Paragraph>
        ) : null}

        <Pressable
          onLongPress={canInteract ? onLongPress : undefined}
          delayLongPress={400}
          className="gap-2 rounded-[18px] rounded-tl-md border border-border bg-surface px-4 py-3"
        >
          {quoted ? <QuoteBlock quoted={quoted} /> : null}

          {isSummary ? (
            <Typography.Paragraph className="text-[11px] text-muted">摘要</Typography.Paragraph>
          ) : null}

          {message.handoff ? (
            <HandoffCard payload={message.handoff} />
          ) : message.host_confirm && conversationId ? (
            <HostConfirmCard
              conversationId={conversationId}
              message={message as never}
              {...(onDecidedHostConfirm ? { onDecided: onDecidedHostConfirm as never } : {})}
              disabled={readonly}
            />
          ) : null}

          {!message.handoff && !(message.host_confirm && conversationId) ? (
            <>
              {message.attachments
                ?.filter((a) => isImageAttachmentMime(a.mime))
                .map((a) => (
                  <ImageDiagramCard key={a.id || a.name} attachment={a} alt={a.name} />
                ))}

              {/* 图表围栏在流式过程中会反复重排，先只渲染文字，等这轮稳定了再出图 */}
              {message.streaming && body?.streamingSegments.length ? (
                body.streamingSegments.map((seg, i) =>
                  seg.kind === "openui" ? (
                    <OpenUIBlock key={`o${i}`} source={seg.source} streaming />
                  ) : seg.kind === "text" ? (
                    <Markdown
                      key={`t${i}`}
                      content={seg.markdown}
                      streaming
                      {...(onSandboxLink ? { onLinkPress: onSandboxLink } : {})}
                    />
                  ) : null
                )
              ) : message.streaming ? (
                <Markdown
                  content={body?.streamingMarkdown ?? ""}
                  streaming
                  {...(onSandboxLink ? { onLinkPress: onSandboxLink } : {})}
                />
              ) : (
                (body?.segments ?? []).map((seg, i) => {
                  if (seg.kind === "openui") {
                    return <OpenUIBlock key={`o${i}`} source={seg.source} streaming={false} />;
                  }
                  if (seg.kind === "diagram") {
                    return seg.lang === "mermaid" ? (
                      <MermaidDiagramCard key={`d${i}`} source={seg.source} pending={seg.pending} />
                    ) : (
                      <HtmlDiagramCard key={`d${i}`} source={seg.source} pending={seg.pending} />
                    );
                  }
                  return seg.markdown ? (
                    <Markdown
                      key={`t${i}`}
                      content={seg.markdown}
                      {...(onSandboxLink ? { onLinkPress: onSandboxLink } : {})}
                    />
                  ) : null;
                })
              )}

              {/* 流式过程中不显示产物卡片：正文还没稳定，反复抽取会闪 */}
              {!message.streaming &&
              body &&
              (body.artifacts.length > 0 || body.collapsedJson.length > 0) ? (
                <ArtifactCards
                  artifacts={body.artifacts}
                  collapsedJson={body.collapsedJson}
                  {...(agentId ? { agentId } : {})}
                />
              ) : null}

              {!message.streaming && body?.sources.length ? (
                <MessageSourcesFooter sources={body.sources} />
              ) : null}
            </>
          ) : null}
        </Pressable>

        {canInteract && reactions.length > 0 ? (
          <ReactionBar
            messageId={message.id}
            reactions={reactions}
            onChanged={(evt) => onReactionChange(message.id, evt)}
            {...(onRequestFeedback ? { onRequestFeedback } : {})}
          />
        ) : null}

        {threadCount > 0 && message.thread_root_id !== message.id && onOpenThread ? (
          <Pressable
            onPress={() => onOpenThread(message.id)}
            accessibilityRole="button"
            accessibilityLabel={`查看 ${threadCount} 条回复`}
            className="flex-row items-center gap-1.5 px-1 py-0.5"
          >
            <Typography.Paragraph className="text-xs text-accent-foreground">
              {threadCount} 条回复
            </Typography.Paragraph>
            <Icon name="chevron-forward" size={13} tone="muted" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * 引用块：左侧 2px 竖条 + 单行摘要，对齐 Web `.msg-reply-quote`。
 * 用户气泡上用半透明前景色，避免灰条在 accent 底上发脏。
 */
function QuoteBlock({
  quoted,
  onUserBubble,
}: {
  quoted: UiMessage;
  onUserBubble?: boolean;
}): JSX.Element {
  const who = quoted.role === "user" ? "你" : quoted.agent_name || "助手";
  const text = quoted.content.replace(/\s+/g, " ").trim();
  return (
    <View
      className={`mb-1 border-l-2 py-1 pl-2 ${
        onUserBubble ? "border-accent-foreground/55" : "border-muted"
      }`}
    >
      <Typography.Paragraph
        className={`text-[12.5px] leading-[1.4] ${
          onUserBubble ? "text-accent-foreground/70" : "text-muted"
        }`}
        numberOfLines={1}
      >
        {who}：{text.slice(0, 120)}
      </Typography.Paragraph>
    </View>
  );
}
