/**
 * 展示层格式化。对齐 `apps/web/src/components/avatarColor.ts` 的头像取色算法，
 * 保证同一个助手在 Web / 移动端是同一个颜色。
 */

const AVATAR_COLORS = [
  "#e85d4c", // red
  "#2a9d8f", // teal
  "#f4a261", // orange
  "#e76f51", // coral
  "#457b9d", // blue
  "#9b5de5", // purple
  "#00bbf9", // sky
  "#f15bb5", // magenta
  "#00f5d4", // mint
  "#fee440", // yellow
] as const;

export function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function avatarColor(seed: string): string {
  return AVATAR_COLORS[hashString(seed || "?") % AVATAR_COLORS.length];
}

/** 相对亮度，WCAG 2.x 定义。见 https://www.w3.org/TR/WCAG22/#dfn-relative-luminance */
function relativeLuminance(hex: string): number {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const channel = (v: string): number => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
}

/** 深色头像字，两档里挑对比度更高的一档。 */
const AVATAR_DARK = "#1a1a1b";
const AVATAR_LIGHT = "#ffffff";

/**
 * 决定头像上压什么颜色的字。
 *
 * 之前只特判了 `#fee440` 一个黄色，白字压到 `#00bbf9`（对比度 1.9:1）
 * 和 `#00f5d4`（1.5:1）上基本读不出来。这里按 WCAG 相对亮度算，
 * 两档里取对比度更高的那个 —— 调色板以后增删颜色也不用再补特判。
 */
export function avatarForeground(bg: string): string {
  const lum = relativeLuminance(bg);
  const onDark = (lum + 0.05) / 0.05;
  const onLight = 1.05 / (lum + 0.05);
  return onLight >= onDark ? AVATAR_LIGHT : AVATAR_DARK;
}

export function avatarInitials(name: string): string {
  const t = (name || "?").trim();
  if (!t) return "?";
  const parts = t.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

export function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 相对时间，列表里比完整时间戳省空间也更易读。 */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
