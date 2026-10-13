# 附件文档解析（MarkItDown）

聊天上传的 PDF / DOCX / XLSX / XLS / PPTX 在**发送消息**时抽成 Markdown。抽取结果只注入当次模型/runtime 输入（ephemeral），**不写进会话里持久化的 user 消息**；聊天界面仍只显示用户原话与附件元数据。没有向量库，也没有检索。

## 架构

```
上传 → Go API 落盘（原路径）
发送 → buildUserContentWithAttachments
     → 文本附件：直接读盘内联（最多 40 KiB）
     → PDF/DOCX/XLSX/XLS/PPTX：POST 文件到 MarkItDown /convert
        → markdown 内联进 runtime content（最多 80 KiB），前面标「以下为用户文件正文」
        → DB/UI 仍保存用户原话；附件卡片来自 message_attachments
     → 图片：只提及文件名（不做视觉）
```

解析在侧车里。Go 只有 HTTP 客户端，不链接 PDF/Office 库。

| 部分 | 位置 |
|------|------|
| 侧车 | `services/markitdown`（FastAPI + 官方 `markitdown` 包） |
| Compose | `deploy/compose/core.yaml` 服务名 `markitdown`，容器端口 **8010**，主机只绑定 `127.0.0.1:8010` |
| 客户端 | `services/api/internal/httpserver/docparse.go` |

8001 是 agent runtime，文档解析不用这个端口。

侧车只对上传字节调用 `convert_stream`，不接受 URL，也不走能拉取远程资源的 `convert()`。

## 环境变量

`DOC_PARSE_URL`：

| 场景 | 值 |
|------|----|
| 本机 `make dev-api`（API 不在 compose 网络里） | `http://127.0.0.1:8010` |
| API 跟侧车在同一 compose 网络 | `http://markitdown:8010` |
| 留空 | 不请求侧车。文本附件照旧内联；PDF/Office 写「未配置解析服务，无法解析正文」 |

`.env.example` 里默认是本机地址。`make dev-api` 会 source 仓库根 `.env`。

侧车自身：

| 变量 | 默认 | 作用 |
|------|------|------|
| `CONVERT_TIMEOUT_SECONDS` | `60` | 单次转换超时，返回 HTTP 504 |
| `MAX_UPLOAD_BYTES` | `20971520` | 与上传上限 20 MB 一致 |
| `MAX_RETURN_BYTES` | `204800` | 响应里的 markdown 字节上限；`char_count` 仍是截断前的字数 |

Go 侧单次请求超时默认 60 秒（管理端「运维 → 附件解析」可配 5–300 秒，字段 `doc_parse_timeout_seconds`；也可设环境变量 `DOC_PARSE_TIMEOUT_SECONDS`）。超时经 multipart 字段 `timeout_seconds` 传给侧车，改管理端后下一请求即生效，无需重启侧车。HTTP 客户端硬顶 310 秒。超时、连不上、空正文都只在模型侧说明里写中文，不编造内容，也不污染聊天 UI。

## 怎么起

```bash
make compose-up          # 含 markitdown；首次会构建镜像
# 健康检查
curl -fsS http://127.0.0.1:8010/health
```

只起 Postgres 时用 `make compose-postgres`，不会带上 markitdown。

本地不经过镜像：

```bash
cd services/markitdown
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt httpx
uvicorn app:app --host 127.0.0.1 --port 8010
python -m unittest test_app.py
```

## HTTP

`GET /health` → `{"status":"ok"}`

`POST /convert`，multipart 字段名 `file`：

```json
{
  "markdown": "# 标题\n\n正文",
  "filename": "notes.docx",
  "char_count": 8,
  "truncated": false
}
```

失败是 `{"error":"..."}`：`415` 类型不支持，`413` 超过 20 MB，`422` 转换失败或空文件，`503` 忙或依赖缺失，`504` 超时。HTTP 200 且 `markdown` 为空表示转换跑完但没有文字（扫描版 PDF 常见）。

## 限制

- 单文件内联：普通文本 40 KiB；解析出的 Markdown 80 KiB。更长会截断，并注明大约字数。
- 侧车返回的 markdown 最多约 200 KiB，避免把整本表格塞进 API 进程。
- 允许的 Office 类型：`.pdf` `.docx` `.xlsx` `.xls` `.pptx` 及对应 MIME（含 `application/vnd.ms-excel`）。旧版 `.doc` / `.ppt` 仍不在白名单。经典 `.xls` 依赖侧车 `markitdown[xls]`（xlrd/pandas）；损坏或受密码保护的表可能抽不出字。
- 图片仍只写「一期未传视觉多模态」。
- 多个附件按顺序各请求一次，每个有自己的超时。

## 镜像里有什么

`markitdown[pdf,docx,xlsx,pptx,xls]`。为了体积，**没有**安装：

- `[outlook]`
- 音频 / YouTube 转写
- Azure Document Intelligence / Content Understanding
- `markitdown-ocr`

因此扫描件、纯图片 PDF 抽不出字。这是预期，不是再去猜一段正文。

依赖 `magika` 会带上 onnxruntime，所以镜像不会特别小；`libgomp1` 是 slim 基础镜像里跑它所需要的运行库。模型在 wheel 里，启动时不下载。

## 管理端超时

路径：**管理端 → 运维 → 附件解析**。

| 字段 | 默认 | 范围 |
|------|------|------|
| `doc_parse_timeout_seconds` | `60`（未设置时） | `5`–`300` |

API：`GET/PUT /v1/admin/org/doc-parse`，body `{"doc_parse_timeout_seconds": 90}`。存于 `org_settings`，按请求读取。

## 非目标

- 不做 RAG、分块、embedding 或向量库。
- 不做 OCR，也不接视觉模型读图。
- 不在 Go 进程里解析 PDF/Office。
