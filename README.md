# open-bot

接近 Grok Bot 体验的多端 AI 助手（Web / 桌面 / 移动）。

## 已拍板架构

- **前端**：React + TypeScript + Vite；桌面 Tauri 2；移动两条路线并行——`apps/mobile` 为 Capacitor 壳（复用 web），`apps/mobile-rn` 为 React Native + Expo + HeroUI Native 原生实现
- **产品 API**：Go（鉴权、会话、SSE、多助手、LLM 连接）
- **Agent 运行时**：Python（Skills、Memory、Compaction、OpenAI 兼容）
- **存储**：PostgreSQL（用户 / LLM 连接 / 会话消息 / 助手人设）
- **协议**：MCP Client（stdio/sse/http）；技能格式 [Agent Skills](https://agentskills.io)

详情见 [docs/技术方案.md](docs/技术方案.md)、[docs/目录说明.md](docs/目录说明.md)。

## E2E 测试

用户端 + 管理端 Playwright 套件：见 **[docs/e2e.md](docs/e2e.md)**。

```bash
make e2e-install   # 一次性
make e2e           # 需 API/web/admin/runtime 已起；默认 mock LLM
```

## Phase 1 本地启动

> 完整步骤、端口、冒烟与常见问题见 **[docs/本地启动.md](docs/本地启动.md)**。

依赖：Go 1.22+、Python 3.11+、Node/pnpm、Docker（Postgres）；桌面另需 Rust（rustup）+ Xcode CLT；移动另需 Xcode（iOS）/ Android Studio（可选）。

```bash
# 1) Docker 依赖
make compose-postgres   # 最小：只要 Postgres
# 或：make compose-up     # core：Postgres / Redis / MinIO
# 或：make compose-all    # core + Casdoor + Langfuse（一次全起）
# 入口：deploy/compose.yaml（详见 deploy/README.md、docs/本地启动.md）
# 镜像：pgvector/pgvector:pg16（含 vector 扩展）
# 若从官方 postgres 升级：开发环境可 make compose-down && docker volume rm deploy_openbot_pg
# 默认连接串：postgres://openbot:openbot@127.0.0.1:5432/openbot?sslmode=disable

# 2) 环境变量
cp .env.example .env
# 编辑 .env：OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
# 以及 DATABASE_URL、JWT_SECRET
# 可选：COMPACT_*（上下文压缩：token 预算为主，消息/字符数为兜底；见 .env.example）

# 3) 三个进程
make dev-runtime   # http://127.0.0.1:8001
make dev-api       # http://127.0.0.1:18080
make dev-web       # http://127.0.0.1:5173（桌面/ Tauri 要求固定 5173）
make dev-admin     # http://127.0.0.1:5174（业务管理端，与 web 分离）
```

### 桌面端（Tauri 2，复用 apps/web）

先确保 Postgres + `make dev-runtime` + `make dev-api` 已启动，再：

```bash
make dev-desktop
# 或：pnpm --dir apps/desktop tauri dev
```

- 窗口：标题 Open Bot，默认约 1200×800，深色背景
- API：与 Web 相同，默认 `http://127.0.0.1:18080`；用 `.env` 的 `VITE_API_BASE` 覆盖
- 构建：`make check-desktop` / `pnpm --dir apps/desktop tauri build --debug`
- 说明见 [apps/desktop/README.md](apps/desktop/README.md)；本轮不做签名公证与自动更新




### 移动端（Capacitor 7，复用 apps/web/dist）

先确保 Postgres + `make dev-runtime` + `make dev-api` 已启动。

```bash
make build-web       # 产出 apps/web/dist
make sync-mobile     # cap sync → ios/ & android/
make dev-mobile-ios  # 打开 Xcode（需本机 Xcode + CocoaPods）
# Android：make open-mobile-android（需 Android Studio）
```

- **不复制 UI**：`capacitor.config.ts` 的 `webDir` 指向 `../web/dist`
- API：默认 `http://127.0.0.1:18080`；**模拟器**可直连宿主机；**真机**请把 `VITE_API_BASE` 改成电脑局域网 IP 后重新 build + sync
- Live reload（仅模拟器）：`CAP_LIVE_RELOAD=1 make sync-mobile`（`server.url` → `http://127.0.0.1:5173`；真机改 `CAP_SERVER_URL`）
- 说明见 [apps/mobile/README.md](apps/mobile/README.md)；本轮不做上架、推送证书、原生插件大集合


### 移动端（React Native / Expo + HeroUI Native，`apps/mobile-rn`）

与上面的 Capacitor 壳并存的两条路线：这条是原生实现，自己写 UI，只复用后端契约。

```bash
cp apps/mobile-rn/.env.example apps/mobile-rn/.env   # 真机必须改局域网 IP
make dev-mobile-rn      # 等价于 cd apps/mobile-rn && pnpm start
```

- **流式**用 `expo/fetch`（RN 内置 fetch 拿不到 `response.body`），SSE 解析器逐行移植自 Web 端
- Token 存 `expo-secure-store`（Keychain / Keystore）
- iOS 模拟器需完整 Xcode；没装 Xcode 就用真机 + Expo Go
- 说明见 [apps/mobile-rn/README.md](apps/mobile-rn/README.md)


### 沙箱电脑（Phase 1）

```bash
make sandbox-image   # 构建 openbot-sandbox:dev
# 设置 → 沙箱电脑；或 curl JWT /v1/sandbox/ensure + /exec
```

详见 [docs/沙箱电脑.md](docs/沙箱电脑.md)。环境变量：`SANDBOX_ENABLED` / `SANDBOX_IMAGE` / `SANDBOX_DATA_ROOT` / `SANDBOX_MEMORY_MB` / `SANDBOX_CPUS`。

### 环境变量要点

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Postgres 连接串 |
| `JWT_SECRET` | HS256 密钥（开发可有默认值，生产必改） |
| `API_ADDR` | 默认 `:18080`（避开本机 8080） |
| `AGENT_RUNTIME_URL` | 默认 `http://127.0.0.1:8001` |
| `OPENAI_*` | 注册用户时种子默认 LLM；也可在 Web「设置」里改 |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` / `EMBEDDING_DIM` | 记忆语义召回（默认 bge-m3 @ `:30603`，dim=1024；与 enigma config_34 对齐） |
| `A2A_TOKEN` | 可选；设置后 Agent Card / `/a2a/v1` 需 Bearer 或 `X-A2A-Token` |
| `A2A_PUBLIC_BASE` | 可选；Agent Card 中的对外 base（默认从请求 Host 推断） |
| `VITE_API_BASE` | Web/桌面/移动前端 API 地址，默认 `http://127.0.0.1:18080`；真机改为局域网 IP |

### 已实现能力

- 注册 / 登录（JWT Bearer）
- 每用户多条 LLM 连接（脱敏列表、设默认、可选上下文窗口 tokens）；发消息时覆盖 runtime；压缩按 token 预算触发
- 会话 / 消息持久化到 Postgres（重启 API 不丢）
- 助手人设：用户可建可改可删（`system_prompt` 注入 runtime；无内置助手，启动时 purge `is_builtin`）
- 记忆按 `user_id` 分文件隔离
- Web：登录页、聊天、LLM 设置、会话列表、MCP 设置
- MCP Client：用户可配置 servers；测试连接列出工具；手动 call-tool；tools 开启时注入 LLM tool loop
- 自定义 Skill 上传（设置→Skills）；与全局技能合并，按启用集注入 runtime
- 记忆语义召回：pgvector + embedding；不可用时关键词降级
- A2A 适配层：Agent Card + JSON-RPC `message/send`（演示用，非完整协议栈）
- Routines：cron 例行任务（API 内嵌调度 + Web 设置页）
- 桌面壳：Tauri 2（`apps/desktop`，复用 `apps/web`；`make dev-desktop`）
- 移动壳：Capacitor 7（`apps/mobile`，复用 `apps/web/dist`；`make sync-mobile` / `make dev-mobile-ios`）
- 移动端（原生）：Expo + HeroUI Native（`apps/mobile-rn`）：登录、助手列表、SSE 流式聊天页

### 快速验收

```bash
# 未登录应 401
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/v1/agents

# 注册并拿到 token
REG=$(curl -s -X POST http://127.0.0.1:18080/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo1","password":"pass1234"}')
TOKEN=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<<"$REG")

curl -s http://127.0.0.1:18080/v1/llm-connections -H "Authorization: Bearer $TOKEN"

AGENT=$(curl -s -X POST http://127.0.0.1:18080/v1/agents \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"demo","description":"验收助手","system_prompt":"你是助手，默认中文。"}')
AID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$AGENT")

CONV=$(curl -s -X POST http://127.0.0.1:18080/v1/conversations \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"agent_id\":\"$AID\",\"title\":\"demo\"}")
CID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$CONV")

curl -N -X POST http://127.0.0.1:18080/v1/conversations/$CID/messages \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"你好"}'
```

### 添加示例 MCP（echo）

```bash
# 1) 确保 agent-runtime venv 已装 mcp（make / pip install -r requirements.txt）
# 2) Web → 设置 → MCP →「填入 echo 示例」→ 新增 →「测试连接」
#    或 API：
TOKEN=...  # 登录后 JWT
curl -s -X POST http://127.0.0.1:18080/v1/mcp-servers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name":"echo",
    "transport":"stdio",
    "command":"'"$(pwd)"'/services/agent-runtime/.venv/bin/python",
    "args":["'"$(pwd)"'/services/agent-runtime/examples/mcp_echo_server.py"],
    "enabled":true
  }'
```

### 构建

```bash
cd services/api && go build -o /tmp/openbot-api ./cmd/api
pnpm --dir apps/web build
make check-desktop   # 或：pnpm --dir apps/desktop tauri build --debug
make sync-mobile     # Capacitor：build-web + cap sync
```

### 自定义 Skill 上传

```bash
TOKEN=...  # 登录 JWT
curl -s -X POST http://127.0.0.1:18080/v1/skills/upload \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"tea-timer","description":"安排泡茶步骤与计时。","body_markdown":"## 步骤\n1. 烧水\n2. 温杯"}'
# 仅可删除自建：
curl -s -X DELETE http://127.0.0.1:18080/v1/skills/tea-timer -H "Authorization: Bearer $TOKEN"
```

Web：设置 → Skills → 填写 name/description/正文 → 上传并启用。

### 记忆语义召回

`.env` 配置 `EMBEDDING_*`（enigma config_34：`http://192.168.5.34:30603/v1` + `bge-m3`）。写入记忆时生成 `vector(1024)`；`GET /v1/memories?q=...` 优先余弦召回，失败则关键词。

### A2A 适配层（演示）

> 适配层：不是完整 A2A 认证与流式任务生命周期。

```bash
# Agent Card
curl -s http://127.0.0.1:18080/.well-known/agent-card.json | head
# ?agent_id= 需为 A2A 系统用户下已有助手 UUID；省略则取该用户第一个助手
curl -s 'http://127.0.0.1:18080/.well-known/agent-card.json?agent_id=<AGENT_UUID>'

# message/send（同步简化 Task；需本机 Qwen/LLM + runtime；可省略 agent_id）
curl -s -X POST http://127.0.0.1:18080/a2a/v1   -H 'Content-Type: application/json'   -d '{
    "jsonrpc":"2.0","id":1,"method":"message/send",
    "params":{
      "message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"用一句话介绍你自己"}]}
    }
  }'
```

若配置了 `A2A_TOKEN`，加上 `-H "Authorization: Bearer $A2A_TOKEN"` 或 `-H "X-A2A-Token: $A2A_TOKEN"`。

### Routines（例行任务）

Web：设置 → Routines。或 API：

```bash
TOKEN=...  # 登录 JWT
curl -s -X POST http://127.0.0.1:18080/v1/routines   -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'   -d '{"name":"晨间简报","prompt":"用三句话给我今日简报","schedule_cron":"0 9 * * *","enabled":true}'

curl -s -X POST http://127.0.0.1:18080/v1/routines/<id>/run   -H "Authorization: Bearer $TOKEN"
```

调度器仅在 **api 进程**内每分钟 tick；生产多副本需另行防重入。
