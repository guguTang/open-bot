// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(__dirname, "../../../..");

describe("design tokens", () => {
  it("RN 生成文件与 design/tokens.json 一致", () => {
    expect(() =>
      execFileSync(process.execPath, [resolve(repo, "scripts/gen-design-tokens.mjs"), "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("web 使用 Uber oklch 主题且不再引用旧 --ob-* token 或 HeroUI 样式", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const theme = readFileSync(resolve(__dirname, "uber-theme.css"), "utf8");
    expect(css).not.toContain("@heroui/");
    expect(css).toContain('@import "./styles/uber-theme.css";');
    expect(css).toContain("--color-primary: var(--accent)");
    expect(css).not.toMatch(/var\(--ob-/);
    expect(theme).toMatch(/--accent: oklch\(0% 0 0\)/);
  });
});
