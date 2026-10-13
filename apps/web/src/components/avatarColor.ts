import { clamp } from "es-toolkit";

/** Formal palette — locked with open bot / UI UE design (unchanged). */
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

/**
 * Robot-heads shapes (npm `robot-heads`).
 * Stored `avatar_shape` may still be old organic ids — resolve via LEGACY map.
 */
export const AVATAR_SHAPES = ["circle", "square", "hexagon", "rectangle"] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLOR_PALETTE)[number] | string;

/** Chinese labels for settings / create pickers. */
export const AVATAR_SHAPE_LABELS: Record<AvatarShape, string> = {
  circle: "圆",
  square: "正方",
  hexagon: "六边",
  rectangle: "方屏",
};

/**
 * Old organic / CSS-shape ids → robot-heads shapes (read-path migrate).
 * Stored writes use library four: circle|square|hexagon|rectangle.
 */
export const LEGACY_SHAPE_MAP: Record<string, AvatarShape> = {
  // pre-v2 CSS shapes (UE / PM lock)
  circle: "circle",
  rounded: "square",
  "soft-square": "square",
  squircle: "square",
  hex: "hexagon",
  diamond: "square", // 菱形已并入方角
  // v2.1 organic silhouettes
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

/**
 * robot-heads display states used by this product.
 * Product presence stays five-only (`BotPresenceStatus`); `searching` is a
 * working-animation variant only (§8) — never a product / SSE status.
 * Do NOT use speaking / happy / sleeping.
 */
export type RobotHeadState =
  | "idle"
  | "thinking"
  | "working"
  | "listening"
  | "error"
  | "searching";

/**
 * Normalize any wire/UI status to one of the five product faces.
 * Empty / missing → idle; known five pass through; anything else → working
 * (product rule: unknown status shows as working, never throws).
 * Never returns searching / speaking / happy / sleeping.
 */
export function normalizePresenceStatus(status?: string | null): BotPresenceStatus {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "idle";
  return (BOT_PRESENCE_STATUSES as readonly string[]).includes(s)
    ? (s as BotPresenceStatus)
    : "working";
}

/**
 * Heuristic: tool name / host-activity / run-label looks like search/retrieve.
 * Used only to flip RobotHead working → searching animation (§8).
 * Does not expand product presence.
 */
const SEARCH_TOOL_RE =
  /search|web_?search|websearch|browse|browser|retrieve|retrieval|grep|web_fetch|webfetch|duckduck|serp|爬取|抓取|搜索|检索|联网/i;

export function toolNameLooksLikeSearch(nameOrLabel?: string | null): boolean {
  const s = (nameOrLabel ?? "").trim();
  if (!s) return false;
  return SEARCH_TOOL_RE.test(s);
}

/**
 * Map BotPresenceStatus → RobotHead state (UE hard lock + §8 variant).
 * idle→idle, thinking→thinking, working→working (or searching if hint),
 * awaiting_approval→listening, error→error.
 * Empty → idle; unknown non-empty → working.
 * `searchingHint` only applies when the mapped face would be `working`.
 */
export function presenceToRobotState(
  status?: string | null,
  searchingHint?: boolean,
): RobotHeadState {
  const face = normalizePresenceStatus(status);
  if (face === "awaiting_approval") return "listening";
  if (face === "working" && searchingHint) return "searching";
  return face; // idle | thinking | working | error
}

const AVATAR_COLORS = AVATAR_COLOR_PALETTE;

export function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 0–1 seed for robot-heads blink/glance desync. */
export function avatarSeed01(seed: string): number {
  return (hashString(seed || "?") % 1000) / 1000;
}

export function avatarColor(seed: string): string {
  const idx = hashString(seed || "?") % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function avatarShape(seed: string): AvatarShape {
  const idx = hashString(`shape:${seed || "?"}`) % AVATAR_SHAPES.length;
  return AVATAR_SHAPES[idx];
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

/** Pale steel trim derived from shell (or fixed fallback). */
export function deriveTrimColor(shell: string): string {
  const rgb = hexToRgb(shell);
  if (!rgb) return "#93a6c8";
  // Mix toward pale steel
  return rgbToHex(
    rgb.r * 0.35 + 147 * 0.65,
    rgb.g * 0.35 + 166 * 0.65,
    rgb.b * 0.35 + 200 * 0.65,
  );
}

/** Cool LED screen color derived from shell (or fixed fallback). */
export function deriveScreenColor(shell: string): string {
  const rgb = hexToRgb(shell);
  if (!rgb) return "#e8f2ff";
  return rgbToHex(
    rgb.r * 0.15 + 232 * 0.85,
    rgb.g * 0.15 + 242 * 0.85,
    rgb.b * 0.15 + 255 * 0.85,
  );
}

/** Initial letter(s) — kept for non-avatar uses; AgentAvatar must not show letters. */
export function avatarInitials(name: string): string {
  const t = (name || "?").trim();
  if (!t) return "?";
  const parts = t.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

const LOCAL_AVATAR_KEY = "openbot_avatar_prefs";

export type LocalAvatarPref = { shape?: string; color?: string };

export function loadLocalAvatarPrefs(): Record<string, LocalAvatarPref> {
  try {
    const raw = localStorage.getItem(LOCAL_AVATAR_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LocalAvatarPref>;
  } catch {
    return {};
  }
}

export function saveLocalAvatarPref(agentId: string, pref: LocalAvatarPref) {
  const all = loadLocalAvatarPrefs();
  all[agentId] = { ...all[agentId], ...pref };
  localStorage.setItem(LOCAL_AVATAR_KEY, JSON.stringify(all));
}

/** Pick shape+color for a new Bot, avoiding pairs already used by sibling agents. */
export function pickDefaultAvatar(
  seed: string,
  usedPairs: Iterable<string> = [],
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
