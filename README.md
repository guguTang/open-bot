# Open Bot

多端 AI 助手：Web / 桌面 / 移动，多 Bot 协作，技能、记忆、本机能力与微应用工具。

面向想自己掌控助手体验的个人与小团队——聊天、长任务、例行提醒、接本机与运行环境，以及可固定复用的「我的工具」。

> 开发、架构、环境变量与验收命令见 **[docs/技术架构与开发.md](docs/技术架构与开发.md)**。  
> 日常起服务见 **[docs/本地启动.md](docs/本地启动.md)**。

## 主要功能

### 对话与协作

- 流式对话：多会话、打断/停止、刷新后继续上看流
- 群聊 `@` 与多助手协作；对话线程（回复）
- 长任务：先确认再后台执行，结果仍交回同一会话

### Agent 智能

- **Skills**：遵循 [Agent Skills](https://agentskills.io) 格式；可启用、上传自定义技能
- **记忆**：自研 MemoryStore（profile / log / note + pgvector）+ [Mem0](https://github.com/mem0ai/mem0) OSS 自动抽取与召回
- **上下文压缩（Compaction）**：运行时自研摘要压缩，近轮原文保留
- **MCP**：可配 stdio / SSE / HTTP 工具服务器（官方 Python SDK）
- 人设可配；岗位引导与复制助手

### 多端客户端

- Web（日常开发主界面）
- 桌面：[Tauri 2](https://github.com/tauri-apps/tauri)，复用 Web
- 移动壳：[Capacitor](https://github.com/ionic-team/capacitor)，复用 Web 构建产物
- 移动原生：Expo + HeroUI Native（独立 UI 路线）

### 我的工具（微应用）

- 对话里生成 / 保存 UI 小工具，固定到「我的工具」与可选聊天快捷
- 能力授权与 park / resume；修改走同 id 覆盖

### 例行任务

- cron Routines：到点在会话里交付；支持时区、重试、暂停/恢复
- 产品调度逻辑自研；cron 表达式解析使用 [robfig/cron](https://github.com/robfig/cron)

### 本机与运行环境

- 经确认操作本机（列表机器、执行命令等）
- 另有隔离的**运行环境**供助手执行（对用户文案称「运行环境」）
- 附件文档解析（compose core）：[MarkItDown](https://github.com/microsoft/markitdown)

### 账号与管理

- 登录鉴权；可选多用户 / 组织与业务管理端
- 可选身份：[Casdoor](https://github.com/casdoor/casdoor)（`compose-all`）

### 开放接口

- OpenAI 兼容模型连接（含本地 / 网关）；设置里可配多条
- MCP 工具接入
- A2A：演示级协议适配（非完整官方栈）

## 关键开源组件

事实以仓库已用依赖为准。部分能力为「自研 + 开源」组合，见备注。

| 能力 | 项目 | 仓库 / 文档 |
|------|------|-------------|
| Agent 编排 | LangGraph（含 langgraph-checkpoint-postgres） | https://github.com/langchain-ai/langgraph |
| 长期记忆 | MemoryStore（自研）+ Mem0 OSS（mem0ai） | https://github.com/mem0ai/mem0 |
| 技能格式 | Agent Skills | https://agentskills.io |
| MCP | 官方 Python SDK `mcp` | https://github.com/modelcontextprotocol/python-sdk |
| 例行任务 cron 解析 | robfig/cron（产品调度逻辑自研） | https://github.com/robfig/cron |
| 可观测（可选 compose） | Langfuse | https://github.com/langfuse/langfuse |
| 可选登录 | Casdoor | https://github.com/casdoor/casdoor |
| 文档解析（compose core） | MarkItDown | https://github.com/microsoft/markitdown |
| 桌面 | Tauri 2 | https://github.com/tauri-apps/tauri |
| 移动壳 | Capacitor | https://github.com/ionic-team/capacitor |

> **记忆** = 自研 MemoryStore + Mem0；**例行任务** = 产品自研调度 + robfig/cron 表达式解析；**上下文压缩**为运行时自研，未绑定第三方压缩框架。

## 快速开始

完整步骤、端口与排障见 **[docs/本地启动.md](docs/本地启动.md)**。最短路径：

```bash
cp .env.example .env   # 填入 OPENAI_*、DATABASE_URL、JWT_SECRET
make compose-postgres  # 日常最小：只要 Postgres
# make compose-up      # core：Postgres + Redis + MinIO + 文档解析（:8010）
# make compose-all     # core + Casdoor + Langfuse（一次全起）
make dev-runtime       # :8001
make dev-api           # :18080
make dev-web           # :5173
```

- 桌面：`make dev-desktop`（需先起 runtime + api）
- 管理端：`make dev-admin`（:5174）
- 移动与运行环境：见本地启动文档

## 支持的客户端

| 端 | 说明 |
|------|------|
| Web | `apps/web`，日常开发主界面 |
| 桌面 | Tauri 2，复用 Web |
| 移动（壳） | Capacitor，复用 Web 构建产物 |
| 移动（原生） | Expo + HeroUI Native，独立 UI |
| 管理端 | 运营向，与用户端登录分离 |

## 文档

| 文档 | 内容 |
|------|------|
| [本地启动](docs/本地启动.md) | 依赖、三进程、桌面/移动/运行环境、常见问题 |
| [技术架构与开发](docs/技术架构与开发.md) | 栈、目录、环境变量、构建与验收（原根 README） |
| [技术方案](docs/技术方案.md) | 选型与架构说明 |
| [目录说明](docs/目录说明.md) | 仓库结构 |
| [产品功能与完成度](docs/产品功能与完成度.md) | 功能对照表 |
| [微应用架构](docs/micro-app-architecture-v1.md) | 微应用 Phase 与授权 |
| [多用户与管理端](docs/多用户与管理端.md) | 组织与 Admin |
| [缺口与下一批](docs/缺口与下一批.md) | 已知缺口 |

## 参与贡献

欢迎 Issue / PR。较大功能请先开 Issue 对齐产品与范围。开发环境与代码边界见 [技术架构与开发](docs/技术架构与开发.md)、[目录说明](docs/目录说明.md)。

---

*陪伴与能力不必二选一：既能聊得下去，也能把事做完。*
