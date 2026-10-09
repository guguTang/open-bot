import { Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { avatarColor, avatarForeground, avatarInitials } from "@/lib/format";

/**
 * 助手头像。
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
}: {
  id?: string;
  name: string;
  size?: number;
}): JSX.Element {
  const bg = avatarColor(id || name);

  return (
    <View
      accessibilityElementsHidden
      className="border border-border-secondary"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Typography.Paragraph
        style={{
          color: avatarForeground(bg),
          fontSize: Math.max(10, Math.round(size * 0.38)),
        }}
      >
        {avatarInitials(name)}
      </Typography.Paragraph>
    </View>
  );
}