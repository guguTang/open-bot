# Gmail 连接与 Web 发信

日期：2026-10-13 · 状态：MVP 实现 · 范围：Web 客户端 OAuth 连接 Gmail + Bot 起草 → 用户确认 → Gmail API 发送  
对照：桌面 CLI 路径保留 `skills/himalaya`、`skills/google-workspace`（host_shell / gws）；本方案为 **Web 无桌面** 用户发信，不走 Resend 作为主邮箱路径。

---

## 1. 目标与原则

| 原则 | 说明 |
|---|---|
| 用户邮箱 | 通过 Gmail OAuth 使用**用户自己的** Gmail 发信 |
| 不擅自代发 | 每次 `gmail_send` 必须聊天确认卡（`host_confirm` / `op=email_send`）；**禁止** Always allow / allowlist 自动放行 |
| 与桌面并存 | 不删除 himalaya / google-workspace skills |
| 复用现网 | AES-GCM（`BOT_SECRETS_KEY`）、host_confirm 卡、Settings 页模式、runtime `TOOL_DEFS` |

Out of scope（除非极简）：Outlook、应用市场、入站邮件监听、Gmail 草稿箱同步。

---

## 2. Settings 连接流

```
设置 → 连接应用（integrations）
  ├─ 未连接：[连接 Gmail] → POST /v1/integrations/gmail/start
  │            → 浏览器跳转 Google 同意屏
  │            → GET /v1/integrations/gmail/callback?code&state
  │            → 存 token → 重定向 Web `/?open_settings=integrations`
  ├─ 已连接：显示邮箱 · [断开连接] DELETE /v1/integrations/gmail
  └─ 未配置 Client：提示配置 GOOGLE_OAUTH_*（不假装已连）
```

---

## 3. OAuth scopes（MVP）

| Scope | 用途 |
|---|---|
| `https://www.googleapis.com/auth/gmail.send` | **必需** — `users.messages.send` 代发 |
| `https://www.googleapis.com/auth/userinfo.email` | 展示已连接邮箱 |

授权成功后以 Google token 响应里的 `scope` 为准；若缺少 `gmail.send`（常见于同意屏幕未添加该敏感范围，或授权页取消勾选），连接会被拒绝（`missing_gmail_send_scope`），已连接但缺范围时 Settings 显示「发送权限不足」，`gmail_send` 会明确要求 **断开 → 重新连接**。

Google Cloud 配置要点：

1. OAuth 同意屏幕 → 添加范围：至少 `gmail.send` + `userinfo.email`（测试用户模式即可）
2. 凭据类型 **Web application**；Redirect URI：`{API_PUBLIC}/v1/integrations/gmail/callback`（本地默认 `http://127.0.0.1:18080/v1/integrations/gmail/callback`）
3. 改过范围后：Settings → 断开连接 → 再连接 Gmail，并在授权页保留「发送邮件」勾选（`prompt=consent`）

后续若要读信 / 草稿箱再扩 `gmail.readonly` / `gmail.compose`（需重新同意）。

---

## 4. Token 存储

表 `oauth_connections`（每用户每 provider 一行，MVP provider=`gmail`）：

| 列 | 说明 |
|---|---|
| `user_id` + `provider` | 唯一 |
| `account_email` | 明文（非密钥） |
| `scopes` | 空格分隔 |
| `access_token_ct` / `refresh_token_ct` | AES-GCM（同 bot_secrets） |
| `token_expiry` | access token 过期时间 |
| `created_at` / `updated_at` | |

列表 / 状态接口**永不**返回 token。发送前若 access 过期则用 refresh 换新并回写。

---

## 5. Agent 工具

| 工具名 | 行为 | 确认 |
|---|---|---|
| `gmail_status` | 是否已连接 + 邮箱；未连接时返回引导文案 | 否 |
| `gmail_send` | `to` / `subject` / `body`（可选 `cc`/`bcc`）→ Go `/internal/gmail/send` | **是**（host_confirm） |

命名对齐仓库：`snake_case`，与 `request_secret` / `host_shell` 一致。  
未连接时 `gmail_send` 立即失败并提示去「设置 → 连接应用」；不创建确认卡。

确认卡映射：

- `op=email_send`
- `path` = 收件人
- `dest` = 主题
- `preview` = 正文摘要
- UI：**隐藏「始终允许」**；服务端拒绝 `always_allow` / 不走 allowlist auto

草稿：MVP 由模型在对话中拟稿后直接调 `gmail_send`（确认卡即「草稿确认」）。可选后续加 `gmail_create_draft`（Gmail Drafts API）。

---

## 6. 环境变量

```bash
# Google OAuth (Web client) — 未设置则连接按钮返回未配置
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
# 须与 GCP 控制台 Redirect URI 完全一致
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:18080/v1/integrations/gmail/callback
# 授权成功后浏览器落点（Web Vite）
OPENBOT_WEB_ORIGIN=http://127.0.0.1:5173

# 已有：token 加密（与 bot_secrets 共用）
# BOT_SECRETS_KEY=dev-bot-secrets-key-change-me!!
```

---

## 7. API 一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/v1/integrations/gmail` | JWT | `{ connected, email?, oauth_configured }` |
| POST | `/v1/integrations/gmail/start` | JWT | `{ authorize_url }` 或错误 |
| GET | `/v1/integrations/gmail/callback` | 无（state） | 换 token → 302 Web |
| DELETE | `/v1/integrations/gmail` | JWT | 断开 |
| POST | `/internal/gmail/status` | internal | runtime 用 |
| POST | `/internal/gmail/send` | internal | 确认后发送 |

---

## 8. 失败与未连接

| 场景 | 行为 |
|---|---|
| 未配 Client ID/Secret | `GET` 返回 `oauth_configured:false`；start 503 |
| 用户未连接 | tools 返回明确 JSON error + 引导 Settings |
| 用户拒绝确认卡 | `denied: true`，模型如实说明 |
| refresh 失效 | 清连接或标需重连；提示重新连接 Gmail |
| 发送 API 错误 | 返回 Google 错误摘要，不泄露 token |

---

## 9. 如何本地验证

### 9.1 Google Cloud

1. [创建/选择项目](https://console.cloud.google.com/projectselector2/home/dashboard)
2. 启用 **Gmail API**
3. [OAuth 同意屏幕](https://console.cloud.google.com/auth/audience)：External + 测试用户加入自己的 Gmail
4. [凭据](https://console.cloud.google.com/apis/credentials) → 创建 OAuth 客户端 ID → 类型 **Web 应用**
5. 已授权的重定向 URI 加：`http://127.0.0.1:18080/v1/integrations/gmail/callback`
6. 将 Client ID / Secret 写入仓库根 `.env`（见上）

### 9.2 跑通

```bash
# 确保 BOT_SECRETS_KEY 已设（与 bot_secrets 相同）
make dev   # 或既有 api + runtime + web
```

1. Web 登录 → 设置 → **连接应用** → 连接 Gmail → 同意 → 看到邮箱  
2. 对话：「用我的 Gmail 给 foo@example.com 发一封主题 Test、正文 hello」  
3. 应出现确认卡（收件人/主题/正文）；点「允许一次」后发送；「拒绝」则不发  
4. 断开连接后再让 Bot 发信 → 工具报未连接  

### 9.3 自动化测试

- Go：`oauth_connections` CRUD；未配置 OAuth；`email_send` 不走 allowlist；decide 拒绝 always_allow  
- Python：`gmail_status` / `gmail_send` 在未连接时返回 gated error（mock internal API）

---

## 10. 与桌面路径的分工

| 路径 | 适用 |
|---|---|
| Web Gmail OAuth（本文） | 浏览器 / 无本机 CLI |
| `himalaya` skill | 本机 IMAP/SMTP + App Password |
| `google-workspace` skill | 本机 gws / Desktop OAuth 多服务 |

Agent 应优先：若 `gmail_status.connected` → Web 工具；否则再引导连接或桌面 skill。
