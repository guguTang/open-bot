/**
 * MicroAppShell iframe / dialog content-fit sizing.
 * Host applies resize postMessages from openbot.micro SDK and drives Dialog chrome.
 *
 * Desktop height budget (one number, not margin-vs-overflow ping-pong):
 *   dialog + shell max = viewport box, overflow clip — chrome never scrolls
 *   header = its natural height (flex 0 0 auto, not clipped)
 *   iframe = the full reported content size
 *   stage = the only scrollport; it hugs the iframe when header + content fit,
 *           and scrolls that full iframe when they exceed the box
 *
 * The iframe document is overflow:hidden. Shrinking the iframe below the
 * reported size (chrome, border slack, …) clips the tool with no inner scroll,
 * and a stage sized to that same iframe has nothing left to scroll.
 * Narrow/sheet still clamps the iframe; that path is unchanged.
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
 * Dialog border total (1px × 2 sides). Content-fit forces border-width:0.
 * The resting desktop iframe does NOT subtract this — the tool would lose those
 * pixels inside an overflow:hidden document. The measure canvas still keeps the
 * slack so a temporary expand cannot paint an outer scrollbar.
 */
export const MICRO_SHELL_DIALOG_BORDER_TOTAL = 2;

/**
 * Resting iframe cap. A stuck measure canvas (see preferredSize expand) must not
 * become the displayed frame; real tools sit far below this and stay full size.
 */
export const MICRO_SHELL_FRAME_ABSURD_CAP = 10_000;

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
 * Viewport canvas for host-assisted measure, and the narrow/sheet iframe cap.
 * Desktop resting size is `resolveMicroShellFrameSize` — this clamp is smaller
 * than the reported tool on purpose (measure canvas / sheet), not the size the
 * opened tool is shown at.
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

/**
 * Desktop iframe size: the reported content, only floored at the minimum and
 * capped at an absurd measure-canvas size. Viewport chrome is NOT subtracted;
 * the stage scrolls instead of clipping.
 * Narrow delegates to `clampMicroShellSize` so the sheet path stays capped.
 */
export function resolveMicroShellFrameSize(opts: ClampMicroShellSizeOpts): MicroShellSize {
  if (opts.narrow) return clampMicroShellSize(opts);
  const rawW = finitePositive(opts.width, MICRO_SHELL_DEFAULT_WIDTH);
  const rawH = finitePositive(opts.height, MICRO_SHELL_DEFAULT_HEIGHT);
  return {
    width: Math.min(Math.max(Math.ceil(rawW), MICRO_SHELL_MIN_WIDTH), MICRO_SHELL_FRAME_ABSURD_CAP),
    height: Math.min(Math.max(Math.ceil(rawH), MICRO_SHELL_MIN_HEIGHT), MICRO_SHELL_FRAME_ABSURD_CAP),
  };
}

/** Classic scrollbar thickness (px). Overlay scrollbars measure as 0. */
let scrollbarSizeCache: number | null = null;

export function microShellScrollbarSize(): number {
  if (scrollbarSizeCache != null) return scrollbarSizeCache;
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden;";
  document.documentElement.appendChild(probe);
  scrollbarSizeCache = Math.max(0, probe.offsetWidth - probe.clientWidth);
  probe.remove();
  return scrollbarSizeCache;
}

export type MicroShellStageScroll = {
  width: boolean;
  height: boolean;
  /** Extra shell width so a vertical scrollbar does not squeeze the iframe. */
  reserveX: number;
  /** Extra stage height so a horizontal scrollbar does not cover the iframe. */
  reserveY: number;
};

/**
 * Whether the stage must scroll. Desktop compares the reported content to the
 * viewport box minus header chrome (border is 0 on the content-fit dialog).
 * The iframe itself stays at `resolveMicroShellFrameSize`.
 * A single-axis scrollbar is reserved beside the iframe so it cannot clip the
 * other edge or force a second bar. `scrollbar` is that thickness (0 = overlay).
 */
export function microShellStageScrolls(opts: {
  reportedWidth: number;
  reportedHeight: number;
  narrow: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
  scrollbar?: number;
}): MicroShellStageScroll {
  const vw = finitePositive(opts.viewportWidth, typeof window !== "undefined" ? window.innerWidth : 1280);
  const vh = finitePositive(opts.viewportHeight, typeof window !== "undefined" ? window.innerHeight : 800);
  const bar = Math.max(0, Math.round(opts.scrollbar ?? 0));
  if (opts.narrow) {
    const clamped = clampMicroShellSize({
      width: opts.reportedWidth,
      height: opts.reportedHeight,
      narrow: true,
      viewportWidth: vw,
      viewportHeight: vh,
    });
    return {
      width: Number.isFinite(opts.reportedWidth) && opts.reportedWidth > clamped.width + 1,
      height: microShellHeightOverflow(opts.reportedHeight, clamped.height),
      reserveX: 0,
      reserveY: 0,
    };
  }
  const box = microShellViewportMaxBox({ narrow: false, viewportWidth: vw, viewportHeight: vh });
  const stageMaxH = Math.max(
    MICRO_SHELL_MIN_HEIGHT,
    box.height - MICRO_SHELL_DESKTOP_CHROME_HEIGHT,
  );
  const reportedW = finitePositive(opts.reportedWidth, MICRO_SHELL_DEFAULT_WIDTH);
  const reportedH = finitePositive(opts.reportedHeight, MICRO_SHELL_DEFAULT_HEIGHT);
  let width = reportedW > box.width + 1;
  let height = reportedH > stageMaxH + 1;
  let reserveX = 0;
  let reserveY = 0;
  if (height && !width && reportedW + bar <= box.width + 1) reserveX = bar;
  else if (height && !width && bar > 0) width = true;
  if (width && !height && reportedH + bar <= stageMaxH + 1) reserveY = bar;
  else if (width && !height && bar > 0 && reserveX === 0) height = true;
  return { width, height, reserveX, reserveY };
}
