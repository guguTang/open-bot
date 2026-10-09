import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";
import Svg, { Ellipse, G, Path } from "react-native-svg";

import { AVATAR_BODY_PATHS, AVATAR_EYE, normalizeColor, normalizeShape } from "@/lib/avatar";
import { avatarColor, avatarForeground, avatarInitials } from "@/lib/format";

/**
 * 助手头像。
 *
 * 三种形态，按优先级：
 * 1. 用户设过形象（`avatar_shape`）→ 用 SVG 画 v2 剪影，底色取 `avatar_color`
 * 2. 没设形状但设了颜色 → 圆形底色 + 姓名首字
 * 3. 都没设 → 按 id 哈希取色 + 首字（与 Web 端 `avatarColor.ts` 同一套算法）
 *
 * 取色算法来自 `apps/web/src/components/avatarColor.ts`，与 Web 端共用同一套
 * 哈希 → 调色板映射，所以同一个助手在桌面和手机上是同一个颜色。
 * 这里没用 heroui 的 `Avatar`，因为它只接受语义色（accent/success/…），
 * 无法承载按 id 确定的十六进制底色。
 *
 * 调色板里有几个高饱和度成员（#00bbf9 / #00f5d4 / #fee440），
 * 在浅色背景上边缘发虚，所以压一圈 `border-border-secondary` 收边 ——
 * 该 token 是 surface 与 foreground 的混合，明暗两套都成立。
 */
export function AgentAvatar({
  id,
  name,
  size = 32,
  shape,
  color,
  online,
  busy,
}: {
  id?: string;
  name: string;
  size?: number;
  /** v2 剪影 id；不传或非法值走哈希兜底 */
  shape?: string | null;
  /** 12 色板内的 #rrggbb；不传或不在色板内走哈希兜底 */
  color?: string | null;
  /** 在线绿点（bot_online，与 presence 独立） */
  online?: boolean;
  /** 有 run 在飞：右上角小转圈 */
  busy?: boolean;
}): JSX.Element {
  const resolvedShape = normalizeShape(shape);
  const resolvedColor = normalizeColor(color) ?? avatarColor(id || name);
  const dot = Math.max(8, Math.round(size * 0.28));

  return (
    <View style={{ width: size, height: size }}>
      <View
        accessibilityElementsHidden
        className="border border-border-secondary"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: resolvedColor,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {resolvedShape ? (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Path d={AVATAR_BODY_PATHS[resolvedShape]} fill={resolvedColor} />
            <G>
              <Ellipse
                cx={AVATAR_EYE.left.cx}
                cy={AVATAR_EYE.left.cy}
                rx={AVATAR_EYE.left.rx}
                ry={AVATAR_EYE.left.ry}
                fill="#ffffff"
                origin={`${AVATAR_EYE.left.cx}, ${AVATAR_EYE.left.cy}`}
                rotation={AVATAR_EYE.left.rotate}
              />
              <Ellipse
                cx={AVATAR_EYE.right.cx}
                cy={AVATAR_EYE.right.cy}
                rx={AVATAR_EYE.right.rx}
                ry={AVATAR_EYE.right.ry}
                fill="#ffffff"
                origin={`${AVATAR_EYE.right.cx}, ${AVATAR_EYE.right.cy}`}
                rotation={AVATAR_EYE.right.rotate}
              />
            </G>
          </Svg>
        ) : (
          <Typography.Paragraph
            style={{
              color: avatarForeground(resolvedColor),
              fontSize: Math.max(10, Math.round(size * 0.38)),
            }}
          >
            {avatarInitials(name)}
          </Typography.Paragraph>
        )}
      </View>

      {online ? (
        <View
          accessibilityElementsHidden
          className="absolute rounded-full border border-border-secondary bg-success"
          style={{
            width: dot,
            height: dot,
            right: -1,
            bottom: -1,
          }}
        />
      ) : null}

      {busy && !online ? (
        <View
          accessibilityElementsHidden
          className="absolute rounded-full border border-border-secondary bg-accent"
          style={{
            width: dot,
            height: dot,
            right: -1,
            bottom: -1,
          }}
        />
      ) : null}
    </View>
  );
}
