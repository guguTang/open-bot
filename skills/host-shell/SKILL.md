---
name: host-shell
description: Run local commands on a connected computer via host_shell. Use for on-machine shell work (inspect, build, process) with short output; revise on error. Desktop apps: is-it-installed uses host_open with launch=false; open-by-name uses host_open (default launches). Resolves .app on Mac — not mdfind kMDItemKind. Not for ssh (use host-ssh) or file-summary recipes (use host-file-query).
---

# 本机 Shell

在**已连接的电脑**上用 `host_shell` 跑本地命令。输出保持短；失败就换一条，不要重复同一条命令，不要编造输出。

## 何时 load

用户要在本机执行命令、读写/删除/移动文件，或你需要自行拼命令时。判断某个 App 是否已安装：`host_open` 且 `launch=false`。打开软件：`host_open`（默认会启动）。不必靠本 skill。

- 文件「最大 / 按扩展名 / 最新」等摘要：优先 `load_skill host-file-query`
- 远程 SSH / 远程文件：`load_skill host-ssh`（不要用 `host_shell` 跑 `ssh`/`scp`/`sftp`）
- 改仓库代码且反复改同一处失败：`load_skill coding-edit`

## 基本流程

1. 需要选机时先 `list_machines`，再传 `machine_id`（用户点名用对应且 connected 的；没点名用最常用工作设备）。
2. 本机命令：`host_shell`（自己写；stdout 可能被截断）。
3. 浅层浏览已知小目录：`host_ls`（不要拿它做「最大文件」汇总后再自己排序）。
4. 判断某个 App 是否已安装：`host_open`（传用户说的名字，`launch=false`）。打开软件：同一工具且省略 `launch`（或 `launch=true`）。它会在 Mac 上按名字解析 `.app`。用户只问「有没有」时不要启动。不要用 `mdfind 'kMDItemKind == "Application"'`——Kind 随系统语言本地化（简体中文是「应用程序」），空结果不等于没安装。
5. 看屏幕：`host_screenshot`（图像附在工具结果里）。不要用 `screencapture` 存文件再假装看过。要点、输入、按键、滚动：先 `load_skill computer-use`，用 `host_click` / `host_type` / `host_key` / `host_scroll`。macOS、Windows、Linux 桌面都是同一套工具，不要用 cliclick、osascript、xdotool 或 grim 模拟点击。
6. 删除：`host_delete`（多个文件传 `paths` 一次完成）。用户说再试一次且上一轮是删除时，再次调用 `host_delete`。
7. 写入/移动：`host_write` / `host_move`。

## 输出与失败（纪律）

- 打印短摘要，不要整树 dump。
- **失败**：读错误 → 换命令/换参数/换路径再调；不要重复同一条；不要编造「已成功」或假文件名。
- **空结果或过窄**：先改查询（放宽 glob、换目录、换关键词），再下结论；不要把空输出当成「没有」。
- 工具结果若在**等待**：尚未执行，不要声称已跑完或让用户「去电脑上确认」代替系统确认卡。
- **denied**：用户拒绝，停下来说明。
- 硬危险命令可能直接失败且没有允许卡。
- 没有已连接电脑时先 `list_machines` 并说明需打开桌面应用。

## 确认与安全（摘要）

覆盖、删除、移动、主目录外写入、看起来会改动或有风险的 `host_shell`（包括 `terminal=true`）、远程写入/删除/执行：立刻调用对应工具；由系统 Auto-review / 确认卡处理，你不能自己批准或拒绝。「始终允许」且自动审核开着时，除硬拒绝和用户规则「先询问」外会直接执行。操作仍在目标电脑执行。审核策略在程序里，不在本 skill 里改。

## 长进程 / 交互式程序

`host_shell` 一次一条命令、没有 PTY、不能往 stdin 补输入，stdout 会截断。

- 持续运行的服务、长构建、长测试：`nohup <cmd> > /tmp/<name>.log 2>&1 & echo $!`，之后用 `tail -n 50 /tmp/<name>.log` 轮询；结束用 `kill <pid>`。
- 需要 TTY 或要分步输入的程序（REPL、调试器、交互式 CLI）：`tmux new-session -d -s <name> '<cmd>'`，用 `tmux send-keys -t <name> '<输入>' Enter` 发输入、`tmux capture-pane -p -t <name> | tail -n 40` 看输出；没装 tmux 先告诉用户。
- 能用非交互参数就用（`-y`、`--yes`、`--non-interactive`、`-p`），比 tmux 简单可靠。
- 整体耗时很长的工作用 `defer_work` 放后台，完成后再交付。

## 禁止

- 用 Spotlight 的本地化 Kind（`kMDItemKind == "Application"`）查找 App；查 App 用 `host_open`+`launch=false`，打开用 `host_open`。`mdfind` 为空不能当成没安装
- 用 `host_shell` 跑系统 `ssh` / `scp` / `sftp`
- `terminal=true` 仅用于打开可见本机终端，不要用来拨 SSH
- 用 `sandbox_*` 或记忆冒充本机 Downloads/桌面
- 对用户提及 sandbox / Docker / 容器 / 内部路径
