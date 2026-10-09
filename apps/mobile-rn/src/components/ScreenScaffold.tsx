import { Button, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX, ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { Icon } from "@/components/Icon";
import { ErrorAlert, ListSkeleton } from "@/components/states";

/**
 * 全局统一的自绘顶部栏。RN 没有浏览器导航，所以每屏都要自己让开状态栏。
 *
 * 层级：左侧返回（次要、图标化）→ 标题（primary）→ 右侧动作。
 * 分隔线用 `border-border` 而不是 `border-separator`：
 * 后者是实打实的重分隔线（浅色模式下接近 74% 灰），
 * 拿来当发丝边用会让整个 App 看起来像被灰线划满了。
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}): JSX.Element {
  const router = useRouter();

  return (
    /* pt-safe-offset-* 由 HeroUINativeProvider 里的 SafeAreaListener 自动同步给
       uniwind（provider.js 里调 Uniwind.updateInsets），所以安全区不需要
       useSafeAreaInsets + style 手动算，也顺带省掉一次 inset 变化的重渲染。 */
    <View className="flex-row items-center gap-2 border-b border-border bg-background px-3 pt-safe-offset-10 pb-3">
      <Button
        isIconOnly
        variant="ghost"
        onPress={() => (onBack ? onBack() : router.back())}
        accessibilityLabel="返回"
      >
        <Icon name="chevron-back" size={24} tone="foreground" />
      </Button>

      <View className="flex-1">
        <Typography.Heading type="h3" numberOfLines={1}>
          {title}
        </Typography.Heading>
        {subtitle ? (
          <Typography.Paragraph color="muted" className="text-sm" numberOfLines={1}>
            {subtitle}
          </Typography.Paragraph>
        ) : null}
      </View>

      {right ? <View className="flex-row items-center gap-1">{right}</View> : null}
    </View>
  );
}

type ScaffoldProps = {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /** 骨架屏行数，与真实列表的行数接近 */
  skeletonRows?: number;
  /**
   * 空态内容，渲染在 children 之前。
   * 「列表 + 尾部创建表单」的结构下两者需要共存，所以默认是叠加而非互斥；
   * 整页就是空态时传 `emptyOnly`。
   */
  empty?: ReactNode;
  /** 为 true 时只渲染 empty，不渲染 children */
  emptyOnly?: boolean;
  children: ReactNode;
  /** 底部固定操作区（如「新建」按钮），留出安全区 */
  footer?: ReactNode;
  onRetry?: () => void;
};

/**
 * 设置页骨架：顶部栏 + 滚动区 + 统一的 loading / error / empty 状态。
 *
 * 所有设置子页都套这一层，保证 8 个页面的空态和错误态长得一样 ——
 * 否则每个页面各写一遍 `if (loading) return <Spinner/>`，很快就会走样。
 */
export function ScreenScaffold({
  title,
  subtitle,
  headerRight,
  loading,
  error,
  skeletonRows = 5,
  empty,
  emptyOnly,
  children,
  footer,
  onRetry,
}: ScaffoldProps): JSX.Element {
  const hasError = Boolean(error);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={title} subtitle={subtitle} right={headerRight} />

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 px-5 pt-6 pb-6"
        keyboardShouldPersistTaps="handled"
      >
        {loading ? <ListSkeleton rows={skeletonRows} /> : null}

        {!loading && hasError ? (
          <ErrorAlert title="加载失败" description={error} {...(onRetry ? { onRetry } : {})} />
        ) : null}

        {!loading && !hasError && empty ? <>{empty}</> : null}

        {!loading && !hasError && !emptyOnly ? children : null}
      </ScrollView>

      {footer ? (
        <View className="border-t border-border bg-background px-5 pt-3 pb-safe-offset-12">
          {footer}
        </View>
      ) : null}
    </View>
  );
}