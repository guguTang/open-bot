import { describe, expect, it } from "vitest";
import {
  decodeWorkspacePath,
  normalizeWorkspacePath,
  parseSandboxHref,
  previewTitleFromPath,
} from "./htmlPreviewModel";

describe("decodeWorkspacePath / normalizeWorkspacePath", () => {
  it("decodes remark-rehype percent-encoded Chinese filenames", () => {
    const encoded =
      "/workspace/bots/b82b2fbe-c621-4943-aff0-f59e7fc075b6/out/%E7%A4%BE%E4%BC%9A%E4%BF%9D%E9%99%A9%E4%B8%AA%E4%BA%BA%E6%9D%83%E7%9B%8A%E8%AE%B0%E5%BD%95-%E5%86%85%E5%AE%B9%E6%91%98%E8%A6%81.html";
    const want =
      "/workspace/bots/b82b2fbe-c621-4943-aff0-f59e7fc075b6/out/社会保险个人权益记录-内容摘要.html";
    expect(normalizeWorkspacePath(encoded)).toBe(want);
    expect(
      parseSandboxHref(`sandbox:${encoded}`),
    ).toBe(want);
  });

  it("leaves plain UTF-8 and ASCII paths unchanged", () => {
    expect(normalizeWorkspacePath("/workspace/out/hello.html")).toBe(
      "/workspace/out/hello.html",
    );
    expect(normalizeWorkspacePath("/workspace/out/中文.html")).toBe(
      "/workspace/out/中文.html",
    );
  });

  it("keeps malformed percent sequences", () => {
    expect(decodeWorkspacePath("/workspace/%E7%ZZ.html")).toBe(
      "/workspace/%E7%ZZ.html",
    );
  });

  it("preview title uses decoded basename", () => {
    const p = normalizeWorkspacePath(
      "/workspace/out/%E4%B8%AD%E6%96%87.html",
    );
    expect(previewTitleFromPath(p)).toBe("中文.html");
  });
});
