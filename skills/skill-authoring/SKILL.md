---
name: skill-authoring
description: Author open-bot skill packages (skills/<name>/SKILL.md + references/scripts): frontmatter, structure, tool names, registration. Use when creating or editing a skill.
---

# 编写 open-bot Skill

> 改编自 [Hermes Agent](https://github.com/NousResearch/hermes-agent) `skills/software-development/hermes-agent-skill-authoring`（MIT，Nous Research）。目录结构、加载与注册方式已按 open-bot 实际实现重写。

## 何时用

- 用户要「做一个 skill」「把这套流程沉淀成技能」「改某个 skill」
- 在 open-bot 仓库里新增 / 修改 `skills/` 下的平台技能
- 帮用户打包个人技能（zip / 文件夹）以便在设置里上传

不适用：只是一次性回答问题，不需要沉淀流程。

## Skill 放在哪（两种）

| 类型 | 位置 | 如何生效 |
|------|------|----------|
| **平台技能**（随仓库发布） | 仓库 `skills/<name>/SKILL.md`（**扁平一层**，没有分类子目录；`skills/users/` 是保留目录，不要写） | API 启动时 `SeedGlobalSkillsFromDisk` 把磁盘包写入 Postgres `global_skills` / `global_skill_files`；新用户 `user_skills` 默认启用。管理后台「Skills」页也可导入 / 导出 zip |
| **个人技能** | 只存 Postgres（`user_skill_files`） | 用户在「设置 → Skills」上传文件夹 / zip（`POST /v1/skills/upload`）；名字不能与平台技能重名 |

注意（平台技能）：

- 启动时 **已存在的同名技能不会被覆盖 `SKILL.md`**（`ON CONFLICT DO NOTHING`），只有 `references/`、`scripts/` 每次启动刷新。改了已有技能的 `SKILL.md`，需要在管理后台重新导入该包（或更新数据库行）才会在运行时生效。
- Bot 级启用由 `agent_skills` 决定：Bot 设了显式技能列表时，新技能不会自动出现在该 Bot 上，需要在「设置 → 当前 Bot」打开。
- agent-runtime 每轮按用户重新构建技能目录：数据库版本优先，磁盘上**新名字**的技能会作为兜底直接出现；已存在的技能一律以数据库版本为准。重启 API 才会把新包 seed 进数据库并刷新 `references/` / `scripts/`。

## 包结构与限制

```
skills/<name>/
├── SKILL.md            # 必需
├── references/*.md     # 长资料，按需 load_skill(name, path=...)
├── scripts/*           # 辅助脚本（文本），load_skill 不会执行
└── templates/*         # 模板
```

- 路径段只能用字母、数字、`-`、`_`、`.`；不能有 `..`、绝对路径、隐藏文件。
- 只收文本文件；单文件 ≤ 512 KB，单包 ≤ 128 个文件（运行时磁盘加载上限），上传 zip 总量 ≤ 4 MiB。
- `node_modules/`、`__pycache__/`、二进制、`.DS_Store` 会被跳过或拒绝。

## Frontmatter（必须单行）

```markdown
---
name: my-skill
description: 一句话说清能力 + 触发场景。Use when the user asks for X / Y / 中文触发词.
---
```

- 第一字节就是 `---`，不要空行或 BOM。
- **只写 `name` 和 `description`**，各占一行。open-bot 的解析器是逐行 `key: value`，不支持 YAML 多行（`>` / `|`）或嵌套 `metadata:`；多余字段会被忽略。
- `name`：小写 + 连字符，与目录名一致。
- `description`：每轮都会进系统提示里的技能目录，花的是每轮的 token。写「能力 + 何时用」，包含用户会说的中英文关键词；控制在约 120 字符内（运行时目录还会截断到 `CATALOG_DESC_MAX`）；不要营销词。深搜/安装指引交给 always_on 的 `find-skills`，不必把生态检索写进每个包的 description。
- 没有 `description` 的包不会出现在目录里。

## 正文结构

```
# <标题>
2–3 句：做什么、不做什么、依赖什么。

## 何时用        触发场景 + 不适用场景
## 前提          需要安装的 CLI / 需要的密钥（用 request_secret，不要让用户贴明文）
## 执行方式      在哪执行（用户电脑 host_* / 内部环境 sandbox_* / 纯联网 http_fetch）
## 步骤          编号步骤，每步有可检查的完成标准
## 常见坑
## 验证          怎么证明做成了
```

## 工具名：只用 open-bot 的

| 能力 | 工具 |
|------|------|
| 用户电脑执行命令 | `host_shell`（先 `list_machines`；用法见 `host-shell`） |
| 用户电脑读写 / 移动 / 删除 / 打开 App / 截屏 | `host_read` / `host_write` / `host_move` / `host_delete` / `host_open` / `host_ls` / `host_screenshot` |
| 远程服务器 | `host_ssh_*`（见 `host-ssh`） |
| 内部执行环境 | `sandbox_ensure` / `sandbox_shell` / `sandbox_read` / `sandbox_write` / `sandbox_ls`（产物放 `/workspace/out/` 会显示为附件；对用户不提内部环境） |
| 联网读取 | `http_fetch`；带密钥：`request_secret` + `secret_http` |
| 记忆 | `memory_write` / `memory_recall` |
| 定时 / 事件任务 | `create_routine` / `list_routines` / `update_routine` / `pause_routine` / `resume_routine` / `delete_routine` |
| 长任务放后台 | `defer_work` |
| 交给其它 Bot | `send_to_agent` |
| 读其它技能 | `load_skill(name, path?)` |
| MCP | `mcp__<server>__<tool>`（用户配置了才有） |

只写上表里的工具名。从别的 agent 产品移植技能时，把对方的 shell / 读写文件 / 打补丁 / 搜文件 / 查看技能 / 定时任务等工具名全部换成上表对应项；open-bot 里没有那些名字，模型照抄会调用失败。没有对应工具的能力（看图、浏览器自动化、生成图片）要写清替代方案。

**不要**用 skill 去复活已移除的专用工具（例如本机文件查询统一走 `host_shell`，见 `host-file-query`）。

## 写作原则

1. 每一行都要改变行为；「注意安全」「遵循最佳实践」这类无效句删掉或换成可检查标准。
2. 详细资料放 `references/`，SKILL.md 只放流程和路由，正文尽量 100–200 行。
3. 规则和它管的概念放在一起。
4. 对外可见 / 不可逆操作（发消息、发邮件、发帖、push、删除、付款）必须写明「先给用户确认」。
5. 不要写机器本地绝对路径（`/Users/<你>/...`）；用 `~/`、仓库相对路径或占位符。
6. 不要做只有路由表的「索引技能」，除非像 `dev-assist` 那样是明确的入口。
7. 先搜现有技能，能扩展就不要新建重复技能（`ls skills/`、`rg -l <关键词> skills/`）。

## 流程

1. **调研**：`host_shell` 跑 `ls skills/` 与 `rg -n "<关键词>" skills/*/SKILL.md`，读 2–3 个相近技能对齐风格。完成标准：确认没有重复技能或决定合并到哪个。
2. **起草**：`host_write` 写 `skills/<name>/SKILL.md`（以及 references / scripts）。
3. **校验**（在仓库根目录 `host_shell`）：

   ```bash
   python3 - <<'PY'
   import re, pathlib, sys
   for p in pathlib.Path("skills").glob("*/SKILL.md"):
       t = p.read_text(encoding="utf-8")
       assert t.startswith("---\n"), p
       fm = t.split("\n---", 1)[0]
       assert re.search(r"^name: \S+", fm, re.M), f"{p}: name"
       assert re.search(r"^description: .+", fm, re.M), f"{p}: description"
   print("ok")
   PY
   ```

4. **测试**：仓库有技能目录相关断言时（`services/agent-runtime/tests/`、`services/api/internal/db/*_test.go`），跑对应测试。
5. **生效**：平台技能需重启 API（新技能会被 seed）；已有技能改 `SKILL.md` 需管理后台重新导入。个人技能：打包成 zip 让用户在设置里上传。
6. **提交**：只有用户明确要求时才 commit / push。

## 验证清单

- [ ] `skills/<name>/SKILL.md` 存在，第一行 `---`
- [ ] frontmatter 只有单行 `name` / `description`，name 与目录一致
- [ ] description 含能力与触发词，长度合理
- [ ] 正文只出现 open-bot 工具名；缺失能力写了替代方案
- [ ] 文件名/路径合法，文件数与大小在限制内
- [ ] 外发 / 删除 / 付款类动作写了「先确认」
- [ ] 相关测试通过；说明了生效方式（重启 API / 重新导入 / 上传）
