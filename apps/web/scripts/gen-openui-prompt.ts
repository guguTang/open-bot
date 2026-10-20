/**
 * 从 OpenUI 组件契约生成助手侧技能 skills/generative-ui/SKILL.md。
 * 用法：pnpm --dir apps/web gen:openui-prompt   （Node ≥ 23 直接运行 .ts）
 * 加 --check 只校验已提交文件是否最新（CI 用）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenBotSkillMarkdown } from "../src/openui/prompt.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../skills/generative-ui/SKILL.md");
const next = buildOpenBotSkillMarkdown();

if (process.argv.includes("--check")) {
  let cur = "";
  try {
    cur = readFileSync(out, "utf8");
  } catch {
    /* missing */
  }
  if (cur !== next) {
    console.error(`${out} is stale; run: pnpm --dir apps/web gen:openui-prompt`);
    process.exit(1);
  }
  console.log("generative-ui skill is up to date");
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, next);
  console.log(`wrote ${out}`);
}
