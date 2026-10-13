/**
 * 助手形象：与 Web `apps/web/src/components/avatarColor.ts` 对齐。
 * 形状 / 色板 / presence→robot-heads state 必须桌面与手机一致。
 */

import { clamp } from "es-toolkit";

/** 正式色板（与 Web 锁定，12 色）。 */
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

/** robot-heads 四形；存库可能仍是旧有机 id，读路径经 LEGACY_SHAPE_MAP。 */
export const AVATAR_SHAPES = ["circle", "square", "hexagon", "rectangle"] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLOR_PALETTE)[number] | string;

export const AVATAR_SHAPE_LABELS: Record<AvatarShape, string> = {
  circle: "圆",
  square: "正方",
  hexagon: "六边",
  rectangle: "方屏",
};

/** 旧剪影 / CSS 形状 → robot-heads 四形。 */
export const LEGACY_SHAPE_MAP: Record<string, AvatarShape> = {
  circle: "circle",
  rounded: "square",
  "soft-square": "square",
  squircle: "square",
  hex: "hexagon",
  diamond: "square",
  cloud: "circle",
  puff: "circle",
  bean: "square",
  petal: "square",
  drop: "rectangle",
  "soft-hex": "hexagon",
};

export const BOT_PRESENCE_STATUSES = [
  "idle",
  "thinking",
  "working",
  "awaiting_approval",
  "error",
] as const;

export type BotPresenceStatus = "idle" | "thinking" | "working" | "awaiting_approval" | "error";

export type RobotHeadState =
  | "idle"
  | "thinking"
  | "working"
  | "listening"
  | "error"
  | "searching";

export function normalizePresenceStatus(status?: string | null): BotPresenceStatus {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "idle";
  return (BOT_PRESENCE_STATUSES as readonly string[]).includes(s)
    ? (s as BotPresenceStatus)
    : "working";
}

const SEARCH_TOOL_RE =
  /search|web_?search|websearch|browse|browser|retrieve|retrieval|grep|web_fetch|webfetch|duckduck|serp|爬取|抓取|搜索|检索|联网/i;

export function toolNameLooksLikeSearch(nameOrLabel?: string | null): boolean {
  const s = (nameOrLabel ?? "").trim();
  if (!s) return false;
  return SEARCH_TOOL_RE.test(s);
}

export function presenceToRobotState(
  status?: string | null,
  searchingHint?: boolean
): RobotHeadState {
  const face = normalizePresenceStatus(status);
  if (face === "awaiting_approval") return "listening";
  if (face === "working" && searchingHint) return "searching";
  return face;
}

export function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 0–1 seed：robot-heads 眨眼 / 扫视错峰。 */
export function avatarSeed01(seed: string): number {
  return (hashString(seed || "?") % 1000) / 1000;
}

export function avatarColor(seed: string): string {
  return AVATAR_COLOR_PALETTE[hashString(seed || "?") % AVATAR_COLOR_PALETTE.length];
}

/** 相对亮度，WCAG 2.x。见 https://www.w3.org/TR/WCAG22/#dfn-relative-luminance */
function relativeLuminance(hex: string): number {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const channel = (v: string): number => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(m[1]!) + 0.7152 * channel(m[2]!) + 0.0722 * channel(m[3]!);
}

const AVATAR_FG_DARK = "#1a1a1b";
const AVATAR_FG_LIGHT = "#ffffff";

/** 头像字色：两档里取对比度更高的一档。 */
export function avatarForeground(bg: string): string {
  const lum = relativeLuminance(bg);
  const onDark = (lum + 0.05) / 0.05;
  const onLight = 1.05 / (lum + 0.05);
  return onLight >= onDark ? AVATAR_FG_LIGHT : AVATAR_FG_DARK;
}

export function avatarInitials(name: string): string {
  const t = (name || "?").trim();
  if (!t) return "?";
  const parts = t.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export function avatarShape(seed: string): AvatarShape {
  return AVATAR_SHAPES[hashString(`shape:${seed || "?"}`) % AVATAR_SHAPES.length];
}

export function resolveAvatarColor(seed: string, override?: string | null): string {
  if (override && /^#[0-9a-fA-F]{6}$/.test(override.trim())) return override.trim();
  return avatarColor(seed);
}

export function resolveAvatarShape(seed: string, override?: string | null): AvatarShape {
  const s = (override || "").trim();
  if ((AVATAR_SHAPES as readonly string[]).includes(s)) return s as AvatarShape;
  if (s && LEGACY_SHAPE_MAP[s]) return LEGACY_SHAPE_MAP[s];
  return avatarShape(seed);
}

/** @deprecated 用 resolveAvatarShape；保留给旧调用方。 */
export function normalizeShape(raw?: string | null): AvatarShape | null {
  const s = (raw || "").trim();
  if (!s) return null;
  if ((AVATAR_SHAPES as readonly string[]).includes(s)) return s as AvatarShape;
  return LEGACY_SHAPE_MAP[s] ?? null;
}

/** @deprecated 用 resolveAvatarColor；未设置或不在色板内返回 null。 */
export function normalizeColor(raw?: string | null): string | null {
  const c = (raw || "").trim().toLowerCase();
  if (!c) return null;
  return AVATAR_COLOR_PALETTE.find((p) => p.toLowerCase() === c) ?? null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function deriveTrimColor(shell: string): string {
  const rgb = hexToRgb(shell);
  if (!rgb) return "#93a6c8";
  return rgbToHex(
    rgb.r * 0.35 + 147 * 0.65,
    rgb.g * 0.35 + 166 * 0.65,
    rgb.b * 0.35 + 200 * 0.65
  );
}

export function deriveScreenColor(shell: string): string {
  const rgb = hexToRgb(shell);
  if (!rgb) return "#e8f2ff";
  return rgbToHex(
    rgb.r * 0.15 + 232 * 0.85,
    rgb.g * 0.15 + 242 * 0.85,
    rgb.b * 0.15 + 255 * 0.85
  );
}

export function pickDefaultAvatar(
  seed: string,
  usedPairs: Iterable<string> = []
): { shape: AvatarShape; color: string } {
  const used = new Set(usedPairs);
  const baseShape = avatarShape(seed);
  const baseColor = avatarColor(seed);
  const pair0 = `${baseShape}|${baseColor}`;
  if (!used.has(pair0)) return { shape: baseShape, color: baseColor };
  for (let i = 0; i < AVATAR_COLOR_PALETTE.length * AVATAR_SHAPES.length; i++) {
    const shape = AVATAR_SHAPES[(hashString(seed) + i) % AVATAR_SHAPES.length];
    const color = AVATAR_COLOR_PALETTE[(hashString(seed) + i * 3) % AVATAR_COLOR_PALETTE.length];
    const pair = `${shape}|${color}`;
    if (!used.has(pair)) return { shape, color };
  }
  return { shape: baseShape, color: baseColor };
}
