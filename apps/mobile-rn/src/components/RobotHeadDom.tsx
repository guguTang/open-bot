"use dom";

/**
 * Expo DOM 壳：在原生 WebView 里跑 Web 端同一套 `robot-heads`。
 * 仅接受可序列化 props；绿点等原生叠层在外层 AgentAvatar 画。
 */

import { RobotHead } from "robot-heads";
import type { DOMProps } from "expo/dom";

import type { AvatarShape, RobotHeadState } from "@/lib/avatar";

type Props = {
  shape: AvatarShape;
  state: RobotHeadState;
  size: number;
  color: string;
  trimColor: string;
  screenColor: string;
  seed: number;
  antenna: boolean;
  floorShadow: boolean;
  paused?: boolean;
  dom?: DOMProps;
};

export default function RobotHeadDom({
  shape,
  state,
  size,
  color,
  trimColor,
  screenColor,
  seed,
  antenna,
  floorShadow,
  paused = false,
}: Props) {
  return (
    <RobotHead
      shape={shape}
      state={state}
      size={size}
      color={color}
      trimColor={trimColor}
      screenColor={screenColor}
      seed={seed}
      antenna={antenna}
      floorShadow={floorShadow}
      interactive={false}
      paused={paused}
      aria-hidden
    />
  );
}
