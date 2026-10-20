import { describe, expect, it } from "vitest";
import {
  clampMicroShellSize,
  microShellHeightOverflow,
  MICRO_SHELL_MIN_HEIGHT,
  MICRO_SHELL_MIN_WIDTH,
  MICRO_SHELL_VIEWPORT_MAX_RATIO,
  MICRO_SHELL_DESKTOP_CHROME_HEIGHT,
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

  it("caps tall content on desktop at ~90% viewport and flags overflow", () => {
    const rawH = 2000;
    const vh = 900;
    const s = clampMicroShellSize({
      width: 320,
      height: rawH,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: vh,
    });
    expect(s.width).toBe(320);
    const maxH = Math.floor(
      Math.min(vh * MICRO_SHELL_VIEWPORT_MAX_RATIO, vh - 32) - MICRO_SHELL_DESKTOP_CHROME_HEIGHT,
    );
    expect(s.height).toBe(maxH);
    expect(microShellHeightOverflow(rawH, s.height)).toBe(true);
  });

  it("portrait tool stays narrow — does not stretch to hub width", () => {
    const s = clampMicroShellSize({
      width: 320,
      height: 520,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(s.width).toBe(320);
    expect(s.height).toBe(520);
    expect(s.width).toBeLessThan(600);
  });

  it("landscape tool stays wide+flat — follows reported w>h", () => {
    const s = clampMicroShellSize({
      width: 720,
      height: 400,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(s.width).toBe(720);
    expect(s.height).toBe(400);
    expect(s.width).toBeGreaterThan(s.height);
  });

  it("square tool keeps equal sides within clamp", () => {
    const s = clampMicroShellSize({
      width: 480,
      height: 480,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(s.width).toBe(480);
    expect(s.height).toBe(480);
  });

  it("caps width to ~90% viewport on small desktops", () => {
    const s = clampMicroShellSize({
      width: 900,
      height: 400,
      narrow: false,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(s.width).toBeLessThanOrEqual(Math.floor(800 * MICRO_SHELL_VIEWPORT_MAX_RATIO));
    expect(s.height).toBeLessThanOrEqual(
      Math.floor(Math.min(600 * MICRO_SHELL_VIEWPORT_MAX_RATIO, 600 - 32) - MICRO_SHELL_DESKTOP_CHROME_HEIGHT),
    );
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

describe("clampMicroShellSize content-fit grow/shrink", () => {
  it("allows growth beyond previous frame size (no sticky max)", () => {
    const grown = clampMicroShellSize({
      width: 720,
      height: 400,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(grown.width).toBe(720);
    expect(grown.height).toBe(400);
  });

  it("allows height shrink on smaller report (symmetric to width)", () => {
    const shrunk = clampMicroShellSize({
      width: 440,
      height: 280,
      narrow: false,
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(shrunk.width).toBe(440);
    expect(shrunk.height).toBe(280);
  });
});
