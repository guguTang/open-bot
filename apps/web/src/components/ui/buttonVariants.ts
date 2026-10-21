import { buttonVariants as heroButtonVariants } from "@heroui/styles";

/**
 * 旧 shadcn 风格的 variant/size 名称 → HeroUI Button 的 BEM 类（button / button--primary …）。
 * 只给不能直接用 <Button> 的场景（asChild、Radix Action 等）拿 class 用。
 */
export type LegacyButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
export type LegacyButtonSize = "default" | "sm" | "lg" | "icon";

export const heroVariant = {
  default: "primary",
  destructive: "danger",
  outline: "outline",
  secondary: "secondary",
  ghost: "ghost",
  link: "ghost",
} as const;

export const heroSize = { default: "md", sm: "sm", lg: "lg", icon: "md" } as const;

export function buttonVariants(opts: { variant?: LegacyButtonVariant | null; size?: LegacyButtonSize | null } = {}): string {
  const variant = heroVariant[opts.variant ?? "default"];
  const size = heroSize[opts.size ?? "default"];
  return heroButtonVariants({ variant, size, isIconOnly: opts.size === "icon" });
}
