/**
 * 由组件契约生成助手侧提示词（纯函数，无 DOM 依赖，供脚本与测试使用）。
 */
import { createOpenBotLibrary, NULL_RENDERERS, OPENUI_PROMPT_OPTIONS } from "./spec.ts";

export function buildOpenBotPrompt(): string {
  const lib = createOpenBotLibrary(NULL_RENDERERS);
  return lib.prompt({
    preamble: OPENUI_PROMPT_OPTIONS.preamble,
    additionalRules: [...OPENUI_PROMPT_OPTIONS.additionalRules],
    examples: [...OPENUI_PROMPT_OPTIONS.examples],
  });
}

const SKILL_FRONTMATTER = `---
name: generative-ui
description: 需要给用户可点击的选项、表单、对比表、信息卡片等交互式/结构化回复时加载。用 OpenUI Lang 在回复里嵌一段 \`\`\`openui-lang 围栏，客户端（web / 桌面 / iOS / Android）渲染成原生组件，用户点击会作为新消息回到对话。普通问答不要加载；画图走 diagram。
---
`;

const SKILL_INTRO = `# 交互式回复（OpenUI）

> 本文件由 \`apps/web/scripts/gen-openui-prompt.ts\` 从 \`apps/web/src/openui/spec.ts\` 生成，请勿手改。
> 组件改动后运行：\`pnpm --dir apps/web gen:openui-prompt\`。

**对用户可见文案**：不要提 OpenUI、openui-lang、技能、工具这些内部名词。

何时用：让用户在几个选项里选、收集几项信息（表单）、并列对比、订单/行程/指标摘要卡片。
何时不用：普通问答、长文解释、代码、画图（走 diagram）。不确定时用普通 Markdown。

回复格式：先一两句 Markdown 说明，再给**一个** \`\`\`openui-lang 围栏；围栏外的文字照常是 Markdown。

用户点按钮后，你会收到一条普通用户消息（按钮的 @ToAssistant 文本；表单会附上字段值），照常继续对话即可。

---

`;

export function buildOpenBotSkillMarkdown(): string {
  return `${SKILL_FRONTMATTER}\n${SKILL_INTRO}${buildOpenBotPrompt().trim()}\n`;
}
