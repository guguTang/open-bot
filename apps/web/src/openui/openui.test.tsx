import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { MarkdownMessage } from "../components/MarkdownMessage";
import { OpenUIBlock } from "./OpenUIBlock";
import { OpenUiHostProvider, type OpenUiHost } from "./host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHOICE = `root = Card([q, opts], "选择套餐")
q = Text("你更看重哪一点？")
opts = Buttons([b1, b2])
b1 = Button("价格优先", @ToAssistant("我更看重价格"), "primary")
b2 = Button("性能优先", @ToAssistant("我更看重性能"))`;

const FORM = `root = Card([f])
f = Form("booking", [name, slot], submit)
name = Input("name", "姓名")
slot = Select("slot", "时段", ["上午", "下午"])
submit = Button("提交", @ToAssistant("提交预约信息"), "primary")`;

let container: HTMLDivElement;
let root: Root;
let host: OpenUiHost & {
  send: Mock<(text: string) => void>;
  openUrl: Mock<(url: string) => void>;
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  host = { send: vi.fn<(text: string) => void>(), openUrl: vi.fn<(url: string) => void>(), readonly: false };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(<OpenUiHostProvider value={host}>{node}</OpenUiHostProvider>);
  });
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button.oui-btn")];
}

describe("OpenUIBlock", () => {
  it("renders a valid program as components", async () => {
    await render(<OpenUIBlock source={CHOICE} streaming={false} />);
    expect(container.querySelector(".oui-card-title")?.textContent).toBe("选择套餐");
    expect(container.textContent).toContain("你更看重哪一点？");
    expect(buttons().map((b) => b.textContent)).toEqual(["价格优先", "性能优先"]);
    expect(container.querySelector("[data-testid=openui-fallback]")).toBeNull();
  });

  it("sends the button's message back into the conversation", async () => {
    await render(<OpenUIBlock source={CHOICE} streaming={false} />);
    await act(async () => buttons()[1]!.click());
    expect(host.send).toHaveBeenCalledWith("我更看重性能");
  });

  it("disables interaction while streaming and renders partial programs", async () => {
    const partial = CHOICE.split("\n").slice(0, 4).join("\n");
    await render(<OpenUIBlock source={partial} streaming />);
    expect(container.querySelector("[data-testid=openui-fallback]")).toBeNull();
    const b = buttons();
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((x) => x.disabled)).toBe(true);
  });

  it("falls back to source when the program is invalid", async () => {
    const bad = "this is not openui at all";
    await render(<OpenUIBlock source={bad} streaming={false} />);
    const fb = container.querySelector("[data-testid=openui-fallback]");
    expect(fb).not.toBeNull();
    expect(fb?.textContent).toContain(bad);
  });

  it("falls back when the root uses an unknown component", async () => {
    await render(<OpenUIBlock source={'root = Chart([1,2,3])'} streaming={false} />);
    expect(container.querySelector("[data-testid=openui-fallback]")).not.toBeNull();
  });

  it("includes form values in the submitted message", async () => {
    await render(<OpenUIBlock source={FORM} streaming={false} />);
    const input = container.querySelector<HTMLInputElement>("input[name=name]")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "张三");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const trigger = container.querySelector<HTMLButtonElement>("[data-slot=select-trigger]")!;
    expect(trigger.getAttribute("role")).toBe("combobox");
    // Radix keeps a clipped, aria-hidden <select> for form autofill. It is not the visible control.
    const native = container.querySelector("select");
    expect(native?.getAttribute("aria-hidden")).toBe("true");
    expect(native?.tabIndex).toBe(-1);
    await act(async () => {
      trigger.click();
    });
    const option = [...document.querySelectorAll<HTMLElement>("[data-slot=select-item]")].find(
      (el) => el.textContent === "下午",
    );
    expect(option).toBeTruthy();
    await act(async () => {
      option!.click();
    });
    await act(async () => buttons()[0]!.click());
    expect(host.send).toHaveBeenCalledTimes(1);
    const text = host.send.mock.calls[0]![0] as string;
    expect(text.split("\n")[0]).toBe("提交预约信息");
    expect(text).toContain("name: 张三");
    expect(text).toContain("slot: 下午");
  });

  it("readonly host never sends", async () => {
    host.readonly = true;
    await render(<OpenUIBlock source={CHOICE} streaming={false} />);
    expect(buttons().every((b) => b.disabled)).toBe(true);
  });
});

describe("MarkdownMessage + openui-lang fence", () => {
  it("renders markdown around an OpenUI block", async () => {
    const md = `先选一个方向：\n\n\`\`\`openui-lang\n${CHOICE}\n\`\`\`\n\n选好后我继续。`;
    await render(<MarkdownMessage content={md} />);
    expect(container.textContent).toContain("先选一个方向");
    expect(container.textContent).toContain("选好后我继续");
    expect(container.querySelector("[data-testid=openui-block]")).not.toBeNull();
    expect(buttons()).toHaveLength(2);
  });

  it("keeps an unclosed fence in streaming mode (no fallback)", async () => {
    const md = `稍等：\n\n\`\`\`openui-lang\nroot = Card([q])\nq = Text("加载`;
    await render(<MarkdownMessage content={md} streaming />);
    expect(container.querySelector("[data-testid=openui-fallback]")).toBeNull();
  });

  it("leaves other code fences alone", async () => {
    await render(<MarkdownMessage content={"```js\nconst a = 1\n```"} />);
    expect(container.querySelector("[data-testid=openui-block]")).toBeNull();
    expect(container.querySelector(".md-codeblock")).not.toBeNull();
  });
});
