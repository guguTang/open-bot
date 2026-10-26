# Open Bot

多端 AI 助手：Web / 桌面 / 移动，多 Bot 协作，技能、记忆、本机能力与微应用工具。

面向想自己掌控助手体验的个人与小团队——聊天、长任务、例行提醒、接本机与沙箱执行环境，以及可固定复用的「我的工具」。

> 开发、架构、环境变量与验收命令见 **[docs/技术架构与开发.md](docs/技术架构与开发.md)**。  
> 日常起服务见 **[docs/本地启动.md](docs/本地启动.md)**。

## 主要功能

1. 💬 **流式对话** — 多会话、打断/停止、刷新后续上看流；群聊 @ 与多助手协作。
2. 🧠 **Agent 能力** — Skills、记忆召回、上下文压缩、MCP 工具、人设可配。
3. 🖥️ **多端一致** — Web；桌面（Tauri）；移动（Capacitor 壳 + React Native 路线）。
4. 🛠️ **我的工具（微应用）** — 对话里生成/保存 UI 小工具，固定到「我的工具」与可选聊天快捷；能力授权与 park/resume。
5. ⏰ **例行任务** — cron Routines，到点在会话里交付。
6. 💻 **本机与运行环境** — 经确认操作本机；另有隔离的沙箱执行环境（对用户文案称「运行环境」，勿说 sandbox/容器）。
7. 🔐 **账号与管理** — 登录鉴权；可选多用户/组织与业务管理端。
8. 🔌 **开放接口** — OpenAI 兼容模型连接；MCP；A2A 适配（演示级）。

## 快速开始

完整步骤、端口与排障见 **[docs/本地启动.md](docs/本地启动.md)**。最短路径：

```bash
cp .env.example .env   # 填入 OPENAI_*、DATABASE_URL、JWT_SECRET
make compose-postgres  # 或 make compose-up / make compose-all
make dev-runtime       # :8001
make dev-api           # :18080
make dev-web           # :5173
```

- 桌面：`make dev-desktop`（需先起 runtime + api）
- 管理端：`make dev-admin`（:5174）
- 移动与沙箱：见本地启动文档

## 支持的客户端

| 端 | 说明 |
|------|------|
| Web | `apps/web`，日常开发主界面 |
| 桌面 | Tauri 2，复用 Web |
| 移动（壳） | Capacitor，复用 Web 构建产物 |
| 移动（原生） | Expo + HeroUI Native，独立 UI |
| 管理端 | 运营向，与用户端登录分离 |

## 模型与扩展

| 类型 | 说明 |
|------|------|
| LLM | OpenAI 兼容（含本地/网关）；设置里可配多条连接 |
| MCP | 用户可配 stdio / SSE / HTTP servers |
| Skills | Agent Skills 格式；可上传自定义技能 |
| 微应用 | draft → bundle → pin；修改走同 id 覆盖 |

## 文档

| 文档 | 内容 |
|------|------|
| [本地启动](docs/本地启动.md) | 依赖、三进程、桌面/移动/沙箱、常见问题 |
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
