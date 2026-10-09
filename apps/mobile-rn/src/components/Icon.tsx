// 只引 Ionicons 这一个子模块。`@expo/vector-icons` 的根入口会 re-export 全部
// 8 个字体族，光是把它们打进 bundle 就是 4MB+ 的 .ttf，装机体积不划算。
import Ionicons from "@expo/vector-icons/Ionicons";
import { useThemeColor } from "heroui-native";
import type { ComponentProps, JSX } from "react";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

/**
 * 语义色名。图标不允许写死颜色 —— 写死了就不跟明暗主题走，
 * 这正是原来 `✕` / `›` / `＋` 直接用文本字符当图标时踩的坑：
 * 既没有语义色，也没有正确的触控面积。
 */
export type IconTone =
  | "foreground"
  | "muted"
  | "accent"
  | "accent-foreground"
  | "accent-soft-foreground"
  | "danger"
  | "danger-foreground"
  | "danger-soft-foreground"
  | "success"
  | "success-foreground"
  | "success-soft-foreground"
  | "warning"
  | "warning-foreground"
  | "warning-soft-foreground"
  | "default-foreground"
  | "surface-foreground";

/**
 * Ionicons 的薄封装。
 *
 * 存在的理由只有一个：把「图标 + 语义色 + 触控面积」绑在一起，
 * 让调用点没法顺手写出一个 16px 的裸字符当图标。
 *
 * 尺寸默认 20，与 ListGroup.ItemSuffix 内置的 chevron（16）
 * 和 ListGroup.ItemPrefix 的行高（44）形成清晰的层级差。
 */
export function Icon({
  name,
  size = 20,
  tone = "foreground",
  ...rest
}: {
  name: IoniconName;
  size?: number;
  tone?: IconTone;
} & Omit<ComponentProps<typeof Ionicons>, "name" | "size" | "color">): JSX.Element {
  const color = useThemeColor(tone);
  return <Ionicons name={name} size={size} color={color} {...rest} />;
}