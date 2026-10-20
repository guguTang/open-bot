import { describe, expect, it } from "vitest";
import { resizeTextarea } from "./useAutoGrowTextarea";

function makeTextarea(contentHeight: () => number, maxHeight = "280px") {
  const el = document.createElement("textarea");
  el.style.maxHeight = maxHeight;
  document.body.appendChild(el);
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: contentHeight });
  return el;
}

describe("resizeTextarea", () => {
  it("随内容增高，未超上限时不出现内部滚动", () => {
    let h = 36;
    const el = makeTextarea(() => h);
    resizeTextarea(el);
    expect(el.style.height).toBe("36px");
    expect(el.style.overflowY).toBe("hidden");
    h = 120;
    resizeTextarea(el);
    expect(el.style.height).toBe("120px");
  });

  it("超过 max-height 后封顶并内部滚动", () => {
    const el = makeTextarea(() => 900);
    resizeTextarea(el);
    expect(el.style.height).toBe("280px");
    expect(el.style.overflowY).toBe("auto");
  });

  it("删字/发送后收缩回去", () => {
    let h = 900;
    const el = makeTextarea(() => h);
    resizeTextarea(el);
    h = 36;
    resizeTextarea(el);
    expect(el.style.height).toBe("36px");
    expect(el.style.overflowY).toBe("hidden");
  });

  it("没有 max-height 时不封顶", () => {
    const el = makeTextarea(() => 500, "none");
    resizeTextarea(el);
    expect(el.style.height).toBe("500px");
  });
});
