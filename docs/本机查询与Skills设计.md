# 本机查询：host_ls vs host_shell vs Skill 脚本（设计草案）

> 状态：**A+B+C+D + Auto-review 档位已落地**（提示词路由、`skills/host-file-query`、收窄 `host_ls`、默认自动放行（无命令白名单）+ 风险确认 + 硬拒绝，对齐 Grok）。
> 对齐 Cursor Grok Bot（`ListMachines` + 本机 Shell/Read；Skills 可带 `scripts/`）。
> 相关实现：`apps/desktop/.../host_fs.rs`、`host_cmd.rs`；runtime `llm.py` / `client_env.py` / `deferral.py`；`skills/host-file-query/`。

## 现状（代码为准；部分旧文档仍写 stub）

| 工具 | 作用 | 紧凑性 / 限制 |
|------|------|----------------|
| `list_machines` | 已登记电脑 + `connected` | 小 |
| `host_ls` | 浅层列目录 | 默认 **50**（最大 200）；`sort`=`mtime|size|name`；可选 `glob`；响应含 `total`/`truncated` |
| `host_read` | 读文本 | ≤200KB |
| `host_shell` | 本机命令（`sh -c`） | 输出 **≤4000 字**；120s；无命令白名单，**看起来会改动或有风险才确认**，硬拒绝始终有效；`terminal=true` 确认；禁 ssh/scp/sftp |
| `host_screenshot` | 截取已连接桌面（macOS / Windows / Linux）或单个窗口并把图像交给模型 | 只读，默认自动放行；返回 `frame_id` + 图像像素宽高；`scope=all` 不能用来点击；`window_id` 可截单窗且可点击 |
| `host_click` / `host_type` / `host_key` / `host_scroll` / `host_mouse_move` / `host_drag` | 按截图像素或 `element_ref` 操作界面 | 变更操作，内置确认；必须带未过期的 `frame_id`（或 `element_ref`）；先 `load_skill computer-use`。三套系统同一工具名 |
| `host_list_windows` / `host_ax` | 列出窗口、读辅助功能树（AX / UI Automation / AT-SPI） | 只读自动放行；`element_ref` 给点击/输入用 |
| `host_tcc_status` | 屏幕录制 / 辅助功能 / 发送事件是否可用 | 只读自动放行；Windows 没有单独的屏幕录制开关，Linux 看 X11 与 AT-SPI |
| `host_ssh_*` | 远程（先 `load_skill host-ssh`） | 与上类似 |
| `load_skill` | 加载 `SKILL.md` / `scripts/` **内容** | **不自动执行**脚本；模型再经 `host_shell` / `sandbox_*` 跑 |

Skills 包可含 `scripts/`（例：`diagnosing-bugs/scripts/`），但产品侧没有「skill 脚本直接当工具跑」的通道。

### 核心缺口

1. ~~提示词反模式~~：**已改**——聚合查询走 `host-file-query` + `host_shell`；`host_ls` 仅浅层浏览。
2. ~~`host_ls` 语义过弱~~：**已收窄**——更小默认 limit、可选 sort/glob、标记 truncated。
3. ~~Skill 脚本未产品化~~：**已加** `skills/host-file-query`（`largest-by-size` / `largest-by-ext` / `list-by-ext`）。

## 设计原则（同意用户论点）

- **聚合/筛选/排序 → 在本机算完，只回摘要**（对齐 Grok：`ListMachines` 选机 + Shell）。
- **`host_ls` 收窄为浅层浏览**，不再作为「找最大 / 哪些 mp4」的默认路径。
- **两条推荐路径**（可并存）：
  1. **Skill + 脚本**：常见任务有固定、可审的命令；
  2. **LLM 生成 shell → `host_shell`**：长尾查询，仍返回紧凑 stdout。

## 何时用什么

| 意图 | 推荐 | 避免 |
|------|------|------|
| 有哪些电脑 / 哪台在线 | `list_machines` | — |
| 打开某目录随便看看（条目少） | `host_ls`（可加 limit/sort/glob，见下） | 把整个 Downloads dump 进上下文 |
| 最大文件、按扩展名、前 N、磁盘占用 | **`host_shell`** 或 **skill 脚本** | 依赖 `host_ls` 再在模型侧排序 |
| 读/改单个已知路径 | `host_read` / `host_write`… | 用 ls 猜路径后整目录搬进上下文 |
| SSH 远程 | `load_skill host-ssh` → `host_ssh_*` | `host_shell` 跑 ssh |
| 看桌面屏幕并点击 / 输入 | `load_skill computer-use` → `host_screenshot` 再 `host_click` 等 | `osascript` / `cliclick` / `xdotool` / 把截图存成文件 |

## 示例 Skill（草案名 `host-file-query`）

`SKILL.md` 要点：

- 何时 load：用户问「最大的 / 哪些 mp4 / 下载里占空间」等。
- 流程：`list_machines`（若需选机）→ `load_skill` 取脚本 → `host_shell` 执行（或把脚本内容内联为一条只读命令）。
- 禁止：为回答「最大」而多次/整树 `host_ls`。

示例 `scripts/largest-by-ext.sh`（思路，非定稿）：

```bash
#!/usr/bin/env bash
# Usage: largest-by-ext.sh <dir> <ext> [n]
set -euo pipefail
DIR="${1:-$HOME/Downloads}"; EXT="${2:-mp4}"; N="${3:-10}"
find "$DIR" -type f -iname "*.${EXT}" -print0 2>/dev/null \
  | xargs -0 stat -f '%z %N' 2>/dev/null \
  | sort -nr | head -n "$N" \
  | awk '{ printf "%.1fMB\t%s\n", $1/1024/1024, substr($0, index($0,$2)) }'
```

（Windows 另附 PowerShell 变体或 skill 内注明仅 macOS/Linux。）

## 提示词 / 工具描述改动（实现时）

1. **删除/改写**「必须 host_ls」；改为：
   - 聚合查询 → `host_shell` 或相关 skill 脚本，**只汇报摘要行**；
   - `host_ls` → 浅层列举、已知小目录、需要条目元数据且预期条目不多时。
2. `host_ls` description：写明「非排序/筛选/递归汇总工具；大目录请用 host_shell」。
3. `host_shell` description：点名适合 `find`/`du`/`stat` 等只读汇总（无白名单：未命中风险模式则免确认，见下）。
4. Skills 目录加一条 `host-file-query`（或并入现有 host 相关 skill）。

## 安全 / 确认策略（Grok Bot 对齐 · Auto-review）

对齐 Cursor Grok Bot：**确定性规则门禁，不用对话 LLM 自行批准/拒绝。**

| 档位 `review_tier` | 含义 | 典型例子 |
|--------------------|------|----------|
| **auto** | 自动放行，不弹确认卡 | 只读 op；`host_shell` 未命中风险模式。**并且**当 Auto-review 开且该机 `exec_policy=allow`（始终允许）时，内置 confirm（写/删/移、风险 shell、远程写/删/exec、terminal）也改为 auto，不弹确认卡。用户规则「先询问」命中时仍是 confirm |
| **confirm** | 对话确认卡（任意已登录端可点「允许/拒绝」）；卡上展示 `reason` | 内置档：写/删/移、`terminal=true`、全部 `host_ssh_write|delete|exec`；shell 看起来会改动或有风险（重定向、`rm`/`mv`/`cp`、`chmod`、`sudo`、`git push`、装包、命令替换、`find -delete`、非只读 `find -exec`）。**仅当** Auto-review 关、`exec_policy=ask`、或用户规则「先询问」命中时才真正弹卡。`exec_policy=allow` 且自动审核开着时这些不弹卡 |
| **deny** | Auto-review **硬拒绝**（不弹允许卡、不执行） | `curl\|sh` / 管道进 shell、`rm -rf /`、fork bomb、`mkfs`、写块设备、`dd if=` |

实现：`classifyHostExecReview` — `services/api/.../host_exec_review.go` 与 `apps/web/src/lib/hostExec.ts` 镜像（硬拒绝 → 风险确认 → 其余 auto）。没有正向命令白名单。

- **设置（通用 → Bot）**：
  - **时区**：可自动检测或选 IANA（如 Asia/Shanghai）；写入 `user_settings`，聊天 `client.timezone` / 环境块可见。
  - **自动审核**（默认开）：关则除硬 deny 外一律 confirm。开则先走内置 deny/auto/confirm，再套用户 NL 规则（「先询问」优先于「自动允许」；**不能**覆盖硬 deny）。匹配为关键词/意图（op + 命令预览 + reason），**不是**对话 LLM 自行批准。
  - **自动审核规则**：`当 bot 想要:` + `它应该: 自动允许|先询问`；仅对当前用户；文案提示内置安全检查始终有效。
- **设置（电脑）**：
  - **当前电脑**：可改名并保存（沿用 `PATCH /v1/machines/{id}` label）。
  - **在这台电脑上执行**：`exec_policy` = `allow`（始终允许：不弹确认卡，硬拒绝仍失败，用户规则「先询问」仍确认）/ `ask`（每次询问）/ `deny`（不允许）。服务端与桌面 WS 闸都会执行，避免桌面再弹一次。
- 硬 deny 始终有效，不受自动审核开关 / 用户规则 / exec_policy=ask 影响；`exec_policy=deny` 在审核前直接拒绝。
- Skill 脚本内容经 `load_skill` 可见。`host_shell` 只看命令行：heredoc/重定向在内置档是 confirm，但 `exec_policy=allow` 且自动审核开着时不弹卡；命令行本身无风险模式则 auto（不扫描脚本正文）。
- 继续截断 stdout（~4k）；`host_ls` 默认 50 + `truncated`/`total`。

## 实现阶段

| 阶段 | 内容 | 风险 |
|------|------|------|
| **A 文档+提示词** | ✅ 改 `client_env` / tool description / deferral；本设计文档 | 低 |
| **B Skill 脚本** | ✅ `host-file-query` + `largest-by-size` / `largest-by-ext` / `list-by-ext` | 低 |
| **C 收窄 host_ls** | ✅ `limit`/`sort`/`glob`；默认 50；响应 `truncated`/`total` | 中（兼容） |
| **D 只读 shell 放行** | ✅ 改为无白名单 auto（风险模式才 confirm）+ 测试；桌面设置项可关 | 中高（安全面） |
| **D′ Auto-review 档位** | ✅ `auto`/`confirm`/`deny` + `reason` 确认卡；硬拒绝模式；文档 | 中（策略清晰化） |
| **D″ 用户设置 + 电脑策略** | ✅ 通用→Bot 时区/自动审核/NL 规则；电脑→当前机改名 + exec_policy；API `GET/PUT /v1/me/settings` | 中 |

不建议新增与 `host_shell` 重复的 `host_exec` 名称；对外统一 `host_shell`，对内已是 `op=shell`。

## 验收场景（实现后）

1. 「下载里最大的 mp4」→ 不出现数百条 `host_ls` entries；工具结果为十余行摘要。
2. 「随便看看桌面有什么」→ 可用 `host_ls`。
3. 无已连接电脑 → 仍如实说明，不编造。
4. `host_shell` 普通危险命令 → 仍出确认卡（带 reason）。
5. `curl|sh` / `rm -rf /` → **硬拒绝**，不出「允许」卡。
