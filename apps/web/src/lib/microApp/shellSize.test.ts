import { describe, expect, it } from "vitest";
import {
  clampMicroShellSize,
  microShellHeightOverflow,
  MICRO_SHELL_DESKTOP_MAX_CONTENT_HEIGHT,
  MICRO_SHELL_MIN_HEIGHT,
  MICRO_SHELL_MIN_WIDTH,
} from "./shellSize";

describe("clampMicroShellSize", () => {
  it("clamps desktop to min/max", () => {
    const s = clampMicroShellSize({
      width: 100,
      height: 50,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(s.width).toBe(MICRO_SHELL_MIN_WIDTH);
    expect(s.height).toBe(MICRO_SHELL_MIN_HEIGHT);
  });

  it("caps tall content on desktop and flags overflow", () => {
    const rawH = 2000;
    const s = clampMicroShellSize({
      width: 480,
      height: rawH,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(s.width).toBe(480);
    expect(s.height).toBeLessThanOrEqual(MICRO_SHELL_DESKTOP_MAX_CONTENT_HEIGHT);
    expect(microShellHeightOverflow(rawH, s.height)).toBe(true);
  });

  it("uses narrower max on small viewports", () => {
    const s = clampMicroShellSize({
      width: 900,
      height: 400,
      narrow: false,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(s.width).toBeLessThanOrEqual(800 - 64);
    expect(s.height).toBeLessThanOrEqual(600 - 160);
  });

  it("narrow mode allows larger fraction of viewport height", () => {
    const s = clampMicroShellSize({
      width: 400,
      height: 2000,
      narrow: true,
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(s.width).toBeLessThanOrEqual(390 - 32);
    expect(s.height).toBeGreaterThan(MICRO_SHELL_MIN_HEIGHT);
    expect(s.height).toBeLessThanOrEqual(Math.floor(844 * 0.72));
  });
});
