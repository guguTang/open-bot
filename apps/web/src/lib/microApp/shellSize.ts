/**
 * MicroAppShell iframe / dialog content-fit sizing.
 * Host clamps resize postMessages from openbot.micro SDK and drives Dialog chrome.
 *
 * Size budget (desktop content-fit):
 *   outer dialog/shell ≤ viewport max
 *   outer = content (iframe) + header chrome + dialog border (if any)
 * so a 1px border / header padding cannot push scrollWidth/Height past client
 * and create an outer scrollbar.
 */

/** Iframe content min (px) — avoid collapsed flash before first resize. */
export const MICRO_SHELL_MIN_WIDTH = 280;
export const MICRO_SHELL_MIN_HEIGHT = 160;

/** Soft default before first resize — orientation-neutral (not phone-narrow / not hub 860). */
export const MICRO_SHELL_DEFAULT_WIDTH = 480;
export const MICRO_SHELL_DEFAULT_HEIGHT = 360;

/** Open-tool shell max ≈ 90% of viewport (wide desktop). */
export const MICRO_SHELL_VIEWPORT_MAX_RATIO = 0.9;

/**
 * Desktop top-bar chrome reserved when clamping iframe content height.
 * Matches `.micro-app-shell-desktop-head` (padding 14+10 + 32px controls ≈ 56).
 */
export const MICRO_SHELL_DESKTOP_CHROME_HEIGHT = 56;

/**
 * Dialog border total (1px × 2 sides). DialogContent/` .modal` may paint a border;
 * content-fit forces border-width:0, but keep 2px in the clamp budget as slack so
 * any residual chrome cannot create an outer scrollbar.
 */
export const MICRO_SHELL_DIALOG_BORDER_TOTAL = 2;

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

/** Viewport box available for the whole dialog (content + chrome + border). */
export function microShellViewportMaxBox(opts: {
  narrow: boolean;
  viewportWidth: number;
  viewportHeight: number;
}): MicroShellSize {
  const vw = finitePositive(opts.viewportWidth, 1280);
  const vh = finitePositive(opts.viewportHeight, 800);
  if (opts.narrow) {
    return {
      width: Math.max(MICRO_SHELL_MIN_WIDTH, Math.floor(vw - 32)),
      height: Math.max(MICRO_SHELL_MIN_HEIGHT, Math.floor(vh * MICRO_SHELL_NARROW_MAX_CONTENT_RATIO)),
    };
  }
  return {
    width: Math.max(
      MICRO_SHELL_MIN_WIDTH,
      Math.floor(Math.min(vw * MICRO_SHELL_VIEWPORT_MAX_RATIO, vw - 32)),
    ),
    height: Math.max(
      MICRO_SHELL_MIN_HEIGHT,
      Math.floor(Math.min(vh * MICRO_SHELL_VIEWPORT_MAX_RATIO, vh - 32)),
    ),
  };
}

/**
 * Clamp iframe content size reported by the sandboxed SDK.
 * Shell Dialog hugs this size; over max → stage scrolls (height) / width capped.
 * Desktop max content height/width subtracts header chrome + dialog border so the
 * outer box (content + chrome) stays within the viewport max without scrolling.
 */
export function clampMicroShellSize(opts: ClampMicroShellSizeOpts): MicroShellSize {
  const vw = finitePositive(opts.viewportWidth, typeof window !== "undefined" ? window.innerWidth : 1280);
  const vh = finitePositive(opts.viewportHeight, typeof window !== "undefined" ? window.innerHeight : 800);
  const box = microShellViewportMaxBox({ narrow: opts.narrow, viewportWidth: vw, viewportHeight: vh });

  const maxW = opts.narrow
    ? box.width
    : Math.max(MICRO_SHELL_MIN_WIDTH, box.width - MICRO_SHELL_DIALOG_BORDER_TOTAL);

  const maxH = opts.narrow
    ? box.height
    : Math.max(
        MICRO_SHELL_MIN_HEIGHT,
        box.height - MICRO_SHELL_DESKTOP_CHROME_HEIGHT - MICRO_SHELL_DIALOG_BORDER_TOTAL,
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
