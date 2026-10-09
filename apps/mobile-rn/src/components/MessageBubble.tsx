import { Typography } from "heroui-native";
import type { JSX } from "react";
import { useMemo } from "react";
import { Pressable, ScrollView, View } from "react-native";

import type { AttachmentMeta, HandoffPayload, HostConfirmPayload } from "@/api/types";
import { isImageAttachmentMime } from "@/api";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ArtifactCards } from "@/components/ArtifactCards";
import { Icon } from "@/components/Icon";
import { Markdown } from "@/components/Markdown";
import {
  HtmlDiagramCard,
  ImageDiagramCard,
  MermaidDiagramCard,
} from "@/components/chat/DiagramCards";
import { HandoffCard } from "@/components/chat/HandoffCard";
import { HostConfirmCard } from "@/components/chat/HostConfirmCard";
import { ReactionBar } from "@/components/chat/ReactionBar";
import { splitDiagrams } from "@/lib/chat";
import { formatSize } from "@/lib/format";
import { splitResultOriented } from "@/lib/workspace";

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
  /** 群聊才需要逐条标注发言者；单聊里助手名每条都一样，是纯噪音 */
  showAgentName?: boolean;
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
 * - 助手消息先过 `splitResultOriented` 抽出产物，再把清理过的正文交给 Markdown
 * - 群聊里按 `agent_id` 显示发言者归属
 *
 * 圆角：朝向头像/自己的那一角收小一档（`rounded-lg`），另一侧保持 `rounded-2xl`。
 * 两边同角会显得像一排没有指向的方块，收角之后气泡自然"贴"着它所属的那个头像。
 */
export function MessageBubble({
  message,
  fallbackAgentId,
  fallbackAgentName,
  showAgentName,
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

  // 流式内容每次 token 都变，解析结果必须跟着重算；但只在真的进 assistant 分支时算
  const split = useMemo(
    () => (isUser ? null : splitResultOriented(message.content)),
    [isUser, message.content]
  );

  const reactions = useMemo(
    () => (message.reactions ?? []).filter((r) => r.count > 0),
    [message.reactions]
  );
  const canInteract = !readonly && !message.streaming && !message.id.startsWith("local-");

  /**
   * 正文按「文字 / 图表」切段后逐段渲染，保持助手写出来的原始顺序。
   * 全部堆到末尾会让图和解释它的文字脱节，所以不能图省事只渲染一遍 Markdown。
   */
  const segments = useMemo(
    () => (isUser || !split ? [] : splitDiagrams(split.display)),
    [isUser, split]
  );

  if (isUser) {
    return (
      <View className="flex-row justify-end">
        <View className="max-w-[85%] gap-1.5">
          {quoted ? <QuoteBlock quoted={quoted} /> : null}
          <Pressable
            onLongPress={canInteract ? onLongPress : undefined}
            delayLongPress={400}
            className="gap-1.5 rounded-2xl rounded-br-lg bg-accent px-4 py-3"
          >
            {message.attachments?.length ? <AttachmentChips items={message.attachments} /> : null}
            {message.content ? (
              <Typography.Paragraph selectable className="text-accent-foreground">
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
  const agentName = showAgentName
    ? message.agent_name || fallbackAgentName
    : message.agent_name || undefined;

  return (
    <View className="flex-row items-start gap-2">
      <AgentAvatar id={agentId} name={agentName || "AI"} size={28} />

      <View className="max-w-[85%] gap-1.5">
        {agentName ? (
          <Typography.Paragraph color="muted" className="px-1 text-[11px]">
            {agentName}
          </Typography.Paragraph>
        ) : null}

        <Pressable
          onLongPress={canInteract ? onLongPress : undefined}
          delayLongPress={400}
          className="gap-2 rounded-2xl rounded-tl-lg bg-surface-secondary px-4 py-3"
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
              {message.streaming ? (
                <Markdown
                  content={split?.display.trim() ?? ""}
                  streaming
                  {...(onSandboxLink ? { onLinkPress: onSandboxLink } : {})}
                />
              ) : (
                segments.map((seg, i) => {
                  if (seg.kind === "diagram") {
                    return seg.lang === "mermaid" ? (
                      <MermaidDiagramCard key={`d${i}`} source={seg.source} pending={seg.pending} />
                    ) : (
                      <HtmlDiagramCard key={`d${i}`} source={seg.source} pending={seg.pending} />
                    );
                  }
                  const body = seg.text.trim();
                  return body ? (
                    <Markdown
                      key={`t${i}`}
                      content={body}
                      {...(onSandboxLink ? { onLinkPress: onSandboxLink } : {})}
                    />
                  ) : null;
                })
              )}

              {/* 流式过程中不显示产物卡片：正文还没稳定，反复抽取会闪 */}
              {!message.streaming &&
              split &&
              (split.artifacts.length > 0 || split.collapsedJson.length > 0) ? (
                <ArtifactCards
                  artifacts={split.artifacts}
                  collapsedJson={split.collapsedJson}
                  {...(agentId ? { agentId } : {})}
                />
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

/** 引用块：谁说的 + 摘要，样式对齐 Web 端 ChatMessage 的 quote。 */
function QuoteBlock({ quoted }: { quoted: UiMessage }): JSX.Element {
  const who = quoted.role === "user" ? "你" : quoted.agent_name || "助手";
  return (
    <View className="gap-0.5 rounded-xl bg-background/40 px-2.5 py-1.5">
      <Typography.Paragraph className="text-[10px] text-muted">{who}</Typography.Paragraph>
      <Typography.Paragraph className="text-xs" numberOfLines={2}>
        {quoted.content.replace(/\s+/g, " ").slice(0, 120)}
      </Typography.Paragraph>
    </View>
  );
}
