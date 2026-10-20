import { describe, expect, it } from "vitest";
import {
  MICRO_SHELL_MEASURE_EXPAND_PX,
  coalescePreferredWidth,
  hostAcceptsReportedSize,
  pickPreferredContentSize,
  resolveMinPercentCap,
} from "./preferredSize";
import { clampMicroShellSize } from "./shellSize";

describe("resolveMinPercentCap (min(100%, N) fixture)", () => {
  it("stays stuck at frame width without expand — cannot reveal preferred cap", () => {
    const frame = 440;
    const preferredCap = 720;
    expect(resolveMinPercentCap(frame, preferredCap)).toBe(440);
  });

  it("reveals preferred cap when containing block is expanded", () => {
    const preferredCap = 720;
    expect(resolveMinPercentCap(MICRO_SHELL_MEASURE_EXPAND_PX, preferredCap)).toBe(720);
  });

  it("mode switch basic→science: expand measure grows beyond previous frame", () => {
    const basicCap = 440;
    const scienceCap = 720;
    const frameAfterBasic = resolveMinPercentCap(480, basicCap); // ~440
    expect(frameAfterBasic).toBe(440);
    // Without expand, science CSS still resolves against current frame:
    expect(resolveMinPercentCap(frameAfterBasic, scienceCap)).toBe(440);
    // With expand-measure, science preferred width is visible:
    const reported = resolveMinPercentCap(MICRO_SHELL_MEASURE_EXPAND_PX, scienceCap);
    expect(reported).toBe(720);
    expect(reported).toBeGreaterThan(frameAfterBasic);
  });
});

describe("pickPreferredContentSize", () => {
  it("does not floor height to a viewport-sized offsetHeight", () => {
    // Simulate short content after a tall mode; viewport would be 520.
    const size = pickPreferredContentSize({
      contentRight: 440,
      contentBottom: 280,
      maxChildScrollWidth: 440,
      maxChildScrollHeight: 280,
      bodyScrollWidth: 440,
      bodyScrollHeight: 280,
    });
    expect(size.height).toBe(280);
    expect(size.width).toBe(440);
  });

  it("prefers tight child over stretched body scroll width", () => {
    const size = pickPreferredContentSize({
      contentRight: 720,
      contentBottom: 400,
      maxChildScrollWidth: 720,
      maxChildScrollHeight: 400,
      bodyScrollWidth: 10000,
      bodyScrollHeight: 400,
    });
    expect(size.width).toBe(720);
    expect(size.height).toBe(400);
  });
});

describe("coalescePreferredWidth", () => {
  it("falls back to constrained width when expanded looks like fluid 100% fill", () => {
    expect(
      coalescePreferredWidth({
        expandedWidth: MICRO_SHELL_MEASURE_EXPAND_PX,
        constrainedWidth: 480,
      }),
    ).toBe(480);
  });

  it("keeps expanded preferred width when below expand canvas", () => {
    expect(
      coalescePreferredWidth({
        expandedWidth: 720,
        constrainedWidth: 440,
      }),
    ).toBe(720);
  });
});

describe("hostAcceptsReportedSize (grow + shrink, no aspect lock)", () => {
  it("grows width when report increases beyond previous frame", () => {
    const prev = { width: 440, height: 520 };
    const next = clampMicroShellSize({
      width: 720,
      height: 400,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const applied = hostAcceptsReportedSize(prev, next);
    expect(applied.width).toBe(720);
    expect(applied.width).toBeGreaterThan(prev.width);
  });

  it("shrinks height when report decreases", () => {
    const prev = { width: 440, height: 520 };
    const next = clampMicroShellSize({
      width: 440,
      height: 280,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const applied = hostAcceptsReportedSize(prev, next);
    expect(applied.height).toBe(280);
    expect(applied.height).toBeLessThan(prev.height);
  });

  it("does not lock aspect ratio when w/h both change", () => {
    const prev = { width: 440, height: 520 };
    const next = clampMicroShellSize({
      width: 720,
      height: 360,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    const applied = hostAcceptsReportedSize(prev, next);
    expect(applied.width).toBe(720);
    expect(applied.height).toBe(360);
    expect(applied.width / applied.height).not.toBeCloseTo(prev.width / prev.height, 1);
  });
});

describe("OPENBOT_MICRO_SDK preferred-measure contract", () => {
  it("embeds expand-measure + MutationObserver and keeps reportSize", async () => {
    const { OPENBOT_MICRO_SDK } = await import("./sdk");
    expect(OPENBOT_MICRO_SDK).toContain("MEASURE_EXPAND_PX = 10000");
    expect(OPENBOT_MICRO_SDK).toContain("withExpandedMeasureBase");
    expect(OPENBOT_MICRO_SDK).toContain("MutationObserver");
    expect(OPENBOT_MICRO_SDK).toContain("reportSize");
    expect(OPENBOT_MICRO_SDK).not.toContain("docEl.offsetHeight");
  });
});
