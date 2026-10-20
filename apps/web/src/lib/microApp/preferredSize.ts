/**
 * Preferred / intrinsic content size for MicroAppShell content-fit.
 *
 * Auto-measure inside a sized iframe is constrained by the current frame:
 * CSS like `width: min(100%, 720px)` cannot grow past ~frame width, so
 * ResizeObserver never sees the larger preferred size. Height taken from
 * `documentElement.offsetHeight` tracks the iframe viewport and resists shrink.
 *
 * Platform contract (SDK mirrors these helpers):
 * 1. Temporarily expand the layout containing block, measure content bounds,
 *    then restore — so percentage bases reveal preferred caps.
 * 2. Prefer child/content scroll metrics; never use html/body offset* (viewport)
 *    as a floor that blocks shrink or as the expand-canvas size.
 * 3. Fluid `width:100%` apps that fill the expand canvas fall back to the
 *    constrained (current-frame) measure.
 * 4. Explicit `openbot.micro.reportSize({width?, height?})` always wins when
 *    the app supplies numbers.
 */

/** Layout base used during unconstrained preferred-width measure (px). */
export const MICRO_SHELL_MEASURE_EXPAND_PX = 10_000;

/** Near-expand widths are treated as fluid fill, not a real preferred size. */
export const MICRO_SHELL_MEASURE_EXPAND_EPSILON_PX = 50;

/** Child tighter than body/scroll by this much → prefer child (card-in-stretch). */
export const MICRO_SHELL_MEASURE_CHILD_SLACK_PX = 48;

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

export type PreferredContentMetrics = {
  /** Max of children getBoundingClientRect().right (+ body pad/margin). */
  contentRight: number;
  /** Max of children getBoundingClientRect().bottom (+ body pad/margin). */
  contentBottom: number;
  maxChildScrollWidth: number;
  maxChildScrollHeight: number;
  bodyScrollWidth: number;
  bodyScrollHeight: number;
};

/**
 * Collapse layout metrics gathered during an (expanded) measure pass into
 * a content size. Deliberately ignores documentElement/body offsetWidth/Height
 * (viewport / expand canvas).
 */
export function pickPreferredContentSize(metrics: PreferredContentMetrics): {
  width: number;
  height: number;
} {
  let width = Math.max(
    finiteNonNeg(metrics.contentRight),
    finiteNonNeg(metrics.maxChildScrollWidth),
    finiteNonNeg(metrics.bodyScrollWidth),
  );
  let height = Math.max(
    finiteNonNeg(metrics.contentBottom),
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
  // Identity: host replaces previous frame size with the newly reported (clamped) size.
  void prev;
  return { width: next.width, height: next.height };
}

function finiteNonNeg(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}
