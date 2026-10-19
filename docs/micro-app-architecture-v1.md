# open-bot 微应用（Micro App）技术架构与能力实现路径

> 状态：**Phase 0–2 已按本文在 `develop` 落地**（本地 commit，默认不推）  
> 日期：2026-10-19（Asia/Shanghai）  
> 校对原则：以仓内现实现为准；改 API/表/能力时同步改本文。

---

## 0. 问题与目标

**问题**：bot 在会话里实现了用户确认过的「微应用」，若不升格为独立对象，就会埋在聊天记录里——后续难找、难装入口、更无法安全调用桌面/手机能力。

**目标**：

1. 把确认后的成果持久化为**一等公民**（有 ID、版本、归属、能力声明）。
2. **单一真相**：账号级「我的工具」清单；各端只做入口适配。
3. **能力经 host 代理**：沙箱微应用不能直触系统 API；须声明 → 端支持 → 用户授权 → host/API 执行。
4. 复用现有栈：MinIO 对象存储、会话 attachments / `present_image`、审批三态、`machine_id` / host 设备模型、chat WS。

**非目标（本期不做）**：

- 系统级桌面 Widget / iOS 桌面小组件（仅预留 placement）。
- 完整小程序商店与计费。
- 把所有 skills.sh 包自动变成微应用 UI。
- Runtime 工具 `draft_micro_app` / `pin_micro_app` 正式注册（见 stub；Phase 0–1 用 HTTP `user_intent` 门）。

---

## 1. 概念分层

| 层 | 名称 | 存什么 | 谁消费 |
|----|------|--------|--------|
| A | **Capability** | Skill / MCP / host 工具能力 | agent-runtime、Bot、MicroApp 声明 |
| B | **MicroApp** | 用户固定的可打开对象（UI bundle 或能力型入口元数据） | 各端「我的工具」 |
| C | **Placement** | 入口挂载位置（hub / chat_pin / desktop_shortcut / mobile_shortcut） | 各端壳 |
| D | **Grant** | 用户×微应用×能力×设备 授权（三态） | API + 客户端审批 UI |
| E | **Session/Host** | 当前连接的电脑/手机 host | desktop Tauri / Capacitor |

关系：

```
用户确认 → pin → MicroApp(pinned)
                ├─ kind=ui      → bundle(HTML/zip) + capabilities[]
                ├─ kind=skill   → 绑定 skill slug（打开=启用并引导）
                └─ kind=routine → 绑定定时/触发配方
Placement 只指向 MicroApp.id
打开 UI 型 → 沙箱 iframe → postMessage RPC → Client Host Bridge →（必要时）OS 权限
```

**固定 ≠ 展示**：截图「每次都展」是消息可见性；「固定」才是持久化进 MicroApp 库。

---

## 2. 系统架构（与仓内路径对齐）

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Web / Desktop│  │ Android 壳   │  │ 管理端 Admin │
│ apps/web     │  │ (Capacitor)  │  │              │
│ MicroAppsHub │  │ 同 H5 入口   │  │ （本期无专页）│
│ MicroAppShell│  └──────┬───────┘  └──────────────┘
└──────┬───────┘         │
       │ REST/WS          │
       ▼                  ▼
┌─────────────────────────────────────────────────┐
│ services/api                                      │
│  db: micro_apps / placements / grants             │
│  HTTPS: /v1/micro-apps/*                          │
│  chat WS: micro_apps_changed                      │
│  object store: MinIO 或 data/micro-apps-store     │
└───────────────┬─────────────────┬─────────────────┘
                │                 │
                ▼                 ▼
     ┌──────────────────┐  ┌─────────────────────┐
     │ agent-runtime    │  │ Object key prefix    │
     │ micro_apps_stub  │  │ micro-apps/{owner}/  │
     │ (工具名占位)      │  │ {app_id}/bundle.zip  │
     └──────────────────┘  └─────────────────────┘
```

### 2.1 打开 UI 微应用（Phase 1 已实现）

```
[我的工具] 点击 MicroApp
    → GET /v1/micro-apps/{id}/runtime
    → MicroAppShell：sandbox iframe（allow-scripts allow-forms，无 allow-same-origin）
    → 注入 openbot.micro SDK（postMessage）
    → iframe: openbot.micro.request(capability, params)
    → parent Host Bridge：
         声明 ∩ 端能力矩阵 ∩ Grant 三态
    → 缺 Grant → MicroAppGrantDialog（allow_once / always_allow / deny）
    → 通过后：
         · cloud.http → POST .../rpc/cloud.http（服务端 SSRF 护栏）
         · host.* → Tauri runLocalHostOp / 系统文件选择器
         · chat.attach → uploadConversationAttachment + persist_only 消息（对齐 present_image）
         · ui.notify → sonner toast
```

---

## 3. 数据模型（已迁移）

实现：`services/api/internal/db/micro_apps.go` → `migrateMicroApps()`（`db.go` 启动迁移）。

### 3.1 `micro_apps`

| 字段 | 说明 |
|------|------|
| `id` | UUID |
| `user_id` | 归属账号 |
| `agent_id` | 可选；来源 Bot |
| `title` / `description` / `icon` | 展示 |
| `kind` | `ui` / `skill` / `routine` |
| `status` | `draft` / `pinned` / `archived` |
| `version` | 单调递增（pin / bundle 上传会 +1） |
| `bundle_key` | 对象前缀，默认 `micro-apps/{owner_id}/{app_id}/` |
| `bundle_hash` | SHA-256（zip 内容） |
| `entrypoint` | 默认 `index.html` |
| `skill_slug` / `routine_id` | kind 绑定时 |
| `capabilities_json` | 字符串数组 |
| `source_conversation_id` / `source_message_id` | 溯源 |
| `confirmed_at` / `confirmed_by` | pin 时写入 |
| `created_at` / `updated_at` | |

### 3.2 `micro_app_placements`

`id`, `micro_app_id`, `surface`（hub / chat_pin / desktop_shortcut / mobile_shortcut）, `context_id`, `sort_rank`, `enabled`  
唯一：(micro_app_id, surface, context_id)。**pin 默认写 hub。**

### 3.3 `micro_app_grants`

`user_id`, `micro_app_id`, `capability`, `machine_id`, `decision`（`allow_once` / `always_allow` / `deny`）, `expires_at`  
高敏默认建议 `allow_once`：`host.shell.run`、`host.clipboard.read`、`device.mic` 等（见 `DefaultGrantDecisionForCapability`）。

### 3.4 对象存储

- 复用 sandbox 同一套 MinIO 环境变量（`SANDBOX_S3_*` / `MINIO_*`）；micro-app 强制 **Prefix 空**，键自带 `micro-apps/...`。
- 未配置 MinIO 时回落本地目录：`OPENBOT_MICRO_APP_ROOT` 或 `data/micro-apps-store/`。
- 键：
  - `micro-apps/{owner_id}/{app_id}/bundle.zip`
  - `micro-apps/{owner_id}/{app_id}/files/...`（上传时解压落盘，供调试；运行时以 zip→runtime JSON 为准）

---

## 4. API（已实现）

前缀：`/v1/micro-apps`（均需登录）。

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/v1/micro-apps` | 列表；`?surface=hub`、`?status=` |
| GET | `/v1/micro-apps/{id}` | 元数据；`bundle_url` 相对路径 |
| POST | `/v1/micro-apps` | 创建 **draft**；**必须** `user_intent` |
| POST | `/v1/micro-apps/{id}/pin` | 用户确认固定；写 hub + `confirmed_*`；可选 `chat_pin`；**必须** `user_intent`；`kind=skill` 启用技能 |
| PATCH | `/v1/micro-apps/{id}` | 改标题/能力等 |
| POST | `/v1/micro-apps/{id}/archive` | 下架并禁用 placements |
| PUT | `/v1/micro-apps/{id}/placements` | 批量挂载 |
| GET | `/v1/micro-apps/{id}/grants` | 授权视图 |
| PUT | `/v1/micro-apps/{id}/grants/{capability}` | 写三态 |
| POST | `/v1/micro-apps/{id}/session` | 短时 scoped token（非全权 JWT） |
| GET/PUT | `/v1/micro-apps/{id}/bundle` | 下载 / 上传 zip（≤5MiB） |
| GET | `/v1/micro-apps/{id}/runtime` | 解压后的 entry + files（供 iframe srcdoc） |
| POST | `/v1/micro-apps/{id}/rpc/grant-check` | 查 Grant / 是否弹窗 |
| POST | `/v1/micro-apps/{id}/rpc/grant-consume` | 消费 `allow_once` |
| POST | `/v1/micro-apps/{id}/rpc/cloud.http` | 窄代理（HTTPS、禁私网；可选 `MICRO_APP_HTTP_ALLOWLIST`） |

**`user_intent` 合法值**：`save` \| `pin_agree` \| `user_save` \| `user_pin` \| `confirm`。  
禁止静默 draft/pin（无 intent → 400）。

WS：`micro_apps_changed`（`chat_hub`，对齐 `agents_changed`）；Web `useChatEventsSocket` → `refreshMicroAppsFromWS`。

代码：

- DB/handlers：`services/api/internal/db/micro_apps.go`、`httpserver/micro_apps.go`、`micro_app_bundle.go`、`micro_app_rpc.go`、`micro_app_store.go`
- Web：`apps/web/src/api/microApps.ts`、`components/MicroAppsHub.tsx`、`MicroAppShell.tsx`、`MicroAppGrantDialog.tsx`、`lib/microApp/*`

---

## 5. 能力目录与端矩阵（Phase 1）

统一命名：`domain.action`。闸门：**声明 ∩ 端能力 ∩ Grant**。

### 5.1 P0（Host Bridge 已接）

| capability | 端 | 实现 |
|------------|----|------|
| `host.screenshot` | desktop（Tauri） | `runLocalHostOp(op=screenshot)`；无 host → 灰显 |
| `host.fs.read` | 全端 | **系统文件选择器**（`<input type=file>`），不广域扫盘 |
| `host.fs.write` | 全端 | `showSaveFilePicker` 或下载保存 |
| `host.shell.run` | desktop | **可声明，不默认关**；Grant 三态，高敏默认弹 `allow_once`；`runLocalHostOp(op=shell)` |
| `cloud.http` | 全端 | 服务端代理 + SSRF |
| `ui.notify` | 全端 | toast |
| `chat.attach` | 有会话 | 上传附件 + `persist_only` markdown（对齐 present_image 展图通道） |

### 5.2 灰显规则（`lib/microApp/capabilities.ts` + `MicroAppCapabilityMatrix`）

- Capacitor / 纯浏览器：`host.*`（除文件选择器）→ 灰显「需要已连接的电脑；手机登录 ≠ host」。
- `device.camera` / `device.notify` / `device.share`：非原生壳或 `Capacitor.Plugins` 未注册 → 灰显。
- 未声明 → 矩阵标不可用；RPC 拒绝。

### 5.3 Device P1（Android / iOS）

| capability | 桥 | 说明 |
|------------|----|------|
| `device.camera` | `Capacitor.Plugins.Camera` | 有则 `getPhoto`；无则灰显 |
| `device.notify` | `LocalNotifications` | `schedule` |
| `device.share` | `Share` | 系统分享 |

实现：`apps/web/src/lib/microApp/deviceBridge.ts`（运行时探测，不强制 npm 插件进 web 包）。

### 5.4 kind=skill

Pin 时（`user_intent` 已校验）：`SetUserSkillEnabled(slug,true)`；若 `agent_id` 非空再 `SetAgentSkillEnabled`。缺 `skill_slug` → 400。

### 5.5 后续

系统 Widget、Runtime draft/pin 工具注册见 §10 Phase 3。

---

## 6. 权限状态机（已实现）

```
请求 capability C
  → C ∉ MicroApp.capabilities？ → 拒绝（未声明）
  → 当前端不支持 C？ → 灰显 / RPC error（reason）
  → grant-check
       deny → 拒绝
       always_allow → 执行
       allow_once → 执行后 grant-consume（或 cloud.http 服务端消费）
       无记录 → MicroAppGrantDialog → PUT grants → 继续或停
```

**双闸门**：Bot 工具策略（模型侧，后续）∩ MicroApp Grant（入口×设备）。

---

## 7. 客户端

### 7.1 Web / Desktop（`apps/web`）

1. 账户菜单「我的工具」→ `MicroAppsHub`（能力矩阵、chat_pin 勾选）
2. `MicroAppShell`：上传 zip、runtime → srcdoc iframe + SDK；skill 型无 bundle 时展示绑定说明
3. `MicroAppChatPinBar`：作曲框上方快捷条（`surface=chat_pin`）
4. `lib/microApp/hostBridge.ts` + `deviceBridge.ts`：RPC
5. `MicroAppGrantDialog`：审批三态文案

### 7.2 Android / Runtime

- Capacitor：同 H5 入口；host 能力灰显。
- Runtime：`services/agent-runtime/app/micro_apps_stub.py` 仅占位工具名，**尚未**挂进 `TOOL_DEFS`。

---

## 8. draft / pin 路径（已拍板，已实现）

```
仅当（a）用户表达保存/固定意图，或（b）bot 确认「要不要固定」且用户同意
  → POST /v1/micro-apps  user_intent=save|pin_agree  → status=draft
  → 用户确认 → POST .../pin  user_intent=user_pin|confirm
       · confirmed_* + placement hub
  → WS micro_apps_changed
```

禁止：实现完静默建库；禁止仅凭模型一句「已固定」而无 pin API。

Bundle 规范（ui）：

```
bundle.zip
  manifest.json   # entry/entrypoint, capabilities[] ⊆ 服务端声明
  index.html
  assets/...
```

---

## 9. 安全

1. iframe：`sandbox="allow-scripts allow-forms"`，**无** `allow-same-origin`；资源经父页 blob/srcdoc。
2. Session token：短 TTL、绑定 `micro_app_id`、不可升全权。
3. `cloud.http`：禁私网/元数据 IP；默认要求 https；可选 host allowlist。
4. Bundle：5MiB、路径穿越拒绝、manifest 能力 ⊆ 声明。
5. 展图：走 attachments，不进 LLM journal。

---

## 10. 分阶段

### Phase 0 — 协议与空壳 ✅

- [x] DB：三表
- [x] API：list/get/create/pin/archive/placements/grants/session
- [x] Web：我的工具空壳
- [x] draft/pin `user_intent` 门
- [x] WS：`micro_apps_changed`

### Phase 1 — UI + P0 能力 ✅

- [x] Bundle 上传/下载（MinIO/本地）+ runtime
- [x] 沙箱 iframe + `openbot.micro` SDK
- [x] P0 RPC + Grants 三态 + 无 host 灰显
- [x] `chat.attach` ↔ present_image 通道

### Phase 2 — 入口与移动 ✅（本迭代）

- [x] chat_pin 快捷条（作曲框上方；hub 可勾选 placement）
- [x] 能力矩阵 UI（可用/灰显 + 原因）
- [x] Android：`device.camera` / `device.notify` / `device.share`（Capacitor Plugins 就绪时接通；否则灰显）
- [x] kind=skill ↔ 固定时启用 `user_skills` + 来源 Bot `agent_skills`
- [ ] Runtime 正式注册 draft/pin 工具（仍须 user 确认）

### Phase 3 — 增强

- [ ] desktop_shortcut / mobile_shortcut（应用内）
- [ ] kind=routine；系统级 Widget（单独立项）；团队模板分发

---

## 11. 验收标准

1. 用户确认 pin 后出现在「我的工具」，重启仍在。
2. 同账号多端 hub 列表一致（WS 刷新）。
3. 未声明 / 未授权 / deny 不执行；allow_once 可消费。
4. 无桌面 host 时截屏/shell 灰显并说明原因；能力矩阵展示原因。
5. 口头「已固定」而无 pin 行 → 失败。
6. 上传 zip → 打开 Shell → P0 RPC 冒烟；图经 `chat.attach` 进会话。
7. chat_pin 出现在作曲框上方；勾选/取消与 placement 一致。
8. kind=skill pin 后账号（及来源 Bot）技能为启用。

---

## 12. 已拍板（2026-10-19）

1. **Phase 0–1 按本文开工并落地。**
2. **`host.shell.run` 不默认关**：可声明；闸门 = 声明 ∩ 端能力 ∩ Grant 三态；高敏默认倾向 `allow_once`，不做「永远默认关 / 仅管理端白名单」。
3. **draft 时机**：不在「实现完」时静默建库。仅当用户保存/固定意图，或 bot 询问且用户同意后，才 `user_intent` 建 draft 并进入 pin。

---

## 13. 仓内索引

| 用途 | 路径 |
|------|------|
| 本文 | `docs/micro-app-architecture-v1.md` |
| DB | `services/api/internal/db/micro_apps.go` |
| API | `services/api/internal/httpserver/micro_apps*.go` |
| Web Hub/Shell | `apps/web/src/components/MicroAppsHub.tsx`、`MicroAppShell.tsx`、`MicroAppChatPinBar.tsx`、`MicroAppCapabilityMatrix.tsx` |
| SDK / Bridge | `apps/web/src/lib/microApp/`（含 `deviceBridge.ts`） |
| Runtime stub | `services/agent-runtime/app/micro_apps_stub.py` |

推送：仅当用户在 open bot 1:1 明确说 push；否则 **develop 本地 commit only**。
