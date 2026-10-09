/**
 * Bot 交接卡。
 *
 * 对齐 Web 端 `apps/web/src/components/HandoffCard.tsx`：`from_bot → to_bot` 的路由 +
 * 交接目的 + 五种状态（进行中 / 完成 / 失败 / 被拒 / 待批准）。
 *
 * Web 端还有一个 `contentFallback`（老消息 handoff 字段为空、只在 content 里存了 JSON）。
 * 移动端把这个兜底拆成导出的 `parseHandoff`，由聊天页决定要不要用 —— 卡片本身只认
 * 已经解析好的 payload，职责边界更干净。
 */

import { Chip, Typography, useThemeColor } from "heroui-native";
import { useCallback, useState, type JSX } from "react";
import { Pressable, View } from "react-native";

import type { HandoffPayload } from "@/api/types";
import { Icon, type IconTone } from "@/components/Icon";

type StatusMeta = {
  label: string;
  tone: IconTone;
  icon: Parameters<typeof Icon>[0]["name"];
  /** Chip 的色板：交接是流程事件，不是错误提示 */
  chip: "accent" | "success" | "warning" | "danger" | "default";
};

const STATUS_META: Record<string, StatusMeta> = {
  running: { label: "进行中", tone: "accent", icon: "sync", chip: "accent" },
  done: { label: "完成", tone: "success", icon: "checkmark-circle", chip: "success" },
  failed: { label: "失败", tone: "danger", icon: "alert-circle", chip: "danger" },
  rejected: { label: "被拒", tone: "danger", icon: "close-circle", chip: "danger" },
  awaiting_approval: { label: "待批准", tone: "warning", icon: "help-circle", chip: "warning" },
};

/** 老消息可能没带 handoff 字段，只在 content 里存了一份 JSON。与 Web 端同思路。 */
export function parseHandoff(content: string | undefined | null): HandoffPayload | null {
  if (!content) return null;
  try {
    const j = JSON.parse(content) as HandoffPayload;
    if (j && typeof j.from_bot === "string" && typeof j.to_bot === "string") return j;
  } catch {
    /* 不是交接载荷 */
  }
  return null;
}

export function HandoffCard({
  payload,
  onOpenDetail,
}: {
  payload: HandoffPayload;
  /** 展开详情时通知外部（聊天页可据此跳到交接产生的那条消息） */
  onOpenDetail?: (payload: HandoffPayload) => void;
}): JSX.Element {
  const muted = useThemeColor("muted");
  const [open, setOpen] = useState(false);

  const status = payload.status || "running";
  const meta = STATUS_META[status] ?? {
    // 服务端加新状态时别整张卡崩掉：原样显示状态串，归到中性色
    label: status,
    tone: "muted" as IconTone,
    icon: "swap-horizontal" as Parameters<typeof Icon>[0]["name"],
    chip: "default" as const,
  };

  const toggle = useCallback(() => {
    setOpen((v) => !v);
    if (!open) onOpenDetail?.(payload);
  }, [onOpenDetail, open, payload]);

  return (
    <View className="gap-2 rounded-2xl border border-border bg-background p-3">
      <View className="flex-row items-center justify-between gap-2">
        <Chip size="sm" variant="soft" color="default">
          <Chip.Label>交接</Chip.Label>
        </Chip>
        <View className="flex-row items-center gap-1">
          <Icon name={meta.icon} size={14} tone={meta.tone} />
          <Chip size="sm" variant="soft" color={meta.chip}>
            <Chip.Label>{meta.label}</Chip.Label>
          </Chip>
        </View>
      </View>

      <View className="flex-row items-center gap-2">
        <Typography.Paragraph className="text-sm" numberOfLines={1}>
          {payload.from_bot || "?"}
        </Typography.Paragraph>
        <Icon name="arrow-forward" size={14} tone="muted" />
        <Typography.Paragraph className="text-sm" numberOfLines={1}>
          {payload.to_bot || "?"}
        </Typography.Paragraph>
      </View>

      {payload.purpose ? (
        <Typography.Paragraph color="muted" className="text-xs">
          {payload.purpose}
        </Typography.Paragraph>
      ) : null}

      {payload.agent_message_id ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? "收起交接详情" : "查看交接详情"}
          onPress={toggle}
          className="flex-row items-center gap-1 self-start py-0.5"
        >
          <Typography.Paragraph className="text-[11px] text-accent">
            {open ? "收起详情" : "查看详情"}
          </Typography.Paragraph>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={12} tone="accent" />
        </Pressable>
      ) : null}

      {open && payload.agent_message_id ? (
        <View className="gap-0.5 rounded-lg bg-surface-secondary px-2.5 py-2">
          {[
            `agent_message_id: ${payload.agent_message_id}`,
            `status: ${status}`,
            `from: ${payload.from_bot || "?"}`,
            `to: ${payload.to_bot || "?"}`,
          ].map((line) => (
            <Typography.Paragraph
              key={line}
              selectable
              className="text-[11px]"
              style={{ color: muted, fontFamily: "Menlo", lineHeight: 16 }}
            >
              {line}
            </Typography.Paragraph>
          ))}
        </View>
      ) : null}
    </View>
  );
}
