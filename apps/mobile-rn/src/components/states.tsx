import { Alert, Button, Skeleton, Typography } from "heroui-native";
import type { JSX, ReactNode } from "react";
import { View } from "react-native";

import { Icon, type IconTone } from "@/components/Icon";

/**
 * 统一的错误展示。
 *
 * 原来是每个页面手搓 `<View className="rounded-2xl border border-danger">`，
 * 四份长得一模一样、还都缺一个图标和重试按钮。这里收敛成一处：
 * 危险色交给 `status`，图标交给 `Alert.Indicator`，重试是次级按钮。
 */
export function ErrorAlert({
  title,
  description,
  onRetry,
}: {
  /** 没有 description 时退化成单行形态 */
  title: string;
  description?: string | null;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <Alert status="danger" className={description ? undefined : "items-center"}>
      <Alert.Indicator className={description ? undefined : "pt-0"} />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {description ? <Alert.Description>{description}</Alert.Description> : null}
      </Alert.Content>
      {onRetry ? (
        <Button size="sm" variant="secondary" onPress={onRetry}>
          <Button.Label>重试</Button.Label>
        </Button>
      ) : null}
    </Alert>
  );
}

/**
 * 列表骨架屏。
 *
 * 加载时给一块和真实行**同尺寸**的灰块，比居中转圈更诚实：
 * 用户能提前看出这页会有几行长、内容大概多宽，
 * 而且内容落位时不会跳动。
 */
export function ListSkeleton({ rows = 4 }: { rows?: number }): JSX.Element {
  return (
    <View className="gap-3" accessibilityRole="progressbar" accessibilityLabel="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="flex-row items-center gap-3 px-1 py-2">
          <Skeleton className="size-10 rounded-full" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-4 rounded-md" />
            <Skeleton className="h-3 w-2/3 rounded-md" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * 聊天页骨架屏。
 *
 * 形状照着真实会话排：两轮一来一回，宽度还不一样。
 * 居中转圈会让消息落位时整页往下顶一截。
 */
export function MessageSkeleton(): JSX.Element {
  return (
    <View className="gap-4" accessibilityRole="progressbar" accessibilityLabel="加载中">
      <View className="flex-row justify-end">
        <Skeleton className="h-14 w-2/3 rounded-2xl" />
      </View>
      <View className="flex-row items-start gap-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
      </View>
      <View className="flex-row items-start gap-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-10 w-1/2 rounded-2xl" />
      </View>
      <View className="flex-row justify-end">
        <Skeleton className="h-12 w-1/2 rounded-2xl" />
      </View>
    </View>
  );
}

/**
 * 空态。
 *
 * 给了图标而不是纯文字 —— 但图标走 muted 色调，不跟品牌色抢注意力。
 * 提示语最多两行，超出就是没在说人话。
 */
export function EmptyState({
  title,
  hint,
  icon = "sparkles-outline",
  tone = "muted",
  action,
}: {
  title: string;
  hint?: string;
  icon?: Parameters<typeof Icon>[0]["name"];
  tone?: IconTone;
  action?: ReactNode;
}): JSX.Element {
  return (
    <View className="items-center gap-3 px-8 py-14">
      <View className="size-14 items-center justify-center rounded-full bg-surface-secondary">
        <Icon name={icon} size={26} tone={tone} />
      </View>

      <View className="gap-1.5">
        <Typography.Heading type="h4" className="text-center">
          {title}
        </Typography.Heading>
        {hint ? (
          <Typography.Paragraph color="muted" className="text-center text-sm">
            {hint}
          </Typography.Paragraph>
        ) : null}
      </View>

      {action}
    </View>
  );
}
