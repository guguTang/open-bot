import { Typography } from "heroui-native";
import type { JSX } from "react";
import { useMemo } from "react";
import { ScrollView, View } from "react-native";

import type { AttachmentMeta } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ArtifactCards } from "@/components/ArtifactCards";
import { Markdown } from "@/components/Markdown";
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
}: {
  message: UiMessage;
  /** 消息没带 agent_id 时回落到会话所属助手 */
  fallbackAgentId?: string;
  fallbackAgentName?: string;
  /** 群聊才需要逐条标注发言者；单聊里助手名每条都一样，是纯噪音 */
  showAgentName?: boolean;
  /** `sandbox:` 链接点击回调；不传则用系统浏览器打开 */
  onSandboxLink?: (path: string) => void;
}): JSX.Element {
  const isUser = message.role === "user";
  const isSummary = message.role === "summary";

  // 流式内容每次 token 都变，解析结果必须跟着重算；但只在真的进 assistant 分支时算
  const split = useMemo(
    () => (isUser ? null : splitResultOriented(message.content)),
    [isUser, message.content]
  );

  if (isUser) {
    return (
      <View className="flex-row justify-end">
        <View className="max-w-[85%] gap-1.5 rounded-2xl rounded-br-lg bg-accent px-4 py-3">
          {message.attachments?.length ? <AttachmentChips items={message.attachments} /> : null}
          {message.content ? (
            <Typography.Paragraph selectable className="text-accent-foreground">
              {message.content}
            </Typography.Paragraph>
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

        <View className="gap-2 rounded-2xl rounded-tl-lg bg-surface-secondary px-4 py-3">
          {isSummary ? (
            <Typography.Paragraph className="text-[11px] text-muted">摘要</Typography.Paragraph>
          ) : null}

          <Markdown
            content={split?.display.trim() ?? ""}
            streaming={message.streaming}
            {...(onSandboxLink ? { onLinkPress: onSandboxLink } : {})}
          />

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
        </View>
      </View>
    </View>
  );
}