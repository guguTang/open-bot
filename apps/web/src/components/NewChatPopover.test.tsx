import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "../api";
import { NewChatPopover } from "./NewChatPopover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../hooks/usePreferHostMachines", () => ({
  usePreferHostMachines: () => ({ machines: [], loaded: true, error: null }),
}));

vi.mock("./AgentAvatar", () => ({
  AgentAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));

const agent = {
  id: "a1",
  name: "助手甲",
  description: "写代码",
  avatar_shape: "circle",
  avatar_color: "#457b9d",
  online: true,
} as Agent;

function installMatchMedia(narrow: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const matches = narrow && query.includes("max-width");
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

function rect(partial: Partial<DOMRect> & Pick<DOMRect, "top" | "left" | "width" | "height">): DOMRect {
  const right = partial.left + partial.width;
  const bottom = partial.top + partial.height;
  return {
    x: partial.left,
    y: partial.top,
    top: partial.top,
    left: partial.left,
    right,
    bottom,
    width: partial.width,
    height: partial.height,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

const ANCHOR_RECT = rect({ top: 48, left: 240, width: 36, height: 36 });
const PANEL_RECT = rect({ top: 44, left: 288, width: 360, height: 420 });

let container: HTMLDivElement;
let root: Root;

const nativeRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  installMatchMedia(false);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  // happy-dom does not apply Tailwind widths, so collision detection would flip
  // the panel. Report the real desktop panel size (360×420) for every node
  // except the trigger, which the test positions itself.
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.dataset.anchor === "new-chat") return ANCHOR_RECT;
    if (this === document.documentElement || this === document.body) {
      return rect({ top: 0, left: 0, width: 1280, height: 800 });
    }
    if (
      this.getAttribute("data-slot") === "popover-content" ||
      this.hasAttribute("data-radix-popper-content-wrapper")
    ) {
      return PANEL_RECT;
    }
    return nativeRect.call(this);
  };
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = nativeRect;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("NewChatPopover", () => {
  it("anchors the desktop panel to the right of the trigger", async () => {
    const anchorRef = createRef<HTMLButtonElement>();
    const button = document.createElement("button");
    button.textContent = "新建聊天";
    button.dataset.anchor = "new-chat";
    button.getBoundingClientRect = () => ANCHOR_RECT;
    document.body.appendChild(button);
    anchorRef.current = button;

    await act(async () => {
      root.render(
        <NewChatPopover
          open
          agents={[agent]}
          anchorRef={anchorRef}
          onClose={() => {}}
          onSelectAgent={() => {}}
          onCreateBot={() => {}}
          onCreateGroup={() => {}}
        />,
      );
    });

    const panel = document.querySelector("[data-slot='popover-content']");
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("data-side")).toBe("right");
    expect(document.querySelector("[data-slot='dialog-content']")).toBeNull();
    expect(panel?.textContent).toContain("收件人：");
    expect(panel?.textContent).toContain("创建新 Bot");
    expect(panel?.textContent).toContain("打开对话");
    expect(panel?.className).toContain("rounded-2xl");
    expect(panel?.className).not.toContain("left-1/2");

    const wrapper = panel?.parentElement;
    const transform = wrapper?.style.transform ?? "";
    const translate = /translate\(([-\d.]+)px/.exec(transform);
    expect(translate).toBeTruthy();
    const left = Number(translate?.[1]);
    expect(left).toBeGreaterThanOrEqual(ANCHOR_RECT.right);
    button.remove();
  });

  it("keeps the narrow layout on a bottom sheet", async () => {
    installMatchMedia(true);
    const anchorRef = createRef<HTMLButtonElement>();

    await act(async () => {
      root.render(
        <NewChatPopover
          open
          agents={[agent]}
          anchorRef={anchorRef}
          onClose={() => {}}
          onSelectAgent={() => {}}
          onCreateBot={() => {}}
          onCreateGroup={() => {}}
        />,
      );
    });

    expect(document.querySelector("[data-slot='sheet-content']")).toBeTruthy();
    expect(document.querySelector("[data-slot='popover-content']")).toBeNull();
    expect(document.body.textContent).toContain("新对话");
  });
});
