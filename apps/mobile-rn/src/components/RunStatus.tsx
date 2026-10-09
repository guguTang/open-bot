import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * 生成 / 思考中的动画指示器。
 *
 * 对齐 `apps/web/src/components/RunStatus.tsx` 的 OpenClaw 风格 blob：
 * 外层上下浮动 + 轻微旋转，两个圆点错峰呼吸。CSS 动画在 RN 上没有对应物，
 * 这里用 Reanimated 的 `withRepeat` + `withTiming` 复刻，参数直接照搬 keyframes。
 *
 * 颜色取主题的 `accent` 而不是写死的 `#e85d4c`：思考中不是错误，
 * 用红色是在语义色上撒谎；而且写死的主题色不跟明暗走。
 */
function Blob(): JSX.Element {
  const color = useThemeColor("accent");
  const wobble = useSharedValue(0);
  const pulseA = useSharedValue(0);
  const pulseB = useSharedValue(0);

  useEffect(() => {
    const loop = (duration: number) =>
      withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, true);
    wobble.value = loop(1400);
    pulseA.value = loop(1100);
    // B 圆点延迟 0.2s 起步，制造错峰感（CSS 里靠 animation-delay）
    pulseB.value = withDelay(200, loop(1100));
  }, [pulseA, pulseB, wobble]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * wobble.value }, { rotate: `${-2 + 5 * wobble.value}deg` }],
  }));

  const dotAStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.08 * pulseA.value }],
  }));

  const dotBStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.08 * pulseB.value }],
  }));

  return (
    <Animated.View style={[{ width: 28, height: 22 }, outerStyle]}>
      <Animated.View
        style={[
          dotAStyle,
          {
            position: "absolute",
            left: 0,
            top: 2,
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: color,
            opacity: 0.95,
          },
        ]}
      />
      <Animated.View
        style={[
          dotBStyle,
          {
            position: "absolute",
            right: 0,
            top: 3,
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: color,
            opacity: 0.75,
          },
        ]}
      />
    </Animated.View>
  );
}

/** `withDelay` 直接来自 reanimated，不需要额外封装。 */

export function RunStatus({ label }: { label: string }): JSX.Element {
  return (
    <View
      className="flex-row items-center gap-2.5 py-1"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Blob />
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
