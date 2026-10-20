import { describe, expect, it } from "vitest";
import { formStateLines, resolveOpenUiAction } from "./actions";

describe("resolveOpenUiAction", () => {
  it("maps continue_conversation to a user message", () => {
    expect(
      resolveOpenUiAction({ type: "continue_conversation", params: {}, humanFriendlyMessage: " 好的 " }),
    ).toEqual({ kind: "send", text: "好的" });
  });

  it("appends form fields", () => {
    const r = resolveOpenUiAction({
      type: "continue_conversation",
      params: {},
      humanFriendlyMessage: "提交",
      formName: "f",
      formState: { f: { name: { value: "张三" }, tags: ["a", "b"], empty: "" } },
    });
    expect(r).toEqual({ kind: "send", text: "提交\nname: 张三\ntags: a, b" });
  });

  it("only opens http(s) urls", () => {
    expect(
      resolveOpenUiAction({ type: "open_url", params: { url: "https://example.com/a" }, humanFriendlyMessage: "" }),
    ).toEqual({ kind: "open_url", url: "https://example.com/a" });
    expect(
      resolveOpenUiAction({ type: "open_url", params: { url: "javascript:alert(1)" }, humanFriendlyMessage: "" }).kind,
    ).toBe("ignore");
  });

  it("ignores unknown and empty actions", () => {
    expect(resolveOpenUiAction({ type: "Custom", params: {}, humanFriendlyMessage: "x" }).kind).toBe("ignore");
    expect(
      resolveOpenUiAction({ type: "continue_conversation", params: {}, humanFriendlyMessage: "" }).kind,
    ).toBe("ignore");
  });

  it("formStateLines tolerates junk", () => {
    expect(formStateLines(null)).toEqual([]);
    expect(formStateLines({ a: 1, b: true })).toEqual(["a: 1", "b: true"]);
  });
});
