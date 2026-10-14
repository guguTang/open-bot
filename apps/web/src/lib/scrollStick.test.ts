import { describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, pinStick, stickAfterContentChange, stickFromReverseScroll, stickFromScrollMetrics } from "./scrollStick";

describe("scroll stick", () => {
  it("sticks when the viewport is within the near-bottom threshold", () => {
    expect(stickFromScrollMetrics(200, 200 - 100 - (NEAR_BOTTOM_PX - 1), 100)).toEqual({
      stickToBottom: true,
      showScrollBottom: false,
    });
    expect(stickFromScrollMetrics(200, 200 - 100 - NEAR_BOTTOM_PX, 100)).toEqual({
      stickToBottom: false,
      showScrollBottom: true,
    });
  });

  it("pins on send, switch, and the jump-to-bottom control", () => {
    expect(pinStick()).toEqual({ stickToBottom: true, showScrollBottom: false });
  });

  it("treats scrollTop 0 as the bottom of a reversed column", () => {
    expect(stickFromReverseScroll(0)).toEqual({ stickToBottom: true, showScrollBottom: false });
    expect(stickFromReverseScroll(-(NEAR_BOTTOM_PX - 1))).toEqual({ stickToBottom: true, showScrollBottom: false });
    expect(stickFromReverseScroll(-NEAR_BOTTOM_PX)).toEqual({ stickToBottom: false, showScrollBottom: true });
  });

  it("follows new content only while already stuck", () => {
    expect(stickAfterContentChange(true)).toEqual({ scroll: true, showScrollBottom: false });
    expect(stickAfterContentChange(false)).toEqual({ scroll: false, showScrollBottom: true });
  });
});