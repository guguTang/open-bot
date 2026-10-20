/**
 * MicroAppShell iframe / dialog content-fit sizing.
 * Host clamps resize postMessages from openbot.micro SDK and drives Dialog chrome.
 */

/** Iframe content min (px) — avoid collapsed flash before first resize. */
export const MICRO_SHELL_MIN_WIDTH = 280;
export const MICRO_SHELL_MIN_HEIGHT = 160;

/** Soft default before first resize — modest, not hub 860 width. */
export const MICRO_SHELL_DEFAULT_WIDTH = 360;
export const MICRO_SHELL_DEFAULT_HEIGHT = 280;

/** Open-tool shell max ≈ 90% of viewport (wide desktop). */
export const MICRO_SHELL_VIEWPORT_MAX_RATIO = 0.9;

/** Desktop top-bar chrome reserved when clamping iframe content height. */
export const MICRO_SHELL_DESKTOP_CHROME_HEIGHT = 56;

/** Narrow / fullscreen: leave room for subhead + optional panels. */
export const MICRO_SHELL_NARROW_MAX_CONTENT_RATIO = 0.72;

export type MicroShellSize = { width: number; height: number };

export type ClampMicroShellSizeOpts = {
  width: number;
  height: number;
  /** useSheetFormUi — touch / layout-narrow ≤860 */
  narrow: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
};

function finitePositive(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

/**
 * Clamp iframe content size reported by the sandboxed SDK.
 * Shell Dialog hugs this size; over max → stage scrolls (height) / width capped.
 */
export function clampMicroShellSize(opts: ClampMicroShellSizeOpts): MicroShellSize {
  const vw = finitePositive(opts.viewportWidth, typeof window !== "undefined" ? window.innerWidth : 1280);
  const vh = finitePositive(opts.viewportHeight, typeof window !== "undefined" ? window.innerHeight : 800);

  const maxW = opts.narrow
    ? Math.max(MICRO_SHELL_MIN_WIDTH, Math.floor(vw - 32))
    : Math.max(
        MICRO_SHELL_MIN_WIDTH,
        Math.floor(Math.min(vw * MICRO_SHELL_VIEWPORT_MAX_RATIO, vw - 32)),
      );

  const maxH = opts.narrow
    ? Math.max(MICRO_SHELL_MIN_HEIGHT, Math.floor(vh * MICRO_SHELL_NARROW_MAX_CONTENT_RATIO))
    : Math.max(
        MICRO_SHELL_MIN_HEIGHT,
        Math.floor(Math.min(vh * MICRO_SHELL_VIEWPORT_MAX_RATIO, vh - 32) - MICRO_SHELL_DESKTOP_CHROME_HEIGHT),
      );

  const rawW = finitePositive(opts.width, MICRO_SHELL_DEFAULT_WIDTH);
  const rawH = finitePositive(opts.height, MICRO_SHELL_DEFAULT_HEIGHT);

  return {
    width: Math.min(Math.max(Math.ceil(rawW), MICRO_SHELL_MIN_WIDTH), maxW),
    height: Math.min(Math.max(Math.ceil(rawH), MICRO_SHELL_MIN_HEIGHT), maxH),
  };
}

/** True when content height was capped — stage/iframe should scroll. */
export function microShellHeightOverflow(reportedHeight: number, clampedHeight: number): boolean {
  return Number.isFinite(reportedHeight) && reportedHeight > clampedHeight + 1;
}
