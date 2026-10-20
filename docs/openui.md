# OpenUI 交互式回复

助手回复默认是 Markdown；需要选项、表单、对比表、摘要卡片时，回复里可以嵌**一段** ` ```openui-lang ` 围栏（[OpenUI Lang](https://www.openui.com/docs/openui-lang)），客户端把它渲染成组件，用户的点击/表单提交作为一条新的用户消息回到对话。

## 结构

| 位置 | 作用 |
|------|------|
| `apps/web/src/openui/spec.ts` | 组件契约（Card / Text / Button / Buttons / Table / List / Field / Form / Input / Select），zod 定义 |
| `apps/web/src/openui/actions.ts` | OpenUI 动作 → 宿主动作（发消息 / 打开 http(s) 链接），纯函数 |
| `apps/mobile-rn/src/openui/{spec,actions}.ts` | 上面两份的**逐字节副本**，`spec.test.ts` 守护一致 |
| `apps/web/src/openui/library.tsx` · `OpenUIBlock.tsx` | web / 桌面（Tauri）/ Capacitor 壳的 DOM 渲染与回退 |
| `apps/mobile-rn/src/openui/library.tsx` · `OpenUIBlock.tsx` | RN 原生渲染（`@openuidev/react-lang` 自带 react-native 入口，不走 WebView） |
| `skills/generative-ui/SKILL.md` | 助手侧提示词，由 `pnpm --dir apps/web gen:openui-prompt` 从契约生成，勿手改 |

## 规则

- 流式中：围栏未闭合也直接交给 OpenUI Renderer 渐进渲染，交互禁用。
- 流式结束后解析不出 root（写坏 / 未知组件）或渲染异常 → 显示源码卡片，消息永远可读。
- 只读场景（无宿主 / RN 正在发送中）只展示不交互。
- 只放行 `@ToAssistant` 与 http(s) 的 `@OpenUrl`；未接 `Query/Mutation`（没有 toolProvider），提示词里也不教。
- 改组件只在末尾加参数（已存消息按位置解析），改完重跑生成脚本。

## 默认开启

`generative-ui` 是公共技能：列入 `skills/curated-builtins.json`（`preserve_local` 第一方）。新用户账号 seeding 全开；新 Bot 经 `SeedNewAgentDefaultSkills` 始终进入默认白名单（即使账号侧曾关掉）。老 Bot 已有 `agent_skills` 不回填。可在设置里关闭（非 `always_on`）。

## 测试

- `pnpm --dir apps/web test`：渲染、点击回传、表单值、流式、回退、Markdown 混排、提示词是否最新、web/RN 契约一致。
- `pnpm --dir apps/mobile-rn test`：RN 围栏切分（node --test）。

## 依赖与遥测

`@openuidev/react-lang` 1.0.x（MIT）。运行时遥测默认关闭（需 `OPENUI_RUNTIME_TELEMETRY_ENABLED=1` 才开）；安装遥测是 postinstall，pnpm 未放行故不执行。未使用 OpenUI Gateway / Thesys API key：模型仍走现有 LLM 连接。
