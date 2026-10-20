import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { buildOpenBotSkillMarkdown } from "./prompt";
import { createOpenBotLibrary, isOpenUiLang, NULL_RENDERERS, OPENUI_PROMPT_OPTIONS } from "./spec";

const repo = resolve(__dirname, "../../../..");

describe("OpenUI spec", () => {
  const lib = createOpenBotLibrary(NULL_RENDERERS);

  it("prompt examples parse without errors", () => {
    const parser = createParser(lib.toJSONSchema(), lib.root);
    for (const ex of OPENUI_PROMPT_OPTIONS.examples) {
      const r = parser.parse(ex);
      expect(r.meta.errors).toEqual([]);
      expect(r.root).toBeTruthy();
    }
  });

  it("recognises fence languages", () => {
    expect(isOpenUiLang("openui-lang")).toBe(true);
    expect(isOpenUiLang("OpenUI")).toBe(true);
    expect(isOpenUiLang("mermaid")).toBe(false);
    expect(isOpenUiLang(undefined)).toBe(false);
  });

  it("generated agent skill is up to date (run: pnpm --dir apps/web gen:openui-prompt)", () => {
    const onDisk = readFileSync(resolve(repo, "skills/generative-ui/SKILL.md"), "utf8");
    expect(onDisk).toBe(buildOpenBotSkillMarkdown());
  });

  it.each(["spec.ts", "actions.ts"])("mobile-rn %s is identical to web", (file) => {
    const web = readFileSync(resolve(__dirname, file), "utf8");
    const rn = readFileSync(resolve(repo, "apps/mobile-rn/src/openui", file), "utf8");
    expect(rn).toBe(web);
  });
});
