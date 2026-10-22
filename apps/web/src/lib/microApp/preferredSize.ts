/**
 * Preferred / intrinsic content size for MicroAppShell content-fit.
 *
 * Auto-measure inside a sized iframe is constrained by the current frame:
 * CSS like `width: min(100%, 720px)` cannot grow past ~frame width, so
 * ResizeObserver never sees the larger preferred size. Height taken from
 * `documentElement.offsetHeight` tracks the iframe viewport and resists shrink.
 * Viewport units (`100vw`) also track the iframe viewport — expanding only
 * `html.style.width` does NOT change `vw`, so the host must briefly enlarge
 * the iframe canvas for a true preferred measure (clipped, no dialog flash).
 *
 * Platform contract (SDK mirrors these helpers):
 * 1. Host temporarily enlarges the iframe to the max content-fit canvas
 *    (measure-request → measure-go), then SDK measures.
 * 2. SDK also expands the layout containing block so `min(100%, N)` reveals N.
 * 3. Prefer child/content bounds (union of children, not viewport offset*);
 *    never use html/body offset* as a floor that blocks shrink.
 * 4. Fluid `width:100%` apps that fill the expand canvas fall back to the
 *    constrained (current-frame) measure.
 * 5. Explicit `openbot.micro.reportSize({width?, height?})` always wins when
 *    the app supplies numbers.
 * 6. Dialog/shell stay overflow:clip and max out at the viewport box, so the
 *    chrome never scrolls. The iframe stays at the full reported size (the
 *    document is overflow:hidden — shrinking it clips the tool). The stage is
 *    the only scrollport and scrolls that iframe when header + content exceed
 *    the box. A 1–2px measure miss stays inside the iframe, not an outer bar.
 */

/** Layout base used during unconstrained preferred-width measure (px). */
export const MICRO_SHELL_MEASURE_EXPAND_PX = 10_000;

/** Near-expand widths are treated as fluid fill, not a real preferred size. */
export const MICRO_SHELL_MEASURE_EXPAND_EPSILON_PX = 50;

/** Child tighter than body/scroll by this much → prefer child (card-in-stretch). */
export const MICRO_SHELL_MEASURE_CHILD_SLACK_PX = 48;

/** Ignore RO/window-resize echo after posting resize (ms). */
export const MICRO_SHELL_MEASURE_IGNORE_RO_MS = 280;

/**
 * CSS `min(100%, capPx)` under a given containing-block width.
 * Simulates why a frame-capped tool cannot grow without expand-measure.
 */
export function resolveMinPercentCap(containingBlockPx: number, capPx: number): number {
  const base = Number(containingBlockPx);
  const cap = Number(capPx);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return Math.ceil(base);
  return Math.min(base, cap);
}

/**
 * CSS `min(capPx, 100vw - gutter)` under a given iframe viewport width.
 * Host must enlarge the iframe for this to reveal `capPx` when frame < cap.
 */
export function resolveMinVwCap(viewportWidthPx: number, capPx: number, gutterPx = 32): number {
  const vw = Number(viewportWidthPx);
  const cap = Number(capPx);
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  if (!Number.isFinite(vw) || vw <= 0) return Math.ceil(cap);
  return Math.min(cap, Math.max(0, vw - gutterPx));
}

export type PreferredContentMetrics = {
  /** Union width of children (maxRight - minLeft), ignores centering offset. */
  contentWidth: number;
  /** Union height of children (maxBottom - minTop), ignores centering offset. */
  contentHeight: number;
  maxChildScrollWidth: number;
  maxChildScrollHeight: number;
  bodyScrollWidth: number;
  bodyScrollHeight: number;
  /** @deprecated alias — prefer contentWidth */
  contentRight?: number;
  /** @deprecated alias — prefer contentHeight */
  contentBottom?: number;
};

/**
 * Collapse layout metrics gathered during an (expanded) measure pass into
 * a content size. Deliberately ignores documentElement/body offsetWidth/Height
 * (viewport / expand canvas). Uses union box (not offset bottom/right) so
 * place-items:center inside a tall measure canvas does not inflate height.
 */
export function pickPreferredContentSize(metrics: PreferredContentMetrics): {
  width: number;
  height: number;
} {
  const unionW = finiteNonNeg(metrics.contentWidth ?? metrics.contentRight);
  const unionH = finiteNonNeg(metrics.contentHeight ?? metrics.contentBottom);
  let width = Math.max(
    unionW,
    finiteNonNeg(metrics.maxChildScrollWidth),
    finiteNonNeg(metrics.bodyScrollWidth),
  );
  let height = Math.max(
    unionH,
    finiteNonNeg(metrics.maxChildScrollHeight),
    finiteNonNeg(metrics.bodyScrollHeight),
  );

  const childW = finiteNonNeg(metrics.maxChildScrollWidth);
  const childH = finiteNonNeg(metrics.maxChildScrollHeight);
  if (childW > 0 && childW < width - MICRO_SHELL_MEASURE_CHILD_SLACK_PX) {
    width = childW;
  }
  if (childH > 0 && childH < height - MICRO_SHELL_MEASURE_CHILD_SLACK_PX) {
    height = childH;
  }

  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/**
 * After expand-measure: if width looks like fluid fill of the expand canvas,
 * use the constrained (current-frame) width instead.
 */
export function coalescePreferredWidth(opts: {
  expandedWidth: number;
  constrainedWidth: number;
  expandBasePx?: number;
  epsilonPx?: number;
}): number {
  const expand = opts.expandBasePx ?? MICRO_SHELL_MEASURE_EXPAND_PX;
  const eps = opts.epsilonPx ?? MICRO_SHELL_MEASURE_EXPAND_EPSILON_PX;
  const expanded = finiteNonNeg(opts.expandedWidth);
  const constrained = finiteNonNeg(opts.constrainedWidth);
  if (expanded >= expand - eps) {
    return Math.ceil(constrained > 0 ? constrained : expanded);
  }
  return Math.ceil(expanded);
}

/**
 * Host applies every subsequent resize symmetrically (grow and shrink).
 * No aspect-ratio lock — width and height clamp independently.
 */
export function hostAcceptsReportedSize(prev: { width: number; height: number } | null, next: {
  width: number;
  height: number;
}): { width: number; height: number } {
  void prev;
  return { width: next.width, height: next.height };
}

function finiteNonNeg(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}
