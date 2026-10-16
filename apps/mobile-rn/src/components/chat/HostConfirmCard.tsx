/**
 * 本机操作确认卡 — 审批三态。
 *
 * 对齐 Web 端 `apps/web/src/components/HostConfirmCard.tsx`：
 * 允许一次 / 始终允许 / 拒绝。email_send 不提供「始终允许」。
 *
 * 与 Web 的差异：组件内自己调 API（RN 侧闭合提交中/失败回滚），
 * 始终允许时写入本地 allowlist（AsyncStorage），审核页可撤销。
 */

import { Button, Chip, Typography, useThemeColor } from "heroui-native";
import { useCallback, useMemo, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";

import type { HostConfirmPayload, Message } from "@/api/types";
import { Icon } from "@/components/Icon";
import {
  isGitWriteRisk,
  parseHostConfirm,
  submitHostDecision,
  type ApprovalDecision,
} from "@/lib/hostApproval";
import { useSession } from "@/providers/session";

export { parseHostConfirm } from "@/lib/hostApproval";

type Props = {
  conversationId: string;
  message: Message;
  onDecided?: (updated: Message | null) => void;
  disabled?: boolean;
  /** When false (e.g. machine exec_policy=ask), hide Always — degrades to once-only. */
  alwaysAllowEnabled?: boolean;
};

function pathList(path: string): string[] {
  return path
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

type ActionCopy = { title: string; detail: string; danger: boolean };

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
  if (item.op === "screenshot") {
    const where = item.dest
      ? `显示器 ${item.dest}`
      : item.path === "all"
        ? "全部屏幕"
        : "主屏幕";
    return { title: "截取屏幕？", detail: where, danger: false };
  }
  if (item.op === "click") return { title: "点击界面？", detail: item.path, danger: false };
  if (item.op === "type") return { title: "向界面输入文字？", detail: item.path, danger: false };
  if (item.op === "key") return { title: "发送按键？", detail: item.path, danger: false };
  if (item.op === "scroll") return { title: "滚动界面？", detail: item.path, danger: false };
  if (item.op === "mouse_move") return { title: "移动鼠标？", detail: item.path, danger: false };
  if (item.op === "drag") return { title: "拖拽界面？", detail: item.path, danger: false };
  if (item.op === "email_send") {
    const attachLine = (item.preview || "")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s.startsWith("附件："));
    return {
      title: "发送这封邮件？",
      detail: [item.path && `收件人：${item.path}`, item.dest && `主题：${item.dest}`, attachLine]
        .filter(Boolean)
        .join("\n"),
      danger: false,
    };
  }
  return { title: "确认这次操作？", detail: item.path, danger: false };
}

const PREVIEW_OPS = new Set(["write", "shell", "ssh_write", "ssh_exec", "email_send", "type", "key"]);

export function HostConfirmCard({
  conversationId,
  message,
  onDecided,
  disabled,
  alwaysAllowEnabled = true,
}: Props): JSX.Element | null {
  const muted = useThemeColor("muted");
  const { user } = useSession();
  const payload = useMemo(() => parseHostConfirm(message), [message]);

  const [optimistic, setOptimistic] = useState<"allowed" | "denied" | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async (decision: ApprovalDecision) => {
      if (!payload || busy || disabled) return;
      const status = decision !== "deny" ? "allowed" : "denied";

      setBusy(true);
      setError(null);
      setOptimistic(status);
      setHint(null);

      const result = await submitHostDecision({
        conversationId,
        messageId: message.id,
        payload,
        decision,
        userId: user?.id || "",
      });

      if (result.error) {
        setOptimistic(null);
        setHint(null);
        setError(result.error);
        onDecided?.(null);
      } else {
        setHint(result.hint);
        onDecided?.(result.updated);
      }
      setBusy(false);
    },
    [busy, conversationId, disabled, message.id, onDecided, payload, user?.id]
  );

  if (!payload) return null;

  const { title, detail, danger } = actionCopy(payload);
  const settled =
    optimistic ??
    (payload.status === "allowed" || payload.status === "denied" ? payload.status : null);
  const pending = settled === null;
  const locked = Boolean(disabled) || busy || !pending;
  const allowAlways = alwaysAllowEnabled && payload.op !== "email_send";
  const gitWriteHint =
    allowAlways && isGitWriteRisk(payload.op, payload.path)
      ? "始终允许将覆盖同类 Git 写操作（含 push），请确认风险"
      : "";

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

      {gitWriteHint ? (
        <Typography.Paragraph className="text-xs text-danger">{gitWriteHint}</Typography.Paragraph>
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
        <View className="mt-1 gap-2">
          <Button
            size="sm"
            variant="primary"
            isDisabled={locked}
            onPress={() => void decide("allow_once")}
            accessibilityLabel="允许一次"
          >
            <Button.Label>{busy ? "提交中…" : "允许一次"}</Button.Label>
          </Button>
          <View className="flex-row gap-2">
            {allowAlways ? (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                isDisabled={locked}
                onPress={() => void decide("always_allow")}
                accessibilityLabel="始终允许"
              >
                <Button.Label>始终允许</Button.Label>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="danger"
              className="flex-1"
              isDisabled={locked}
              onPress={() => void decide("deny")}
              accessibilityLabel="拒绝这次操作"
            >
              <Button.Label>拒绝</Button.Label>
            </Button>
          </View>
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

      {hint ? (
        <Typography.Paragraph className="text-[11px]" style={{ color: muted }}>
          {hint}
        </Typography.Paragraph>
      ) : null}

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
