import type { JSX } from "react";
import { View } from "react-native";

import RobotHeadDom from "@/components/RobotHeadDom";
import {
  avatarSeed01,
  deriveScreenColor,
  deriveTrimColor,
  presenceToRobotState,
  resolveAvatarColor,
  resolveAvatarShape,
  type BotPresenceStatus,
} from "@/lib/avatar";

/**
 * 助手头像 —— 对齐 Web `AgentAvatar`：robot-heads + presence 表情 + 在线绿点。
 *
 * 原生侧通过 Expo DOM（`'use dom'`）嵌入同一套 canvas 组件，避免再维护一套 SVG 剪影。
 */
export function AgentAvatar({
  id,
  name,
  size = 32,
  shape,
  color,
  status = "idle",
  searchingHint = false,
  online,
}: {
  id?: string;
  name: string;
  size?: number;
  shape?: string | null;
  color?: string | null;
  /** 产品五态；驱动 RobotHead 表情。 */
  status?: BotPresenceStatus | string;
  /** working → searching 动画提示（工具名像搜索时）。 */
  searchingHint?: boolean;
  /** 在线绿点（bot_online，与 presence 独立）。 */
  online?: boolean;
  /** @deprecated 已由 presence 表情替代；保留以免旧调用方类型报错。 */
  busy?: boolean;
}): JSX.Element {
  const seedKey = id || name;
  const bg = resolveAvatarColor(seedKey, color);
  const sh = resolveAvatarShape(seedKey, shape);
  const robotState = presenceToRobotState(status, searchingHint);
  const seed = avatarSeed01(seedKey);
  const small = size <= 32;
  const trimColor = deriveTrimColor(bg);
  const screenColor = deriveScreenColor(bg);
  const dot = Math.max(6, Math.min(8, Math.round(size * 0.22)));
  // 列表小头像 idle 时暂停动画，减轻多 WebView 开销；有 presence 仍播。
  const paused = robotState === "idle" && small;

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={name}>
      <RobotHeadDom
        shape={sh}
        state={robotState}
        size={size}
        color={bg}
        trimColor={trimColor}
        screenColor={screenColor}
        seed={seed}
        antenna={!small}
        floorShadow={!small}
        paused={paused}
        dom={{
          style: { width: size, height: size, backgroundColor: "transparent" },
          scrollEnabled: false,
          // 列表里大量头像时走 RN WebView，避免默认 dom-webview 额外依赖差异
          useExpoDOMWebView: false,
        }}
      />
      {online ? (
        <View
          accessibilityElementsHidden
          className="absolute rounded-full border border-background bg-success"
          style={{
            width: dot,
            height: dot,
            right: -1,
            bottom: -1,
            zIndex: 2,
          }}
        />
      ) : null}
    </View>
  );
}
