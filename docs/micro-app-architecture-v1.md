# open-bot 微应用（Micro App）技术架构与能力实现路径

> 状态：**Phase 0–6 + 缺口收口**已按本文在 `develop` 落地（本地 commit，默认不推）；**生成后自动落 bundle**（`upload_micro_app_bundle` / `POST /internal/micro-apps/bundle`）已落地，用户无需手传 zip；授权后续跑已支持；系统级 Widget / 团队模板分发 / 入站 Hook 代建 / store / `device.contacts` 为**延期项**（§10.5）  
> 日期：2026-10-20（Asia/Shanghai）  
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

- 系统级桌面 Widget / iOS·Android 桌面小组件（**延期**；Phase 3 只做应用内快捷区，见 §10.5）。
- 团队模板包分发（**延期**，见 §10.5）。
- 完整小程序商店与计费。
- 把所有 skills.sh 包自动变成微应用 UI。
- （已取消）Runtime 工具曾标为非目标；**Phase 4 已正式注册** `draft_micro_app` / `pin_micro_app`（仍强制 `user_intent`）；另注册 `upload_micro_app_bundle`（自动落 bundle，不 pin）。

---

## 1. 概念分层

| 层 | 名称 | 存什么 | 谁消费 |
|----|------|--------|--------|
| A | **Capability** | Skill / MCP / host 工具能力 | agent-runtime、Bot、MicroApp 声明 |
| B | **MicroApp** | 用户固定的可打开对象（UI bundle 或能力型入口元数据） | 各端「我的工具」 |
| C | **Placement** | 入口挂载位置（hub / chat_pin / desktop_shortcut / mobile_shortcut；后两者为**应用内**快捷区） | 各端壳 |
| D | **Grant** | 用户×微应用×能力×设备 授权（三态） | API + 客户端审批 UI |
| E | **Session/Host** | 当前连接的电脑/手机 host | desktop Tauri / Capacitor |

关系：

```
用户确认 → pin → MicroApp(pinned)
                ├─ kind=ui      → bundle(HTML/zip) + capabilities[]
                ├─ kind=skill   → 绑定 skill slug（打开=启用并引导）
                └─ kind=routine → routine_config 配方 →（pin 时）物化为 routines 行
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
     │ draft/upload/pin │  │ micro-apps/{owner}/  │
     │ → /internal/     │  │ {app_id}/bundle.zip  │
     │   micro-apps/*   │  │                      │
     └──────────────────┘  └─────────────────────┘
```

### 2.1 打开 UI 微应用（Phase 1 已实现）

```
[我的工具] 点击 MicroApp
    → GET /v1/micro-apps/{id}/runtime
    → MicroAppShell：sandbox iframe（allow-scripts allow-forms，无 allow-same-origin）
    → 注入 openbot.micro SDK（postMessage）+ shell CSS（html/body height:auto）
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

#### 2.1.1 Shell / iframe 尺寸适配（content-fit）

**问题**：宽屏曾用固定 `settings-dialog` ~860×680，小工具底部大片空白。

**做法**（无 `allow-same-origin`，父页不能读 iframe DOM，故不用跨框 ResizeObserver）：

| 端 | 行为 |
|----|------|
| 宽屏桌面 | Hub 列表仍 ~860×680；**打开工具**时 Dialog 加 `settings-dialog--micro-fit`（`height:auto` / `width:fit-content`），Shell 随 bundle 内容伸缩 |
| 窄屏 / 全屏 | Dialog 仍近全屏；白色 stage **不**用 flex 撑满剩余高度，避免底部空洞 |

**协议**（事件，非 RPC capability）：

```
iframe → parent:
  { source: "openbot.micro", type: "resize", width: number, height: number }
```

- **自动**：SDK 内 `ResizeObserver` + `load` / `resize` 测量后 `postMessage`
- **手动**：`openbot.micro.reportSize({ width?, height? })`
- **Host 钳制**（`lib/microApp/shellSize.ts`）：
  - min ≈ 280×160
  - 宽屏 max 宽 ≈ min(828, vw−64)；max 高 ≈ min(560, vh−160)；超高则 stage/iframe 滚动
  - 窄屏 max 高 ≈ 72% vh

实现：`sdk.ts`、`shellSize.ts`、`MicroAppShell.tsx`、`MicroAppsHub.tsx`、`styles.css`（`.settings-dialog--micro-fit` / `.micro-app-shell--fit`）。

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
| `skill_slug` / `routine_id` | kind 绑定时；`routine_id` 在 kind=routine pin 时写入 |
| `routine_config_json` | **Phase 3**：kind=routine 配方（`name/prompt/schedule_cron/timezone/agent_id/triggers/enabled/quiet_unchanged/max_retries`），API 字段 `routine_config` |
| `capabilities_json` | 字符串数组 |
| `source_conversation_id` / `source_message_id` | 溯源 |
| `confirmed_at` / `confirmed_by` | pin 时写入 |
| `created_at` / `updated_at` | |

### 3.2 `micro_app_placements`

`id`, `micro_app_id`, `surface`（hub / chat_pin / desktop_shortcut / mobile_shortcut）, `context_id`, `sort_rank`, `enabled`  
唯一：(micro_app_id, surface, context_id)。**pin 默认写 hub**；pin 可选 `chat_pin` 与 `surfaces[]`（Phase 3：`desktop_shortcut` / `mobile_shortcut`）。之后用 `PUT placements` 增删。

### 3.3 `micro_app_grants`

`user_id`, `micro_app_id`, `capability`, `machine_id`, `decision`（`allow_once` / `always_allow` / `deny`；API 也接受别名 `allow_always`）, `expires_at`, `command_allowlist_json`（**Phase 3**，仅 `host.shell.run`）  
高敏默认建议 `allow_once`：`host.shell.run`、`host.clipboard.read`/`write`、`device.mic`、`device.geo` 等（见 `DefaultGrantDecisionForCapability`）。无记录 = 每次弹窗（默认「仅一次」）。


### 3.3.2 `micro_app_parks`（抗重启）

Durable park / grant_required waiter，键 = 授权卡 `req_id`。

| 列 | 说明 |
|----|------|
| `req_id` | PK；与 `micro_app_grant` 卡相同 |
| `status` | `pending` / `resolved` / `expired` / `cancelled` |
| `decision` | allow_once / always_allow / deny / timeout |
| `expires_at` | 默认 create+900s；lazy + startup expire |
| `tool` / `capability` / `args_json` / `conversation_id` / `request_id` | 恢复与审计上下文 |

内部 API：`POST /internal/micro-apps/parks`（upsert）、`/parks/resolve`、`/parks/expire`、`/parks/get`。


### 3.3.1 迁移（Phase 3）

`migrateMicroApps()` 末尾幂等追加：

```sql
ALTER TABLE micro_apps ADD COLUMN IF NOT EXISTS routine_config_json TEXT NOT NULL DEFAULT '';
ALTER TABLE micro_app_grants ADD COLUMN IF NOT EXISTS command_allowlist_json TEXT NOT NULL DEFAULT '[]';
```

### 3.5 对象存储

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
| POST | `/v1/micro-apps` | 创建 **draft**；**必须** `user_intent`；kind=routine 可带 `routine_config` 或 `routine_id` |
| POST | `/v1/micro-apps/{id}/pin` | 用户确认固定；写 hub + `confirmed_*`；可选 `chat_pin`、`surfaces[]`（desktop_shortcut / mobile_shortcut）；**必须** `user_intent`；`kind=skill` 启用技能；`kind=routine` 绑定/创建例行任务 |
| PATCH | `/v1/micro-apps/{id}` | 改标题/能力/`routine_config` 等；**Phase 4**：pinned + kind=routine + 有 `routine_id` 时，`routine_config` **同步 `UpdateRoutine`**，失败则整次 PATCH 失败（大声报错） |
| POST | `/v1/micro-apps/{id}/archive` | 下架并禁用 placements；kind=routine 同时**暂停**（不删）绑定的例行任务 |
| PUT | `/v1/micro-apps/{id}/placements` | 批量挂载 |
| GET | `/v1/micro-apps/{id}/grants` | 授权视图 |
| PUT | `/v1/micro-apps/{id}/grants/{capability}` | 写三态；`host.shell.run` 可带 `command_allowlist`（省略=保留，`[]`=清空） |
| DELETE | `/v1/micro-apps/{id}/grants/{capability}` | **Phase 3**：恢复「每次询问」（`?machine_id=`） |
| POST | `/v1/micro-apps/{id}/session` | 短时 scoped token（非全权 JWT） |
| GET/PUT | `/v1/micro-apps/{id}/bundle` | 下载 / **手动**上传 zip（≤5MiB；可选备用） |
| POST | `/internal/micro-apps/bundle` | Runtime 自动上传：`zip_base64` 或 `files` map；与 PUT 同校验/落库（X-Internal-Token） |
| GET | `/v1/micro-apps/{id}/runtime` | 解压后的 entry + files（供 iframe srcdoc） |
| POST | `/v1/micro-apps/{id}/rpc/grant-check` | 查 Grant / 是否弹窗；`host.shell.run` 可带 `command`，返回 `command_allowlisted` / `command_allowlist` / `reason` |
| POST | `/v1/micro-apps/{id}/rpc/grant-consume` | 消费 `allow_once` |
| POST | `/v1/micro-apps/{id}/rpc/cloud.http` | 窄代理（HTTPS、禁私网；可选 `MICRO_APP_HTTP_ALLOWLIST`） |

**`user_intent` 合法值**：`save` \| `pin_agree` \| `user_save` \| `user_pin` \| `confirm`。  
禁止静默 draft/pin（无 intent → 400）。

WS：`micro_apps_changed`（`chat_hub`，对齐 `agents_changed`）；Web `useChatEventsSocket` → `refreshMicroAppsFromWS`。

代码：

- DB/handlers：`services/api/internal/db/micro_apps.go`、`micro_apps_phase3.go`（routine 配方 / shell 白名单）、`httpserver/micro_apps.go`、`micro_app_bundle.go`、`micro_app_rpc.go`、`micro_app_store.go`
- Web：`apps/web/src/api/microApps.ts`、`components/MicroAppsHub.tsx`、`MicroAppShell.tsx`、`MicroAppGrantDialog.tsx`、`MicroAppGrantDecisionPanel.tsx`、`MicroAppGrantConfirmCard.tsx`、`MicroAppShortcuts.tsx`、`MicroAppShellGrantPanel.tsx`、`MicroAppRoutinePanel.tsx`、`MicroAppRoutineCreateForm.tsx`、`lib/microApp/*`

---

## 5. 能力目录与端矩阵（Phase 1）

统一命名：`domain.action`。闸门：**声明 ∩ 端能力 ∩ Grant**。

### 5.1 P0（Host Bridge 已接）

| capability | 端 | 实现 |
|------------|----|------|
| `host.screenshot` | desktop（Tauri） | `runLocalHostOp(op=screenshot)`；无 host → 灰显 |
| `host.fs.read` | 全端 | **系统文件选择器**（`<input type=file>`），不广域扫盘 |
| `host.fs.write` | 全端 | `showSaveFilePicker` 或下载保存 |
| `host.shell.run` | desktop | **可声明，不默认关**；Grant 三态 + 每应用命令白名单（§6.1），默认弹「仅一次」；先过宿主 Auto-review，再 `runLocalHostOp(op=shell)` |
| `host.clipboard.read` / `write` | desktop（Tauri webview） | **Phase 4**：`navigator.clipboard`；高敏默认 `allow_once` |
| `cloud.http` | 全端 | 服务端代理 + SSRF |
| `ui.notify` | 全端 | toast |
| `chat.attach` | 有会话 | 上传附件 + `persist_only` markdown（对齐 present_image 展图通道） |
| `routine.manage` | 全端（需已 pin 的 kind=routine） | **Phase 4**：enable/disable/update/run_now + Grant |
| `host.app.find` / `open` | desktop | **Phase 4（可选）**：`runLocalHostOp(find_app|open)` |
| `account.profile` | 全端 | **Phase 4（可选）**：只读 `GET /v1/me` |
| `agent.invoke` | 全端（需绑定 `agent_id`） | **Phase 5**：仅本微应用 `agent_id`；Grant + **每次运行前**用户确认弹窗；`openPrimaryConversation` + `sendMessageStream` |
| `skill.toggle` | 全端 | **Phase 5**：`setSkillEnabled` / `setAgentSkill`；**禁止**关闭 `always_on`（含 find-skills；客户端拦截 + 服务端 `skill_disable_blocked`） |
| `host.fs.workspace` | 全端 | **Phase 5**：经沙箱 API 读写，路径必须落在 `/workspace`（`resolveBotWorkspacePath`）；Grant 三态 |

### 5.2 灰显规则（`lib/microApp/capabilities.ts` + `MicroAppCapabilityMatrix`）

- Capacitor / 纯浏览器：`host.*`（除文件选择器与 `host.fs.workspace`）→ 灰显「需要已连接的电脑；手机登录 ≠ host」。
- `device.camera` / `device.notify` / `device.share` / `device.mic` / `device.geo`：非原生壳或 `Capacitor.Plugins` 未注册 → 灰显。
- 未声明 → 矩阵标不可用；RPC 拒绝。

### 5.3 Device P1（Android / iOS）

| capability | 桥 | 说明 |
|------------|----|------|
| `device.camera` | `Capacitor.Plugins.Camera` | 有则 `getPhoto`；无则灰显 |
| `device.notify` | `LocalNotifications` | `schedule` |
| `device.share` | `Share` | 系统分享 |
| `device.mic` | `Microphone` / `VoiceRecorder` / `SpeechRecognition` | **Phase 5**：运行时探测；Grant（高敏默认 allow_once）+ OS 权限；无插件灰显 |
| `device.geo` | `Geolocation` | **Phase 5**：`getCurrentPosition`；Grant（高敏）+ OS 权限；无插件灰显 |

实现：`apps/web/src/lib/microApp/deviceBridge.ts`（运行时探测，不强制 npm 插件进 web 包）。**已收口**：`apps/mobile/package.json` 声明 `@capacitor/camera` / `@capacitor/geolocation` / `@mozartec/capacitor-microphone` / `@capacitor/local-notifications` / `@capacitor/share`；iOS `Info.plist` + Android Manifest 权限文案已加。`pnpm install` + `cap sync` 后矩阵亮起；**OS 权限未授予**时仍灰显并走系统 `requestPermissions` 引导。

### 5.4 kind=skill

Pin 时（`user_intent` 已校验）：`SetUserSkillEnabled(slug,true)`；若 `agent_id` 非空再 `SetAgentSkillEnabled`。缺 `skill_slug` → 400。

### 5.5 kind=routine（Phase 3）

仓内**已有**服务端例行任务：`routines` 表 + `/v1/routines` CRUD/run + 进程内 1 分钟调度器（`httpserver/scheduler.go`，IANA 时区）+ Slack/GitHub/HTTP 入站触发（`webhooks.go`）。因此 kind=routine **不另造调度**，而是：

1. draft 存 `routine_config`（校验：prompt 必填；5 段 cron 或 ≥1 trigger；IANA 时区；trigger.source ∈ slack|github|http；≤10 trigger；max_retries 0..10）。或直接带已有 `routine_id`（校验归属）。
2. pin（`user_intent` 门）时：有 `routine_id` → 校验存在并绑定；否则按配方 `CreateRoutine`（名称默认取标题、agent 默认取来源 Bot、enabled 默认 true）并回写 `routine_id`；两者皆无 → 400。**先物化再置 pinned**，失败不会留下「已固定但无例行」的半成品。
3. archive → `enabled=false` 暂停例行（不删除，便于恢复/审计）。
4. Shell：展示配方 + 绑定例行（上次运行/错误），可「立即运行」（`POST /v1/routines/{id}/run`）与启停；Hub 提供「＋ 例行工具」表单（点击保存 = `user_intent=user_save`，固定仍需单独确认）。

**Phase 4 已补**：

- Host Bridge `routine.manage`：`enable` / `disable` / `update`（cron、prompt 等）/ `run_now`，走 Grant。
- PATCH `routine_config` 在 **已 pin 且已有 `routine_id`** 时同步 `UpdateRoutine`；同步失败则 PATCH 失败。
- Runtime：`draft_micro_app` / `upload_micro_app_bundle` / `pin_micro_app` 已挂 `TOOL_DEFS`；经 `/internal/micro-apps/create|bundle|pin`（create/pin 与 `/v1` 同语义并强制 `user_intent`；bundle 不 pin）。

**仍占位/未做**：

- 事件型触发依赖用户先在「设置 → 例行任务」配好入站 Hook；微应用不代建 Hook。
- OS Widget、团队模板、入站 Hook 代建（见 §10.5）；模型侧双闸门见 Phase 6 / §6.2。

### 5.6 后续

系统 Widget、团队模板分发见 §10.5（延期）。

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

**双闸门**：Bot 工具策略（模型侧）∩ MicroApp Grant（入口×设备）。见 §6.2 / Phase 6。

### 6.1 `host.shell.run` 审批（Phase 3 打磨）

不默认禁用；顺序（`lib/microApp/hostBridge.ts` `ensureGrant`）：

```
声明 ∩ 端能力（需 Tauri host）
  → 宿主 Auto-review（reviewLocalHostOp = host-exec 会话同一套：机器 exec_policy + 用户规则 + 内置分级）
       tier=deny（curl|sh、rm -rf /、fork bomb、exec_policy=deny…）→ 直接拒绝，任何 Grant 都绕不过
  → grant-check(command)
       deny                         → 拒绝
       allow_once（未过期）           → 执行后消费
       always_allow + 白名单命中      → 执行
       always_allow + 白名单为空      → 简单命令执行；Auto-review 判 confirm 的命令仍弹窗
       always_allow + 白名单未命中    → 弹窗（reason=command_not_in_allowlist）
       无记录                        → 弹窗（默认焦点「仅一次」）
```

弹窗（`MicroAppGrantDialog`）展示**完整命令**与原因；三按钮：仅一次 / 始终允许 / 拒绝。

- 「始终允许」默认勾选「仅限此命令前缀」，前缀建议 = 程序名 + 子命令（`git status -s` → `git status`），可编辑；不勾 = 不限前缀。
- 已有 always_allow 而白名单未命中时：「仅一次 / 拒绝本次」只影响本次，不覆盖原授权；「始终允许」把前缀**追加**到白名单。
- 白名单匹配（服务端 `MicroAppShellCommandAllowed`）：折叠空白后按**词边界前缀**；`*` = 任意简单命令；含 `` ; & | ` < > $( `` 或换行的**复合命令永不命中**（总是重新询问）。条目 ≤50、每条 ≤200 字符，条目本身不得含复合语法。
- 管理：Shell 内「命令授权」面板（`MicroAppShellGrantPanel`）：每次询问（删除 Grant）/ 仅一次 / 始终允许（编辑白名单）/ 拒绝。
- 宿主侧安全保持：Auto-review 硬拒绝在 Grant 之前执行（Phase 1 直调 `runLocalHostOp` 未过 Auto-review 的缺口已补上）。

### 6.2 模型侧双闸门（Phase 6）

当回合带 `micro_app_id`（典型：`agent.invoke`）时，对 `host_*` 叠加第二道闸：

```
agent.invoke(micro_app_id)
  → 会话消息带 micro_app_id
  → Runtime 供给：仅声明 ∩ host_tools 的 host_*
  → 模型调用 host_*：
       Gate A  Bot tool policy：client.host_tools + 能力已声明（未映射 → capability_not_declared）
       Gate B  MicroApp Grant：deny → grant_denied；无记录 / 白名单未命中 → grant_required
       → 通过后走既有 host-confirm / Auto-review / exec_host
       → allow_once 成功后 internal grant-consume
```

结构化错误码：`capability_not_declared` / `grant_denied` / `grant_required` / `host_required`。  
**缺口收口 + tool-loop park/resume + 抗重启**：模型路径遇 `grant_required` 时，runtime 在**同一工具调用内** park：
1. **热路径缓存**：`micro_app_park` in-process `asyncio.Future`（键 = 授权卡 `req_id`）
2. **耐久源**：表 `micro_app_parks`（Go `POST /internal/micro-apps/parks*`）；create 时 upsert pending + `expires_at`（默认 900s）
3. 调 `POST /internal/micro-apps/grant-prompt` 插入 `role=micro_app_grant` 卡（`tool` / `pending_args` / `run_request_id`）

用户点「仅一次」或「始终允许」→ `UpsertMicroAppGrant` → **先** `ResolveMicroAppPark`（清 durable pending，防孤儿）→ Go 调 runtime `POST /v1/micro-app-grants/resolve`：
- 有 in-process waiter → **恢复同一 `host_*` 调用**（`park_resolved=true`）
- waiter 已因重启丢失但 durable 曾存在 → `park_resolved=false` / `park_reason=waiter_lost`（**无法同栈恢复**；Grant 已写入；客户端 toast + **fallback 发续跑 turn 一次**）
- 点「拒绝」→ resolve(deny) → 该工具 `grant_denied`；durable 标 resolved

超时：await 超时或 `expires_at` 到期 → status=`expired`（lazy expire + runtime startup `rehydrate_on_startup`）。  
**不走** LangGraph `interrupt()`/`Command(resume)`：`approve_thread` 无法 rebound `tool_handler`。  
轻量审计：表 `micro_app_gate_audit` + runtime 日志 `micro_app_dual_gate …` / `micro_app_park …`。

**统一授权 UI**：iframe 与模型路径共用 `MicroAppGrantDecisionPanel`（三态：仅一次 / 始终允许 / 拒绝；shell 前缀白名单文案一致）。
- **模型路径**：聊天卡 `MicroAppGrantConfirmCard` → `POST .../micro-app-grants/{msgId}/decide`（UpsertGrant + park resolve）
- **iframe Host Bridge**：`MicroAppGrantDialog`（面板同一套）→ `putMicroAppGrant`（无 park；RPC 同步等待用户选择）

Host Bridge（iframe RPC）仍走 §6 / §6.1；Phase 6 对齐错误码前缀，便于客户端灰显/引导。

---

## 7. 客户端

### 7.1 Web / Desktop（`apps/web`）

1. 账户菜单「我的工具」→ `MicroAppsHub`（能力矩阵、chat_pin / desktop_shortcut / mobile_shortcut 勾选；pin 弹窗可多选入口；「＋ 例行工具」）
   - **双端分流**（`useSheetFormUi` = touch-ui OR layout-narrow ≤860）：窄屏/Capacitor 走 Settings hub 同构灰底；宽屏 Web/桌面 Tauri 走 `settings-dialog` 白底 elevated（Hub 列表 ~860×680；**打开工具**时 `settings-dialog--micro-fit` 随内容伸缩，见 §2.1.1），顶栏 32 级关闭、列表偏紧，更多操作用 popover（底 sheet 仅 narrow）
2. `MicroAppShell`：无 bundle 时提示可由 Bot 自动上传（手动 zip 为可选备用）；有 bundle 不推「必须先上传」；runtime → srcdoc iframe + SDK（含 resize 上报）；skill 型无 bundle 时展示绑定说明；宽屏 content-fit，窄屏近全屏但 stage 不撑出无意义空白（§2.1.1）
   - **取消快捷入口**（pinned 后）：宽屏「⋯」Dropdown / 窄屏底 sheet 提供「取消聊天栏快捷」「取消侧栏快捷」「取消手机快捷」（未挂载时对应「加入…」）；`PUT .../placements` 去掉该 surface（或 `enabled=false`）。不下架整个应用。
3. `MicroAppChatPinBar`：作曲框上方快捷条（`surface=chat_pin`）；芯片可打开工具，**× 取消聊天栏快捷**（仅撤 chat_pin placement，不 archive）
4. `lib/microApp/hostBridge.ts` + `deviceBridge.ts`：RPC
5. `MicroAppGrantDialog`：审批三态文案；shell 显示命令 + 前缀白名单
6. `MicroAppShortcuts`（Phase 3）：侧栏顶部「快捷工具」宫格——桌面/宽屏用 `desktop_shortcut`，手机 sheet 首页或 Capacitor 用 `mobile_shortcut`；点击打开 Shell。**应用内入口，非系统 Widget。**
7. `MicroAppShellGrantPanel` / `MicroAppRoutinePanel`：Shell 内命令授权与例行状态

### 7.2 Android / Runtime

- Capacitor：同 H5 入口；host 能力灰显；侧栏首页显示 `mobile_shortcut` 快捷区。
- Runtime：`draft_micro_app` / `upload_micro_app_bundle` / `pin_micro_app` 已注册（`micro_apps_stub.py` → `TOOL_DEFS`）；内部 API `/internal/micro-apps/create|bundle|pin`。

---

## 8. draft / upload / pin 路径（已拍板，已实现）

```
仅当（a）用户表达保存/固定意图，或（b）bot 确认「要不要固定」且用户同意
  → draft_micro_app / POST /v1|internal/micro-apps  user_intent=…  → status=draft
  →（kind=ui，主路径）Bot 生成 HTML 后 upload_micro_app_bundle
       · POST /internal/micro-apps/bundle  files{} 或 zip_base64
       · 与 PUT /v1/micro-apps/{id}/bundle 同：解压、路径穿越拒绝、manifest ⊆ capabilities、≤5MiB、MinIO/本地
       · 用户无需手传 zip；Web 手动上传仅为可选备用
  → 用户确认 → pin_micro_app / POST .../pin  user_intent=user_pin|confirm
       · confirmed_* + placement hub（禁止静默 pin）
  → WS micro_apps_changed（含 reason=bundle）
```

禁止：实现完静默建库；禁止仅凭模型一句「已固定」而无 pin API；**禁止无 user_intent 的 draft/pin**。  
空态文案：已有 bundle 不提示「必须先上传」；仅无 bundle 时说明可由 Bot 自动上传，手动 zip 可选。

Bundle 规范（ui）：

```
bundle.zip  （或 files map 服务端打包）
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
- [x] Runtime 正式注册 draft/pin 工具（仍须 user 确认）— **Phase 4 完成**

### Phase 3 — 增强 ✅

| 项 | 状态 | 说明 |
|----|------|------|
| desktop_shortcut / mobile_shortcut（应用内快捷区） | ✅ | pin 弹窗可选、Hub 可勾选、存 placements；侧栏「快捷工具」宫格点击开 Shell |
| `host.shell.run` 三态打磨 + 每应用命令白名单 | ✅ | 默认「仅一次」；白名单存 Grant；Auto-review 硬拒绝优先（§6.1） |
| kind=routine | ✅ | 复用现有 routines；配方 + pin 物化 + archive 暂停；Phase 4 补齐 manage / PATCH 同步 |
| 系统级 OS Widget | ⏸ 延期 | 仅文档，见 §10.5 |
| 团队模板包分发 | ⏸ 延期 | 仅文档，见 §10.5 |

### Phase 4 — Runtime 工具 + Host Bridge 补齐 ✅（本迭代）

| 项 | 状态 | 说明 |
|----|------|------|
| `draft_micro_app` / `upload_micro_app_bundle` / `pin_micro_app` | ✅ | draft/pin 强制 `user_intent`；upload 经 `/internal/micro-apps/bundle` 自动落库，不 pin；用户手传 zip 可选备用 |
| PATCH `routine_config` → `UpdateRoutine` | ✅ | 仅 pinned + 有 `routine_id`；失败则整次 PATCH 失败 |
| Host Bridge `routine.manage` | ✅ | enable/disable/update/run_now + Grant |
| Host Bridge `host.clipboard.read` / `write` | ✅ | Grant 默认 `allow_once`（高敏目录） |
| `host.app.find` / `open`、`account.profile` | ✅（可选） | Tauri find/open；profile 只读 |
| 跳过 | — | OS Widget、模板、inbound hooks、dual-gate、mic/geo、agent.invoke、skill.toggle、fs.workspace（由 Phase 5 承接） |

### Phase 5 — agent / skill / workspace / mic·geo ✅（本迭代）

| 项 | 状态 | 说明 |
|----|------|------|
| `agent.invoke` | ✅ | 仅 `micro_apps.agent_id`；Grant + 每次运行前 ConfirmProvider 确认；打开主会话并 `sendMessageStream` |
| `skill.toggle` | ✅ | 现有 `PUT /v1/skills/{name}` / `PUT /v1/agents/{id}/skills/{name}`；禁用 always_on（find-skills）客户端+服务端双拦 |
| `host.fs.workspace` | ✅ | 沙箱 `listSandbox` / `readSandboxFile` / `writeSandboxFile`；路径闸门 `/workspace`；Grant 三态 |
| `device.mic` / `device.geo` | ✅ | deviceBridge + mobile 已声明插件；Grant + OS `requestPermissions`；非原生壳/未 sync/OS 拒权 → 灰显+引导 |
| 跳过 / 延期 | — | OS Widget、团队模板、入站 Hook 代建（Phase 6 承接双闸门） |

### Phase 6 — 模型侧双闸门 ✅（本迭代）

**目标**：Bot 工具策略 ∩ MicroApp Grant，避免「仅 iframe Grant 通过即可让模型代用户调高敏 host_*」。

| 项 | 状态 | 说明 |
|----|------|------|
| 上下文注入 | ✅ | `agent.invoke` → `sendMessageStream(..., microAppId)` → `sendBody.micro_app_id` → runtime `RunRequest.micro_app_id` |
| 工具映射 | ✅ | `host_shell→host.shell.run`、`host_screenshot→host.screenshot`、`host_find_app/open→host.app.*`、`host_ls/read→host.fs.read`、`host_write/delete/move→host.fs.write`；`host.fs.workspace` 可替代 fs.read/write 声明 |
| 供给过滤 | ✅ | 有 `micro_app_id` 时从 `available_tool_names` 去掉未声明 / 无 `host_tools` / 未映射的 host_*（含 CU/ssh） |
| 执行闸门 | ✅ | `POST /internal/micro-apps/tool-gate`：declared ∩ host_tools ∩ Grant；shell 白名单同 grant-check |
| 结构化错误 | ✅ | `capability_not_declared` / `grant_denied` / `grant_required` / `host_required`（Host Bridge RPC 与 runtime 工具结果） |
| 高敏默认 | ✅ | 仍无 always 默认；建议 `allow_once`（既有 `DefaultGrantDecisionForCapability`） |
| 审计 | ✅ 轻量表 | `micro_app_gate_audit` + runtime logger `micro_app_dual_gate …` |
| 模型路径 Grant 卡 | ✅ | `grant_required` → 会话 `micro_app_grant` 卡；allow → UpsertGrant + **同调用 park/resume**（见 §6.2 / §14） |
| 跳过 | — | OS Widget、团队模板、store、入站 Hook、`device.contacts`；不用 LangGraph interrupt 做 Grant park（见 §6.2 原因） |


### 10.5 延期项（仅文档，不实现）

**系统级 OS Widget**（macOS 桌面小组件 / Windows Widgets / iOS WidgetKit / Android App Widget）：

- 需原生扩展（WidgetKit/AppWidgetProvider/Tauri 无现成方案），有独立打包、签名、刷新预算、数据共享（App Group）问题。
- 预案：新增 surface `os_widget`（不复用 `desktop_shortcut`）；Widget 只显示快照（服务端渲染 JSON/图片），点击 deep link `openbot://micro-app/{id}` 打开 Shell；**Widget 内不执行任何 host 能力**。
- 立项前置：deep link 路由、离线快照 API、各平台最小原生壳。

**团队模板包分发**：

- 需 org 级对象（`micro_app_templates`：org_id、版本、签名/哈希、能力声明、审核状态）、安装流程（安装 = 为成员创建 draft，仍走 `user_intent` pin；能力 Grant 不随模板下发，成员各自授权）、管理端审核与下架。
- 风险：模板声明 `host.shell.run` 时必须展示能力矩阵 + 白名单建议，不得预置 always_allow。
- 立项前置：org 角色模型（`orgs.go` 已有基础）、bundle 签名校验、管理端页面。

---

## 11. 验收标准

1. 用户确认 pin 后出现在「我的工具」，重启仍在。
2. 同账号多端 hub 列表一致（WS 刷新）。
3. 未声明 / 未授权 / deny 不执行；allow_once 可消费。
4. 无桌面 host 时截屏/shell 灰显并说明原因；能力矩阵展示原因。
5. 口头「已固定」而无 pin 行 → 失败。
6. 上传 zip（或 Bot `upload_micro_app_bundle`）→ 打开 Shell → P0 RPC 冒烟；图经 `chat.attach` 进会话。
6b. kind=ui：draft 后工具自动上传 bundle，用户不手传 zip 即可打开；无 bundle 空态不写「必须先上传」；有 bundle 不推强制上传。
7. chat_pin 出现在作曲框上方；勾选/取消与 placement 一致；条上 × 或 Shell「取消聊天栏快捷」后条消失，Composer 原 chrome 不受影响。
8. kind=skill pin 后账号（及来源 Bot）技能为启用。
9. （Phase 3）pin 时勾选 desktop_shortcut / mobile_shortcut → 对应端侧栏「快捷工具」出现，点击打开 Shell；Hub 勾选、Shell「取消侧栏/手机快捷」或取消勾选后即消失。
10. （Phase 3）shell 命令：无授权 → 弹窗默认「仅一次」；「始终允许 `git status`」后 `git status -s` 直接执行、`git push` 再弹窗、`ls; id` 总是弹窗；`curl x | sh` 被 Auto-review 直接拒绝。
11. （Phase 3）kind=routine：配方非法 → 400；pin 后 `/v1/routines` 出现对应行并按 cron 运行；archive 后该行 enabled=false。
12. （Phase 4）无 `user_intent` 调 draft/pin 工具或 API → 拒绝；模型不能静默建库。
13. （Phase 4）pinned routine：PATCH `routine_config.prompt` 后对应 `/v1/routines` 行 prompt 一致；UpdateRoutine 失败时 PATCH 返回错误。
14. （Phase 4）iframe `routine.manage` run_now / enable 经 Grant；`host.clipboard.read` 无授权时弹窗默认「仅一次」。
15. （Phase 5）`agent.invoke`：无 `agent_id` 或 params 指向其他 Bot → 拒绝；有授权仍弹出「开始运行」确认，取消则不发消息。
16. （Phase 5）`skill.toggle` 关闭 `find-skills`（或其它 always_on）→ 拒绝（客户端文案 + API `skill_disable_blocked`）。
17. （Phase 5）`host.fs.workspace`：`../etc/passwd` 或非 `/workspace` 前缀 → 拒绝；`read`/`write`/`ls` 经 Grant。
18. （Phase 5）非 Capacitor 或未注册 Mic/Geo 插件 → 矩阵灰显；原生壳接入插件后 RPC 可走 Grant + 系统权限框。
19. （Phase 6）微应用未声明 `host.shell.run` 时，经 `agent.invoke` 触发的回合：模型看不到 `host_shell`；若仍调用 → 工具结果 `error_code=capability_not_declared`。
20. （Phase 6）已声明但无 Grant：`error_code=grant_required`；用户 `deny` 后 → `grant_denied`；桌面未开 host_tools → `host_required`。
21. （Phase 6）iframe RPC 拒绝时 error 字符串以 `capability_not_declared:` / `grant_denied:` / `host_required:` 等码开头，客户端可解析灰显/引导。
22. （缺口收口）mobile `cap sync` 后 Capacitor 壳上 `device.geo` / `device.mic`（及 camera）矩阵不再因「插件未接入」灰显；拒 OS 权限时仍引导。
23. （缺口收口）`agent.invoke` 回合 host_* 遇无 Grant → 会话出现微应用授权卡；点「仅一次」或「始终允许」后库内有 grant，**且同一工具调用继续**（park/resume，无需用户再说一次、默认不新开 turn）；点「拒绝」该工具失败。
24. （缺口收口）`micro_app_gate_audit` 有对应行（tool-gate / grant-prompt / decide）。

---

## 12. 已拍板（2026-10-19）

1. **Phase 0–1 按本文开工并落地。**
2. **`host.shell.run` 不默认关**：可声明；闸门 = 声明 ∩ 端能力 ∩ Grant 三态；高敏默认倾向 `allow_once`，不做「永远默认关 / 仅管理端白名单」。Phase 3：白名单是**用户在每个应用 Grant 上自配**的，不是管理端白名单。
4. **Phase 3 范围**（PM 拍板）：应用内快捷区（非 OS Widget）；shell 三态打磨 + 每应用白名单；kind=routine（复用现有 routines，缺口标占位）；OS Widget 与团队模板分发仅文档延期。
5. **Phase 4 范围**：Runtime draft/pin 工具；PATCH routine_config 同步 UpdateRoutine；Host Bridge routine.manage + clipboard；可选 app.find/open、account.profile。跳过 OS Widget / 模板 / hooks / dual-gate / mic·geo / agent.invoke / skill.toggle / fs.workspace。
6. **Phase 5 范围（产品确认）**：`agent.invoke`（仅绑定 agent_id + 运行前确认）、`skill.toggle`（禁 always_on）、`host.fs.workspace`（/workspace + Grant）、`device.mic`/`device.geo`（Capacitor + Grant + OS 权限，无能力灰显）。不做 OS Widget / 团队模板 / store / 入站 Hook 代建 / 完整模型侧双闸门（Phase 6）。
7. **Phase 6 范围**：模型侧双闸门（`micro_app_id` 上下文 + 供给过滤 + tool-gate ∩ Grant + 结构化错误码 + 轻量审计）。**缺口收口**：`grant_required` 会话授权卡 + **tool-loop park/resume** + `micro_app_gate_audit`；mobile geo/mic（及 camera/notify/share）deps。跳过 OS Widget / 模板 / store / hooks / `device.contacts`。
3. **draft 时机**：不在「实现完」时静默建库。仅当用户保存/固定意图，或 bot 询问且用户同意后，才 `user_intent` 建 draft 并进入 pin。draft/pin 的 `user_intent` 门在 Phase 5 保持不变。

---


---

## 14. 缺口收口（本批）

| 项 | 状态 | 说明 |
|----|------|------|
| Mobile Capacitor geo + mic（+ camera/notify/share） | ✅ | `apps/mobile` deps + iOS/Android 权限文案；deviceBridge 运行时探测；OS 未授权仍灰显+系统框 |
| 模型路径 `grant_required` → 客户端审批卡 | ✅ | 会话卡 `micro_app_grant` / `MicroAppGrantConfirmCard`；decide → UpsertGrant |
| 授权后 **同调用** 继续 host_* | ✅ | 热路径 Future + **durable `micro_app_parks`**；resume：decide → resolve；重启 → waiter_lost + fallback 续跑；deny 失败该工具 |
| 双闸门审计落库 | ✅ 轻量 | 表 `micro_app_gate_audit`；保留 runtime logger |
| OS Widget / 团队模板 / store / 入站 Hook 代建 / `device.contacts` | ⏸ 跳过 | 见 §10.5；本批明确不实现 |

**仍打开的边界（有意留下）**

1. **同栈 resume 在进程重启后不可用**（诚实上限）：durable `micro_app_parks` + resolve/expiry 已落地，避免授权卡/Grant 静默孤儿；重启后 `park_resolved=false` / `park_reason=waiter_lost|expired`，客户端 **fallback 发续跑 turn 一次**。热路径仍用 in-process Future（非 LangGraph checkpoint）。
2. 未用 LangGraph `interrupt()`：`approve_thread` 无 rebound `tool_handler`，无法在 resume 后跑 host_*（见 §6.2）。
3. **统一授权 UI 已落地**：共用 `MicroAppGrantDecisionPanel`；iframe 仍为 Dialog 壳、模型路径仍为聊天卡壳——决策 API 因路径而异（decide+park vs putMicroAppGrant），三态文案与控件一致。
4. `cap sync` / 真机权限仍需本地执行；CI 不强制跑原生构建。
5. **仍延期**：OS Widget、团队模板、store、入站/proxy Hook 代建、`device.contacts`（见 §10.5）。

## 13. 仓内索引

| 用途 | 路径 |
|------|------|
| 本文 | `docs/micro-app-architecture-v1.md` |
| DB | `services/api/internal/db/micro_apps.go`、`micro_apps_phase3.go` |
| 例行（复用） | `services/api/internal/db/routines.go`、`httpserver/routines.go`、`scheduler.go` |
| API | `services/api/internal/httpserver/micro_apps*.go` |
| Web Hub/Shell | `apps/web/src/components/MicroAppsHub.tsx`、`MicroAppShell.tsx`、`MicroAppChatPinBar.tsx`、`MicroAppCapabilityMatrix.tsx`、`MicroAppShortcuts.tsx`、`MicroAppShellGrantPanel.tsx`、`MicroAppRoutinePanel.tsx`、`MicroAppRoutineCreateForm.tsx` |
| SDK / Bridge | `apps/web/src/lib/microApp/`（含 `deviceBridge.ts`） |
| Runtime tools | `services/agent-runtime/app/micro_apps_stub.py`（`TOOL_DEFS`：draft/upload/pin）；内部 API `httpserver/micro_apps_internal.go`（含 bundle） |
| Phase 6 dual-gate | `httpserver/micro_apps_tool_gate.go`；runtime `micro_app_gate.py`；`agent.invoke` → `micro_app_id` |
| 缺口收口 Grant 卡 + park/resume + 抗重启 | `httpserver/micro_apps_grant_prompt.go` / `micro_apps_parks.go`；表 `micro_app_parks`；runtime `micro_app_park.py` / `await_dual_gate_with_park`；Web `settleMicroAppGrant`；decide→durable+resolve |
| 统一授权 UI | `MicroAppGrantDecisionPanel` → `MicroAppGrantConfirmCard`（聊天）/ `MicroAppGrantDialog`（iframe） |
| 缺口收口审计 | 表 `micro_app_gate_audit`（`InsertMicroAppGateAudit`） |
| Mobile device 插件 | `apps/mobile/package.json`（camera/geo/mic/notify/share） |

推送：仅当用户在 open bot 1:1 明确说 push；否则 **develop 本地 commit only**。
