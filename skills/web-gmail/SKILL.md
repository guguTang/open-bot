---
name: web-gmail
description: Send mail with Web Gmail (gmail_send/gmail_status); attach HTML/PDF/images from /workspace. Use for 用 Gmail 发信 / 发送文件 / 关系图附件.
---

# Web Gmail 发信

用用户在 **设置 → 连接应用** 连好的 Gmail（`gmail_status` / `gmail_send`）。桌面 IMAP/`gws` 仍用 `himalaya` / `google-workspace`。

## 何时用

- 「用我的 Gmail 发一封…」「把关系图/页面/文件发到邮箱」
- 已连 Web Gmail，或先 `gmail_status` 确认

## 步骤

1. 不确定是否已连 → `gmail_status`；未连接或 `can_send=false` 按 hint 引导设置页。
2. 调用 `gmail_send`（确认卡 → 用户允许一次才发送）。
3. **发文件 / HTML / 关系图 / PDF / 图片**：用 `attachments`，不要把整页源码糊进 `body`。
   - 例：`attachments: [{ "path": "/workspace/bots/.../关系图.html", "filename": "关系图.html" }]`
   - `body` 写一句短说明即可（如「见附件关系图」）。
   - 路径必须在工作区 `/workspace` 下；单文件 ≤5MB，合计 ≤8MB，最多 5 个。
4. **纯文字邮件**：`body` 放收件人要读的正文；禁止 `body` 只有路径且没有附件。
5. 不要用 Resend 等中继冒充用户邮箱。

## 验证

确认卡预览含「附件：文件名」；用户允许后返回 `message_id`；收件人能打开附件。
