/**
 * 助手形象 v2：有机剪影 + 正式色板。
 *
 * 数据逐字取自 `apps/web/src/components/avatarColor.ts` 与 `avatarShapes.ts`，
 * 同一个助手在桌面和手机上必须是同一个形状和同一个颜色，所以这里不复用
 * `lib/format.ts` 里那套「按 id 哈希取色」的兜底算法 —— 那是**没设置形象**时的退路，
 * 不是用户选定的形象。
 */

/** 正式色板（v2 锁定，12 色）。 */
export const AVATAR_COLOR_PALETTE = [
  "#e85d4c",
  "#2a9d8f",
  "#f4a261",
  "#e76f51",
  "#457b9d",
  "#9b5de5",
  "#00bbf9",
  "#f15bb5",
  "#00f5d4",
  "#fee440",
  "#06d6a0",
  "#118ab2",
] as const;

/** 正式形状（viewBox 0 0 32 32）。 */
export const AVATAR_SHAPES = ["cloud", "bean", "drop", "soft-hex", "petal", "puff"] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = string;

/** 剪影本体路径，取自设计包 v2.1。 */
export const AVATAR_BODY_PATHS: Record<AvatarShape, string> = {
  cloud:
    "M7 17.5 C4.8 17.5 3.2 15.8 3.2 13.8 C3.2 12.1 4.4 10.7 6.1 10.3 C6.6 7.9 8.9 6.2 11.6 6.2 C12.9 6.2 14.1 6.6 15 7.4 C16.1 5.5 18.5 4.3 21.2 4.3 C24.8 4.3 27.6 7.1 27.6 10.5 C27.6 10.9 27.55 11.25 27.45 11.6 C29.2 12.3 30.4 14.1 30.4 16.2 C30.4 18.7 28.3 20.7 25.7 20.7 C24.9 20.7 24.15 20.5 23.5 20.2 C22.3 22.1 19.7 23.4 16.6 23.4 C14.2 23.4 12.05 22.6 10.6 21.4 C9.85 22.15 8.7 22.6 7.4 22.6 C5.55 22.6 4.1 21.2 4.1 19.4 C4.1 18.3 4.7 17.35 5.6 16.85 C6.05 17.25 6.5 17.5 7 17.5Z",
  bean: "M5.5 16c0-5.0 4.0-9.0 10.5-9.0 4.6 0 7.6 2.0 9.2 4.2 1.3 1.8 2.0 3.8 2.0 5.0 0 4.9-4.1 8.8-10.2 8.8-3.5 0-6.4-1.4-8.1-3.6C6.6 19.6 5.5 17.8 5.5 16z",
  drop: "M16 5.2c6.2 6.4 9.5 10.6 9.5 14.6 0 5-4.1 8.5-9.5 8.5S6.5 24.8 6.5 19.8c0-4 3.3-8.2 9.5-14.6z",
  "soft-hex":
    "M16 4.2c.7 0 1.4.2 2 .6l6.2 3.7c1.2.7 2 2 2 3.4v7.2c0 1.4-.8 2.7-2 3.4l-6.2 3.7c-.6.4-1.3.6-2 .6s-1.4-.2-2-.6l-6.2-3.7c-1.2-.7-2-2-2-3.4v-7.2c0-1.4.8-2.7 2-3.4L14 4.8c.6-.4 1.3-.6 2-.6z",
  petal:
    "M16.8 5.5c4.8 1.8 8.7 6.2 9.2 11.4.4 4.2-1.6 8.2-5.4 10.1-3.2 1.6-6.9.9-9.6-1.6C7.8 22.2 5.8 17.5 7 13.2 8.4 8.2 12.4 5.2 16.8 5.5z",
  puff: "M11.5 21.2 C9.2 21.5 7.1 19.8 6.9 17.4 C6.75 15.5 7.7 13.9 9.2 13.1 C8.6 10.6 10.3 8.1 13.0 7.5 C14.2 7.25 15.4 7.5 16.3 8.15 C17.0 6.4 18.9 5.2 21.1 5.3 C24.0 5.45 26.2 7.85 26.1 10.7 C26.05 11.5 25.8 12.25 25.4 12.9 C27.3 13.7 28.5 15.6 28.3 17.7 C28.05 20.3 25.8 22.2 23.1 22.1 C22.2 22.05 21.4 21.8 20.7 21.4 C19.5 23.0 17.2 24.0 14.6 23.7 C13.2 23.55 12.1 22.9 11.5 21.2Z",
};

/** 共享的白色眼睛，取自剪影设计稿。 */
export const AVATAR_EYE = {
  left: { cx: 12.2, cy: 13.4, rx: 2.15, ry: 3.1, rotate: -28 },
  right: { cx: 18.6, cy: 12.6, rx: 2.15, ry: 3.1, rotate: -28 },
} as const;

/** 旧 CSS 形状 id → v2 剪影 id（读路径兼容，老数据不该直接白屏）。 */
export const LEGACY_SHAPE_MAP: Record<string, AvatarShape> = {
  circle: "cloud",
  rounded: "puff",
  squircle: "bean",
  hex: "soft-hex",
  diamond: "drop",
  "soft-square": "petal",
};

export function normalizeShape(raw?: string | null): AvatarShape | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if ((AVATAR_SHAPES as readonly string[]).includes(s)) return s as AvatarShape;
  return LEGACY_SHAPE_MAP[s] ?? null;
}

/** 选中该助手自定义的底色；未设置或不在色板内返回 null，交给调用方走哈希兜底。 */
export function normalizeColor(raw?: string | null): string | null {
  const c = (raw || "").trim().toLowerCase();
  if (!c) return null;
  return AVATAR_COLOR_PALETTE.find((p) => p.toLowerCase() === c) ?? null;
}
