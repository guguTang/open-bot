# api (Go)

对外产品 API：会话内存存储、CORS、SSE 代理到 Python runtime；并代理 skills / memories。

```bash
export AGENT_RUNTIME_URL=http://127.0.0.1:8001
export API_ADDR=:18080
go run ./cmd/api
```

生产镜像（含 `openbot-worker`）从仓库根构建：`make image-api`。发布到 GHCR 的 tag 见 [docs/release.md](../../docs/release.md)。

主要路由：

- `GET /healthz`
- `GET /v1/agents`
- `GET /v1/skills`（代理 runtime）
- `GET|POST /v1/memories`（代理 runtime）
- `POST /v1/conversations`
- `GET|POST /v1/conversations/{id}/messages`
- `POST /v1/conversations/{id}/cancel`（停止该会话进行中的 SSE 生成；与客户端 AbortController 协作）

发送消息时，Go 会把当前会话 `messages` + `agent_id` + `content` 一并 POST 到 runtime `/v1/runs`。客户端断开或 cancel 会取消 runtime 请求，并尽量落库已生成的部分 assistant 文本（空取消写「（已停止）」）；`cancel` / 同会话新 send 会短暂等待上一轮 flush（keep-partial-next-turn）。

附件里的 PDF/DOCX/XLSX/PPTX 在 `DOC_PARSE_URL` 指向 MarkItDown（本机 `http://127.0.0.1:8010`，compose 网络内 `http://markitdown:8010`）时抽成 Markdown 再写入 user 消息。变量为空则不请求，提示未配置解析服务。见 `docs/附件文档解析-MarkItDown.md`。

## A2A gateway

- `GET /.well-known/agent-card.json`（`?agent_id=` 可选）
- `POST /a2a/v1` JSON-RPC：`message/send`、`message/stream`、`tasks/get`、`tasks/cancel`、push config
- 可选 `A2A_TOKEN`；系统用户 `__a2a__`；Task 持久化见 `docs/a2a-adapter.md`

## Routines

- 表 `routines` / `routine_runs`
- JWT：`GET/POST /v1/routines`，`PATCH/DELETE /v1/routines/{id}`，`POST /v1/routines/{id}/run`
- 进程内每分钟调度（robfig/cron 5 字段）
