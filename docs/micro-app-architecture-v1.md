# open-bot 微应用（Micro App）技术架构与能力实现路径

> 状态：**Phase 0–3 已按本文在 `develop` 落地**（本地 commit，默认不推）；系统级 Widget / 团队模板分发为**延期项**（§10.5）  
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

- 系统级桌面 Widget / iOS·Android 桌面小组件（**延期**；Phase 3 只做应用内快捷区，见 §10.5）。
- 团队模板包分发（**延期**，见 §10.5）。
- 完整小程序商店与计费。
- 把所有 skills.sh 包自动变成微应用 UI。
- Runtime 工具 `draft_micro_app` / `pin_micro_app` 正式注册（见 stub；Phase 0–1 用 HTTP `user_intent` 门）。

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
高敏默认建议 `allow_once`：`host.shell.run`、`host.clipboard.read`、`device.mic` 等（见 `DefaultGrantDecisionForCapability`）。无记录 = 每次弹窗（默认「仅一次」）。

### 3.3.1 迁移（Phase 3）

`migrateMicroApps()` 末尾幂等追加：

```sql
ALTER TABLE micro_apps ADD COLUMN IF NOT EXISTS routine_config_json TEXT NOT NULL DEFAULT '';
ALTER TABLE micro_app_grants ADD COLUMN IF NOT EXISTS command_allowlist_json TEXT NOT NULL DEFAULT '[]';
```

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
| POST | `/v1/micro-apps` | 创建 **draft**；**必须** `user_intent`；kind=routine 可带 `routine_config` 或 `routine_id` |
| POST | `/v1/micro-apps/{id}/pin` | 用户确认固定；写 hub + `confirmed_*`；可选 `chat_pin`、`surfaces[]`（desktop_shortcut / mobile_shortcut）；**必须** `user_intent`；`kind=skill` 启用技能；`kind=routine` 绑定/创建例行任务 |
| PATCH | `/v1/micro-apps/{id}` | 改标题/能力/`routine_config` 等 |
| POST | `/v1/micro-apps/{id}/archive` | 下架并禁用 placements；kind=routine 同时**暂停**（不删）绑定的例行任务 |
| PUT | `/v1/micro-apps/{id}/placements` | 批量挂载 |
| GET | `/v1/micro-apps/{id}/grants` | 授权视图 |
| PUT | `/v1/micro-apps/{id}/grants/{capability}` | 写三态；`host.shell.run` 可带 `command_allowlist`（省略=保留，`[]`=清空） |
| DELETE | `/v1/micro-apps/{id}/grants/{capability}` | **Phase 3**：恢复「每次询问」（`?machine_id=`） |
| POST | `/v1/micro-apps/{id}/session` | 短时 scoped token（非全权 JWT） |
| GET/PUT | `/v1/micro-apps/{id}/bundle` | 下载 / 上传 zip（≤5MiB） |
| GET | `/v1/micro-apps/{id}/runtime` | 解压后的 entry + files（供 iframe srcdoc） |
| POST | `/v1/micro-apps/{id}/rpc/grant-check` | 查 Grant / 是否弹窗；`host.shell.run` 可带 `command`，返回 `command_allowlisted` / `command_allowlist` / `reason` |
| POST | `/v1/micro-apps/{id}/rpc/grant-consume` | 消费 `allow_once` |
| POST | `/v1/micro-apps/{id}/rpc/cloud.http` | 窄代理（HTTPS、禁私网；可选 `MICRO_APP_HTTP_ALLOWLIST`） |

**`user_intent` 合法值**：`save` \| `pin_agree` \| `user_save` \| `user_pin` \| `confirm`。  
禁止静默 draft/pin（无 intent → 400）。

WS：`micro_apps_changed`（`chat_hub`，对齐 `agents_changed`）；Web `useChatEventsSocket` → `refreshMicroAppsFromWS`。

代码：

- DB/handlers：`services/api/internal/db/micro_apps.go`、`micro_apps_phase3.go`（routine 配方 / shell 白名单）、`httpserver/micro_apps.go`、`micro_app_bundle.go`、`micro_app_rpc.go`、`micro_app_store.go`
- Web：`apps/web/src/api/microApps.ts`、`components/MicroAppsHub.tsx`、`MicroAppShell.tsx`、`MicroAppGrantDialog.tsx`、`MicroAppShortcuts.tsx`、`MicroAppShellGrantPanel.tsx`、`MicroAppRoutinePanel.tsx`、`MicroAppRoutineCreateForm.tsx`、`lib/microApp/*`

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

### 5.5 kind=routine（Phase 3）

仓内**已有**服务端例行任务：`routines` 表 + `/v1/routines` CRUD/run + 进程内 1 分钟调度器（`httpserver/scheduler.go`，IANA 时区）+ Slack/GitHub/HTTP 入站触发（`webhooks.go`）。因此 kind=routine **不另造调度**，而是：

1. draft 存 `routine_config`（校验：prompt 必填；5 段 cron 或 ≥1 trigger；IANA 时区；trigger.source ∈ slack|github|http；≤10 trigger；max_retries 0..10）。或直接带已有 `routine_id`（校验归属）。
2. pin（`user_intent` 门）时：有 `routine_id` → 校验存在并绑定；否则按配方 `CreateRoutine`（名称默认取标题、agent 默认取来源 Bot、enabled 默认 true）并回写 `routine_id`；两者皆无 → 400。**先物化再置 pinned**，失败不会留下「已固定但无例行」的半成品。
3. archive → `enabled=false` 暂停例行（不删除，便于恢复/审计）。
4. Shell：展示配方 + 绑定例行（上次运行/错误），可「立即运行」（`POST /v1/routines/{id}/run`）与启停；Hub 提供「＋ 例行工具」表单（点击保存 = `user_intent=user_save`，固定仍需单独确认）。

**占位/未做**（明确标注）：

- `routine.manage` 能力仅在目录中可声明，**Host Bridge 未接**（iframe 内不能改例行）。
- 事件型触发依赖用户先在「设置 → 例行任务」配好入站 Hook；微应用不代建 Hook。
- 编辑配方（PATCH `routine_config`）**不会**回写已物化的 routines 行；pin 后请在例行设置里改。
- Runtime 工具 `draft_micro_app` / `pin_micro_app` 仍未注册（`micro_apps_stub.py`）。

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

**双闸门**：Bot 工具策略（模型侧，后续）∩ MicroApp Grant（入口×设备）。

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

---

## 7. 客户端

### 7.1 Web / Desktop（`apps/web`）

1. 账户菜单「我的工具」→ `MicroAppsHub`（能力矩阵、chat_pin / desktop_shortcut / mobile_shortcut 勾选；pin 弹窗可多选入口；「＋ 例行工具」）
2. `MicroAppShell`：上传 zip、runtime → srcdoc iframe + SDK；skill 型无 bundle 时展示绑定说明
3. `MicroAppChatPinBar`：作曲框上方快捷条（`surface=chat_pin`）
4. `lib/microApp/hostBridge.ts` + `deviceBridge.ts`：RPC
5. `MicroAppGrantDialog`：审批三态文案；shell 显示命令 + 前缀白名单
6. `MicroAppShortcuts`（Phase 3）：侧栏顶部「快捷工具」宫格——桌面/宽屏用 `desktop_shortcut`，手机 sheet 首页或 Capacitor 用 `mobile_shortcut`；点击打开 Shell。**应用内入口，非系统 Widget。**
7. `MicroAppShellGrantPanel` / `MicroAppRoutinePanel`：Shell 内命令授权与例行状态

### 7.2 Android / Runtime

- Capacitor：同 H5 入口；host 能力灰显；侧栏首页显示 `mobile_shortcut` 快捷区。
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

### Phase 3 — 增强 ✅（本迭代）

| 项 | 状态 | 说明 |
|----|------|------|
| desktop_shortcut / mobile_shortcut（应用内快捷区） | ✅ | pin 弹窗可选、Hub 可勾选、存 placements；侧栏「快捷工具」宫格点击开 Shell |
| `host.shell.run` 三态打磨 + 每应用命令白名单 | ✅ | 默认「仅一次」；白名单存 Grant；Auto-review 硬拒绝优先（§6.1） |
| kind=routine | ✅（部分占位） | 复用现有 routines 调度/触发；配方校验 + 存储 + pin 物化 + archive 暂停；占位见 §5.5 |
| 系统级 OS Widget | ⏸ 延期 | 仅文档，见 §10.5 |
| 团队模板包分发 | ⏸ 延期 | 仅文档，见 §10.5 |
| Runtime 正式注册 draft/pin 工具 | ⏳ 未做 | 仍为 stub（Phase 2 遗留） |

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
6. 上传 zip → 打开 Shell → P0 RPC 冒烟；图经 `chat.attach` 进会话。
7. chat_pin 出现在作曲框上方；勾选/取消与 placement 一致。
8. kind=skill pin 后账号（及来源 Bot）技能为启用。
9. （Phase 3）pin 时勾选 desktop_shortcut / mobile_shortcut → 对应端侧栏「快捷工具」出现，点击打开 Shell；Hub 取消勾选即消失。
10. （Phase 3）shell 命令：无授权 → 弹窗默认「仅一次」；「始终允许 `git status`」后 `git status -s` 直接执行、`git push` 再弹窗、`ls; id` 总是弹窗；`curl x | sh` 被 Auto-review 直接拒绝。
11. （Phase 3）kind=routine：配方非法 → 400；pin 后 `/v1/routines` 出现对应行并按 cron 运行；archive 后该行 enabled=false。

---

## 12. 已拍板（2026-10-19）

1. **Phase 0–1 按本文开工并落地。**
2. **`host.shell.run` 不默认关**：可声明；闸门 = 声明 ∩ 端能力 ∩ Grant 三态；高敏默认倾向 `allow_once`，不做「永远默认关 / 仅管理端白名单」。Phase 3：白名单是**用户在每个应用 Grant 上自配**的，不是管理端白名单。
4. **Phase 3 范围**（PM 拍板）：应用内快捷区（非 OS Widget）；shell 三态打磨 + 每应用白名单；kind=routine（复用现有 routines，缺口标占位）；OS Widget 与团队模板分发仅文档延期。
3. **draft 时机**：不在「实现完」时静默建库。仅当用户保存/固定意图，或 bot 询问且用户同意后，才 `user_intent` 建 draft 并进入 pin。

---

## 13. 仓内索引

| 用途 | 路径 |
|------|------|
| 本文 | `docs/micro-app-architecture-v1.md` |
| DB | `services/api/internal/db/micro_apps.go`、`micro_apps_phase3.go` |
| 例行（复用） | `services/api/internal/db/routines.go`、`httpserver/routines.go`、`scheduler.go` |
| API | `services/api/internal/httpserver/micro_apps*.go` |
| Web Hub/Shell | `apps/web/src/components/MicroAppsHub.tsx`、`MicroAppShell.tsx`、`MicroAppChatPinBar.tsx`、`MicroAppCapabilityMatrix.tsx`、`MicroAppShortcuts.tsx`、`MicroAppShellGrantPanel.tsx`、`MicroAppRoutinePanel.tsx`、`MicroAppRoutineCreateForm.tsx` |
| SDK / Bridge | `apps/web/src/lib/microApp/`（含 `deviceBridge.ts`） |
| Runtime stub | `services/agent-runtime/app/micro_apps_stub.py` |

推送：仅当用户在 open bot 1:1 明确说 push；否则 **develop 本地 commit only**。
