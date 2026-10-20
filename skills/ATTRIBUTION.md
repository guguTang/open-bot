# Skill provenance

Several packages under `skills/` are adapted from
[mattpocock/skills](https://github.com/mattpocock/skills) (MIT License):

- `diagnosing-bugs`
- `tdd` (plus `tests.md`, `mocking.md`)
- `implement`
- `code-review`

Edits for open-bot: `host_*` / `sandbox_*` / `load_skill` wording, single-agent
code-review (no parallel sub-agents), Chinese brief notes where helpful.
`dev-assist` is an open-bot entry router pointing at the above.

`coding-edit`、`host-shell` / `host-file-query` / `host-ssh` 纪律加强为 open-bot 自研；行为取向参考常见自主 agent 实践，工具名与产品栈保持 open-bot 自己的。

## Hermes Agent（MIT，Nous Research）

以下技能改编自 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) 的内置 `skills/`（MIT License，许可证全文见 `skills/LICENSE-hermes-agent.txt`）。所有 Hermes 工具名（terminal / read_file / browser_* / delegate_task / cronjob / kanban_* 等）都已改写为 open-bot 工具（`host_*`、`sandbox_*`、`http_fetch`、`secret_http`、`memory_*`、`create_routine`、`send_to_agent`、`load_skill` 等）。路径改为 `~/.open-bot/...`，frontmatter 改为单行 `name` / `description`。每个 SKILL.md 顶部都有来源说明。

**新增技能（改编）：**

- 苹果生态（macOS，`host_shell`）：`apple-notes`、`apple-reminders`、`findmy`、`imessage`、`computer-use`（f-trycua 原作，改写为 osascript / System Events + `host_screenshot`）
- 编码代理与开发：`claude-code`、`codex`、`opencode`、`github`（benbarclay）、`codebase-inspection`、`dogfood`（新增 `scripts/qa_probe.py` Playwright 探针）、`cdp-dom-inspect`（原 inspecting-hermes-desktop-dom，新增 `scripts/cdp_eval.mjs`）、`node-inspect-debugger`、`python-debugpy`、`simplify-code`（灵感来自 Claude Code /simplify）、`spike`（源自 gsd-build/get-shit-done）、`skill-authoring`（原 hermes-agent-skill-authoring，重写为 open-bot 技能编写指南）
- 创作与设计：`architecture-diagram`（Cocoon AI）、`ascii-video` / `manim-video` / `p5js`（SHL0MS）、`baoyu-infographic`（宝玉 JimLiu，[baoyu-skills](https://github.com/JimLiu/baoyu-skills)）、`claude-design`（BadTechBandit）、`design-md`、`humanizer`（Siqi Chen，[blader/humanizer](https://github.com/blader/humanizer)，MIT，见包内 LICENSE）、`popular-web-designs`（设计系统来自 VoltAgent/awesome-design-md）、`songwriting-and-ai-music`
- 邮件 / 消息 / 社交：`email-inbox-triage`（benbarclay）、`himalaya`、`xurl`（xdevplatform + openclaw）
- 媒体：`gif-search`、`songsee`、`youtube-content`
- 笔记与知识：`obsidian`、`llm-wiki`
- 办公与效率：`airtable`、`box`（Chris Kim）、`document-to-action-items` / `meeting-action-items` / `weekly-review-planning` / `product-price-monitor`（benbarclay）、`docx` / `pdf` / `powerpoint` / `xlsx`（包内各附 MIT LICENSE）、`google-workspace`、`maps`（Mibayy）、`notion`、`teams-meeting-transcripts`（原 teams-meeting-pipeline，改为直接调用 Microsoft Graph API + routine 轮询）
- 研究：`arxiv`、`competitor-news-monitor`（benbarclay）、`grounded-citations`
- 网页：`blocked-page-recovery`

**合并进已有技能（作为 `references/`）：**

- `diagnosing-bugs/references/systematic-debugging.md` ← systematic-debugging（上游 obra/superpowers）
- `tdd/references/iron-law.md` ← test-driven-development（上游 obra/superpowers）
- `code-review/references/pre-commit-review.md` ← requesting-code-review（上游 obra/superpowers + MorAlekss）
- `code-review/references/verification-verdict.md` ← sdlc-review（Jakub Wolniewicz；已去掉 Kanban 依赖）

**未移植：** `hermes-agent`（Hermes 自身的 CLI / 配置 / 插件手册）。

## skills.sh curated builtins（默认开启）

清单见 `skills/curated-builtins.json`；锁定版本见 `skills/CURATED.lock`。
刷新：`scripts/sync-curated-builtins.sh`（或按清单里的 `npx skills add …`）。

默认开启（新 Bot / 新账号），**不是** skills.sh 全榜：

- `find-skills` ← vercel-labs/skills (**always_on** discovery entry: always mounted for new bots; disable blocked; **preserve_local** open-bot Settings install UX, sync 不覆盖)
- `generative-ui` ← open-bot first-party（OpenUI 交互式回复；**preserve_local** 公共默认技能，可关）
- `grill-me` / `grill-with-docs` / `improve-codebase-architecture` / `tdd` / `handoff` / `triage` / `prototype` / `domain-modeling` / `teach` / `codebase-design` / `diagnosing-bugs` ← mattpocock/skills（`tdd` 与 `diagnosing-bugs` 保留 open-bot 改编，sync 不覆盖）
- `frontend-design` ← anthropics/skills
- `vercel-react-best-practices` ← vercel-labs/agent-skills

明确不默认：`agent-browser`、`setup-matt-pocock-skills`、`grilling`（并入 grill-me）、`hyperframes*`、reddit/twitter 自动化、`lark-*`。旧 Bot 不做强制回填。
