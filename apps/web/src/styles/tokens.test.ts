// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(__dirname, "../../../..");

describe("shared design tokens", () => {
  it("web/RN 生成文件与 design/tokens.json 一致", () => {
    expect(() =>
      execFileSync(process.execPath, [resolve(repo, "scripts/gen-design-tokens.mjs"), "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("web 与 RN 使用同一品牌色", () => {
    const tokens = JSON.parse(readFileSync(resolve(repo, "design/tokens.json"), "utf8"));
    const rn = readFileSync(resolve(repo, "apps/mobile-rn/src/global.css"), "utf8");
    const web = readFileSync(resolve(__dirname, "tokens.css"), "utf8");
    expect(web).toContain(`--ob-color-primary: ${tokens.color.light.primary};`);
    expect(rn).toContain(`--accent: ${tokens.color.light.primary};`);
  });
});
