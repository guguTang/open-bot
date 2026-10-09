/**
 * 本机操作确认卡。
 *
 * 对齐 Web 端 `apps/web/src/components/HostConfirmCard.tsx`：一次本机文件/命令操作
 * 排队等用户批准，卡上把 op / path / dest / preview / reason / review_tier 摊开给用户看，
 * 然后只剩「允许 / 拒绝」两个动作。
 *
 * 与 Web 端的两处差异，都是 RN 侧的实际约束而不是随意改动：
 * - **组件内自己调 API**。Web 端把 `onDecide` 抛给聊天页，由聊天页统一处理 pending /
 *   报错 / 消息回写；这里为了能把「提交中禁用 → 失败回滚 → 已处理」这条链路闭合，
 *   把 `decideHostConfirm` 收在组件内，最终结果再通过 `onDecided` 交回聊天页。
 * - **拒绝按钮用 danger 样式**，允许是 primary。危险与否由文案自己说清楚（见 `actionCopy`），
 *   不再像 Web 端那样把 danger 穿到「允许」上 —— 那在手机上极易误点。
 */

import { Button, Chip, Typography, useThemeColor } from "heroui-native";
import { useCallback, useMemo, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";

import { decideHostConfirm } from "@/api";
import type { HostConfirmPayload, Message } from "@/api/types";
import { Icon } from "@/components/Icon";

type Props = {
  conversationId: string;
  /** 卡片数据优先取 `message.host_confirm`，没有再退回解析 `message.content` */
  message: Message;
  /** 提交成功带上服务端返回的最新消息；提交失败传 null（卡片自己也会显示失败原因） */
  onDecided?: (updated: Message | null) => void;
  /** 历史消息、只读会话等不可操作场景 */
  disabled?: boolean;
};

/** 与 Web 端 `parseHostConfirm` 同思路：优先用结构化字段，否则试一次 JSON。 */
export function parseHostConfirm(message: Message): HostConfirmPayload | null {
  if (message.host_confirm?.op) return message.host_confirm;
  try {
    const data = JSON.parse(message.content) as HostConfirmPayload;
    if (data?.req_id && data.op) return data;
  } catch {
    /* 不是确认载荷，按普通消息处理 */
  }
  return null;
}

function pathList(path: string): string[] {
  return path
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

type ActionCopy = { title: string; detail: string; danger: boolean };

/** 按 op 生成一句人话。path 可能是多行（批量删除），标题要把数量说出来。 */
function actionCopy(item: HostConfirmPayload): ActionCopy {
  if (item.op === "shell") {
    return {
      title: item.dest === "terminal" ? "在终端里运行？" : "运行这条命令？",
      detail: item.path,
      danger: true,
    };
  }
  if (item.op === "ssh_exec") {
    return {
      title: "在远程主机上运行？",
      detail: item.dest ? `${item.dest}\n${item.path}` : item.path,
      danger: true,
    };
  }
  if (item.op === "ssh_delete") {
    const n = pathList(item.path).length;
    return {
      title: n > 1 ? `删除这 ${n} 个远程文件？` : "删除远程文件？",
      detail: item.dest ? `${item.dest}\n${item.path}` : item.path,
      danger: true,
    };
  }
  if (item.op === "ssh_write") {
    return {
      title: "写入远程文件？",
      detail: item.dest ? `${item.dest} ${item.path}` : item.path,
      danger: false,
    };
  }
  if (item.op === "write") return { title: "写入这个文件？", detail: item.path, danger: false };
  if (item.op === "delete") {
    const n = pathList(item.path).length;
    return {
      title: n > 1 ? `删除这 ${n} 个文件？` : "删除这个文件？",
      detail: item.path,
      danger: true,
    };
  }
  if (item.op === "move") {
    return {
      title: "移动或重命名？",
      detail: item.dest ? `${item.path} → ${item.dest}` : item.path,
      danger: true,
    };
  }
  return { title: "确认这次操作？", detail: item.path, danger: false };
}

/** 会展示 preview 的 op：写文件 / 跑命令这类，改动内容本身就是要审的东西。 */
const PREVIEW_OPS = new Set(["write", "shell", "ssh_write", "ssh_exec"]);

export function HostConfirmCard({
  conversationId,
  message,
  onDecided,
  disabled,
}: Props): JSX.Element | null {
  const muted = useThemeColor("muted");
  const payload = useMemo(() => parseHostConfirm(message), [message]);

  // 乐观值：点完立刻变「已处理」，不等网络。失败时清掉并回到可重试状态。
  const [optimistic, setOptimistic] = useState<"allowed" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (status: "allowed" | "denied") => {
      if (!payload || busy || disabled) return;
      setBusy(true);
      setError(null);
      setOptimistic(status);
      try {
        const updated = await decideHostConfirm(conversationId, message.id, status);
        onDecided?.(updated);
      } catch (err) {
        // 卡片状态以服务端为准：回滚乐观值，让用户能再点一次
        setOptimistic(null);
        const msg = err instanceof Error ? err.message : "提交失败，请重试";
        setError(msg);
        onDecided?.(null);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, disabled, message.id, onDecided, payload]
  );

  if (!payload) return null;

  const { title, detail, danger } = actionCopy(payload);
  const settled =
    optimistic ??
    (payload.status === "allowed" || payload.status === "denied" ? payload.status : null);
  const pending = settled === null;
  const locked = Boolean(disabled) || busy || !pending;

  return (
    <View
      className="gap-2 rounded-2xl border border-warning bg-warning-soft p-3"
      accessibilityRole="summary"
      accessibilityLabel={title}
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          <Icon name="shield-checkmark-outline" size={14} tone="warning" />
          <Typography.Paragraph className="text-[11px] text-warning-soft-foreground">
            {payload.review_tier ? `需要你确认 · ${payload.review_tier}` : "需要你确认"}
          </Typography.Paragraph>
        </View>
        {danger ? (
          <Chip size="sm" variant="soft" color="danger">
            <Chip.Label>高风险</Chip.Label>
          </Chip>
        ) : null}
      </View>

      <Typography.Heading type="h6">{title}</Typography.Heading>

      {payload.reason ? (
        <Typography.Paragraph className="text-xs text-warning-soft-foreground">
          {payload.reason}
        </Typography.Paragraph>
      ) : null}

      {detail ? (
        <View className="rounded-lg bg-background px-2.5 py-2">
          <ScrollView nestedScrollEnabled>
            <Typography.Paragraph
              selectable
              className="text-xs"
              style={{ fontFamily: "Menlo", lineHeight: 18 }}
            >
              {detail}
            </Typography.Paragraph>
          </ScrollView>
        </View>
      ) : null}

      {payload.preview && PREVIEW_OPS.has(payload.op) ? (
        <View className="rounded-lg bg-background px-2.5 py-2">
          <ScrollView nestedScrollEnabled className="max-h-40">
            <Typography.Paragraph
              selectable
              className="text-[11px]"
              style={{ fontFamily: "Menlo", lineHeight: 16 }}
            >
              {payload.preview}
            </Typography.Paragraph>
          </ScrollView>
        </View>
      ) : null}

      {pending ? (
        <View className="mt-1 flex-row gap-2">
          <Button
            size="sm"
            variant="danger"
            className="flex-1"
            isDisabled={locked}
            onPress={() => void decide("denied")}
            accessibilityLabel="拒绝这次操作"
          >
            <Button.Label>拒绝</Button.Label>
          </Button>
          <Button
            size="sm"
            variant="primary"
            className="flex-1"
            isDisabled={locked}
            onPress={() => void decide("allowed")}
            accessibilityLabel="允许这次操作"
          >
            <Button.Label>{busy ? "提交中…" : "允许"}</Button.Label>
          </Button>
        </View>
      ) : (
        <View className="mt-1 flex-row items-center gap-1.5">
          <Icon
            name={settled === "allowed" ? "checkmark-circle" : "close-circle"}
            size={16}
            tone={settled === "allowed" ? "success" : "danger"}
          />
          <Typography.Paragraph
            className={settled === "allowed" ? "text-xs text-success" : "text-xs text-danger"}
          >
            {settled === "allowed" ? "已允许" : "已拒绝"}
          </Typography.Paragraph>
        </View>
      )}

      {error ? (
        <Typography.Paragraph className="text-[11px] text-danger">{error}</Typography.Paragraph>
      ) : null}

      {!pending && !error ? (
        <Typography.Paragraph className="text-[10px]" style={{ color: muted }}>
          该操作已结束，卡片不可再操作
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
