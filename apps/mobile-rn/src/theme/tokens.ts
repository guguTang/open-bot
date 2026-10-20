// 由 scripts/gen-design-tokens.mjs 从 design/tokens.json 生成，请勿手改
export const designTokens = {
  "color": {
    "light": {
      "primary": "#7C3AED",
      "primary-foreground": "#FFFFFF",
      "primary-soft": "#EDE9FE",
      "primary-2": "#A78BFA",
      "accent": "#0891B2",
      "background": "#F0F1F3",
      "surface": "#FFFFFF",
      "surface-soft": "#F5F5F7",
      "surface-hover": "#ECEEF1",
      "border": "#E5E7EB",
      "border-strong": "#D1D5DB",
      "foreground": "#1A1A1B",
      "muted-foreground": "#4B5563",
      "danger": "#DC2626",
      "danger-foreground": "#FFFFFF",
      "success": "#16A34A",
      "warning": "#D97706",
      "ring": "#7C3AED"
    },
    "dark": {
      "primary": "#7C3AED",
      "primary-foreground": "#FFFFFF",
      "primary-soft": "#2E1065",
      "primary-2": "#A78BFA",
      "accent": "#22D3EE",
      "background": "#0B0B0F",
      "surface": "#16161D",
      "surface-soft": "#1E1E27",
      "surface-hover": "#262631",
      "border": "#2A2A35",
      "border-strong": "#3A3A48",
      "foreground": "#F4F4F5",
      "muted-foreground": "#A1A1AA",
      "danger": "#F87171",
      "danger-foreground": "#0B0B0F",
      "success": "#4ADE80",
      "warning": "#FBBF24",
      "ring": "#A78BFA"
    }
  },
  "radius": {
    "sm": 8,
    "md": 12,
    "lg": 18,
    "pill": 999
  },
  "space": {
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 20,
    "6": 24,
    "8": 32
  },
  "motion": {
    "fast": 150,
    "base": 200,
    "slow": 300,
    "easing": "cubic-bezier(0.2, 0, 0, 1)"
  },
  "touchTarget": {
    "min": 44
  },
  "composer": {
    "maxHeight": 280,
    "maxViewportRatio": 0.4
  }
} as const;

/** 最小可点区域（iOS HIG 44pt），用于 hitSlop / minHeight。 */
export const TOUCH_MIN = 44;

/** 把视觉尺寸补足到 44pt 的 hitSlop。 */
export function hitSlopFor(size: number) {
  const pad = Math.max(0, Math.ceil((TOUCH_MIN - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
