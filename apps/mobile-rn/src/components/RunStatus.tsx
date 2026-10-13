import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { AgentAvatar } from "@/components/AgentAvatar";
import type { BotPresenceStatus } from "@/lib/avatar";

type Props = {
  label: string;
  agentId?: string;
  agentName?: string;
  shape?: string | null;
  avatarColor?: string | null;
  /** 产品五态；驱动 RobotHead（与 Web RunStatus 一致）。 */
  status?: BotPresenceStatus | string;
  searchingHint?: boolean;
};

/**
 * 思考 / 工具中指示 —— 用动态 RobotHead，不再用独立 blob 动画。
 * 对齐 `apps/web/src/components/RunStatus.tsx`。
 */
export function RunStatus({
  label,
  agentId,
  agentName = "助手",
  shape,
  avatarColor,
  status = "thinking",
  searchingHint = false,
}: Props): JSX.Element {
  return (
    <View
      className="flex-row items-center gap-2.5 py-1"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <AgentAvatar
        id={agentId}
        name={agentName}
        size={28}
        shape={shape}
        color={avatarColor}
        status={status}
        searchingHint={searchingHint}
      />
      <Typography.Paragraph color="muted" style={{ fontSize: 13.5 }}>
        {label}
      </Typography.Paragraph>
    </View>
  );
}

/**
 * 从 SSE `status` 事件推导展示文案。与 Web 端 `onStatus` 分支保持一致：
 * 优先用后端给的 label，tool 阶段把工具名拼上去，没有 label 时按 phase 兜底。
 */
export function deriveRunLabel(
  data: { phase?: string; label?: string; tool?: string },
  current: string
): string {
  const phase = String(data.phase || "");
  const tool = typeof data.tool === "string" ? data.tool : "";
  if (typeof data.label === "string" && data.label.trim()) {
    return phase === "tool" && tool ? `${data.label} · ${tool}` : data.label;
  }
  if (phase === "tool") {
    return tool ? `正在运行命令 · ${tool}` : "正在运行命令";
  }
  if (phase === "thinking" || phase === "tool_done") {
    return "正在思考…";
  }
  return current;
}
