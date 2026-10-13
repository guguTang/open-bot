---
name: web-gmail
description: Send mail with connected Web Gmail (gmail_send / gmail_status). Use when 用 Gmail 发信 / 发邮件 / email via connected Gmail; put file contents in body, never paths.
---

# Web Gmail 发信

用用户在 **设置 → 连接应用** 连好的 Gmail（工具 `gmail_status` / `gmail_send`）。适合浏览器用户、无本机 CLI。桌面 IMAP/`gws` 仍用 `himalaya` / `google-workspace`。

## 何时用

- 「用我的 Gmail 发一封…」「把刚才生成的内容发到邮箱」
- 已连 Web Gmail，或不确定是否已连（先 `gmail_status`）

不要用：用户只要本机 himalaya/gws；或只要草稿不想真发（MVP 确认卡即发送确认）。

## 步骤

1. 若不确定是否已连：调用 `gmail_status`。未连接 → 请用户去「设置 → 连接应用」连接；`can_send` 为 false 时按返回 hint 断开重连。
2. 写清 `to` / `subject` / `body`，再调 `gmail_send`。系统会出确认卡；用户「允许一次」后才发送，「拒绝」则不发。如实说明结果，不要编造成功。
3. **正文必须是收件人要读的文字，禁止把路径当正文**：
   - 若内容在工作区/本机文件里：先 `sandbox_read` 或 `host_read`（按文件所在）读出文本，再写入 `body`。
   - 文件很大：摘要或截取关键部分进 `body`，并在正文说明已截断。
   - 二进制/图片：MVP **不能附件**；说明只能发纯文本，可改发文字版或链接方案，**不要**把路径塞进 `body` 冒充附件。
4. 不要用 Resend 或其他中继冒充「用户邮箱」；本工具即用户自己的邮箱。

## 验证

确认卡上预览的正文是完整可读文字（不是 `/workspace/...` 之类路径）；用户允许后工具返回成功/`message_id`。
