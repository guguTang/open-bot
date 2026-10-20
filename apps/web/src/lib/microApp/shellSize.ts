/**
 * MicroAppShell iframe / dialog content-fit sizing.
 * Host clamps resize postMessages from openbot.micro SDK.
 */

/** Iframe content min (px) — avoid collapsed flash before first resize. */
export const MICRO_SHELL_MIN_WIDTH = 280;
export const MICRO_SHELL_MIN_HEIGHT = 160;

/** Desktop dialog outer max — align settings-dialog (~860×680) but height is soft. */
export const MICRO_SHELL_DESKTOP_MAX_WIDTH = 860;
/** Soft max for iframe content height on wide desktop (dialog chrome sits above). */
export const MICRO_SHELL_DESKTOP_MAX_CONTENT_HEIGHT = 560;

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
 * Width stays ≤ dialog content width; height scrolls inside stage when over max.
 */
export function clampMicroShellSize(opts: ClampMicroShellSizeOpts): MicroShellSize {
  const vw = finitePositive(opts.viewportWidth, typeof window !== "undefined" ? window.innerWidth : 1280);
  const vh = finitePositive(opts.viewportHeight, typeof window !== "undefined" ? window.innerHeight : 800);

  const maxW = opts.narrow
    ? Math.max(MICRO_SHELL_MIN_WIDTH, Math.floor(vw - 32))
    : Math.min(MICRO_SHELL_DESKTOP_MAX_WIDTH - 32, Math.max(MICRO_SHELL_MIN_WIDTH, Math.floor(vw - 64)));

  const maxH = opts.narrow
    ? Math.max(MICRO_SHELL_MIN_HEIGHT, Math.floor(vh * MICRO_SHELL_NARROW_MAX_CONTENT_RATIO))
    : Math.min(
        MICRO_SHELL_DESKTOP_MAX_CONTENT_HEIGHT,
        Math.max(MICRO_SHELL_MIN_HEIGHT, Math.floor(vh - 160)),
      );

  const rawW = finitePositive(opts.width, maxW);
  const rawH = finitePositive(opts.height, MICRO_SHELL_MIN_HEIGHT);

  return {
    width: Math.min(Math.max(Math.ceil(rawW), MICRO_SHELL_MIN_WIDTH), maxW),
    height: Math.min(Math.max(Math.ceil(rawH), MICRO_SHELL_MIN_HEIGHT), maxH),
  };
}

/** True when content height was capped — stage/iframe should scroll. */
export function microShellHeightOverflow(reportedHeight: number, clampedHeight: number): boolean {
  return Number.isFinite(reportedHeight) && reportedHeight > clampedHeight + 1;
}
