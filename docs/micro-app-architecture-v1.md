# open-bot 微应用（Micro App）技术架构与能力实现路径

> 状态：Phase 0 已按本文开工（develop 本地 commit）  
> 日期：2026-10-19（Asia/Shanghai）  
> 范围：用户确认需求 → bot 落地 → **固定** → 跨端入口 → 按端权限调用设备能力

---

## 0. 问题与目标

**问题**：bot 在会话里实现了用户确认过的「微应用」，若不升格为独立对象，就会埋在聊天记录里——后续难找、难装入口、更无法安全调用桌面/手机能力。

**目标**：

1. 把确认后的成果持久化为**一等公民**（有 ID、版本、归属、能力声明）。
2. **单一真相**：账号级「我的工具」清单；各端只做入口适配。
3. **能力经 host 代理**：沙箱微应用不能直触系统 API；须声明 → 端支持 → 用户授权 → host 执行。
4. 复用现有栈：`skills/` + curated builtins、会话 attachments / `present_image`、审批三态、`machine_id` / host 设备模型。

**非目标（本期不做）**：

- 系统级桌面 Widget / iOS 桌面小组件（仅预留 placement）。
- 完整小程序商店与计费。
- 把所有 skills.sh 包自动变成微应用 UI。

---

## 1. 概念分层

| 层 | 名称 | 存什么 | 谁消费 |
|----|------|--------|--------|
| A | **Capability** | Skill / MCP / host 工具能力 | agent-runtime、Bot |
| B | **MicroApp** | 用户固定的可打开对象（UI bundle 或能力型入口元数据） | 各端「我的工具」 |
| C | **Placement** | 入口挂载位置（hub / chat_pin / desktop_shortcut / mobile_shortcut） | 各端壳 |
| D | **Grant** | 用户×微应用×能力×设备 授权 | API + 客户端审批 UI |
| E | **Session/Host** | 当前连接的电脑/手机 host | desktop host / Capacitor |

关系：

```
用户确认 → pin → MicroApp(pinned)
                ├─ kind=ui      → bundle(HTML/组件) + capabilities[]
                ├─ kind=skill   → 绑定 skill slug（打开=启用并引导）
                └─ kind=routine → 绑定定时/触发配方
Placement 只指向 MicroApp.id
打开 UI 型 → 沙箱 iframe → postMessage RPC → Client Host Bridge →（必要时）OS 权限
```

**固定 ≠ 展示**：截图「每次都展」是消息可见性；「固定」才是持久化进 MicroApp 库。

---

## 2. 系统架构

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Web / Desktop│  │ Android 壳   │  │ 管理端 Admin │
│ (apps/web)   │  │ (Capacitor)  │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ REST/WS/SSE      │                  │
       ▼                  ▼                  ▼
┌─────────────────────────────────────────────────┐
│ services/api                                      │
│  micro_apps / placements / grants / attachments   │
│  agents skills seed / curated-builtins            │
│  chat WS: micro_apps_changed（对齐 agents_changed）│
└───────────────┬─────────────────┬─────────────────┘
                │                 │
                ▼                 ▼
     ┌──────────────────┐  ┌─────────────────────┐
     │ agent-runtime    │  │ Object storage / FS  │
     │ pin 工具、技能、 │  │ micro-app bundles   │
     │ present_image    │  │ attachment blobs    │
     └────────┬─────────┘  └─────────────────────┘
              │ host_* tools
              ▼
     ┌──────────────────┐
     │ Host Agent       │  桌面优先电脑 / 手机本机
     │ screenshot/file… │
     └──────────────────┘
```

### 2.1 打开 UI 微应用时的运行时

```
[我的工具] 点击 MicroApp
    → GET /v1/micro-apps/{id}
    → 客户端打开 MicroAppShell（全屏/侧栏）
    → <iframe sandbox="allow-scripts allow-forms"
         csp="default-src 'none'; img-src blob: data: https:; …"
         srcdoc|blobURL=bundle>
    → iframe 内 SDK: openbot.micro.request(capability, params)
    → parent 校验：声明 ∩ 端能力 ∩ Grant
    → 缺 Grant → 弹出审批三态（allow_once / always_allow / deny）
    → 通过后：
         · 纯云端能力 → API 代调
         · 需本机 → Host Bridge（当前 machine_id）
    → 结果回 iframe；若需给用户看图 → 走附件 URL（同 present_image）
```

---

## 3. 数据模型

### 3.1 `micro_apps`

| 字段 | 说明 |
|------|------|
| `id` | UUID |
| `user_id` | 归属账号 |
| `agent_id` | 可选；来源 Bot |
| `title` / `description` / `icon` | 展示 |
| `kind` | `ui` \| `skill` \| `routine` |
| `status` | `draft` \| `pinned` \| `archived` |
| `version` | 单调递增 |
| `bundle_key` | 对象存储 key（ui） |
| `bundle_hash` | SHA-256 |
| `entrypoint` | 如 `index.html` |
| `skill_slug` | kind=skill 时 |
| `routine_id` | kind=routine 时 |
| `capabilities` | JSON 字符串数组，见 §5 |
| `source_conversation_id` / `source_message_id` | 溯源 |
| `confirmed_at` / `confirmed_by` | 用户确认门 |
| `created_at` / `updated_at` | |

### 3.2 `micro_app_placements`

| 字段 | 说明 |
|------|------|
| `micro_app_id` | |
| `surface` | `hub` \| `chat_pin` \| `desktop_shortcut` \| `mobile_shortcut` |
| `context_id` | 可选：某 conversation / agent |
| `sort_rank` | |
| `enabled` | |

规则：`pin` 默认只写 `hub`；其它 surface 显式勾选。

### 3.3 `micro_app_grants`

| 字段 | 说明 |
|------|------|
| `user_id` | |
| `micro_app_id` | |
| `capability` | 如 `host.screenshot` |
| `machine_id` | 设备维度；敏感能力必填 |
| `decision` | `allow_once` \| `always_allow` \| `deny` |
| `expires_at` | allow_once 用完或 TTL |
| `updated_at` | |

对齐现有审批三态文案与客户端卡片。

### 3.4 与现有表关系

- **attachments**：会话展图/文件仍用现通道；MicroApp bundle **不**塞进 message row。
- **agent_skills**：kind=skill 固定时 `enabled=true`（find-skills 仍 `always_on`）。
- **machines / client_env**：Grant 与 host 路由用 `machine_id`、`host_eligible`、`device_type`。

---

## 4. API 草图

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/v1/micro-apps` | 列表；`?surface=hub` |
| GET | `/v1/micro-apps/{id}` | 元数据 + 签名 bundle URL |
| POST | `/v1/micro-apps` | 创建 draft（runtime/工具） |
| POST | `/v1/micro-apps/{id}/pin` | 用户确认固定；写 hub |
| PATCH | `/v1/micro-apps/{id}` | 改标题/placement |
| POST | `/v1/micro-apps/{id}/archive` | 下架 |
| PUT | `/v1/micro-apps/{id}/placements` | 批量挂载入口 |
| GET | `/v1/micro-apps/{id}/grants` | 当前设备授权视图 |
| PUT | `/v1/micro-apps/{id}/grants/{capability}` | 写入三态 |
| POST | `/v1/micro-apps/{id}/session` | 签发短时 micro-app token（仅该 app） |
| GET | `/v1/micro-apps/{id}/bundle` | 鉴权拉 bundle |

WS 事件：`micro_apps_changed`（同用户多端刷新，对齐 `agents_changed`）。

Runtime 工具（建议）：

- `draft_micro_app` — 产出 draft（含 bundle 或 skill 绑定）
- `pin_micro_app` — **仅在用户确认后**由系统/显式工具调用；禁止模型静默 pin
- 现有 `present_image` / host_* 不变

---

## 5. 能力目录（Capability Catalog）

统一命名：`domain.action`。每条声明：

- `os_permission`：系统权限（若有）
- `host_required`：是否必须 host
- `surfaces`：desktop / mobile / web
- `sensitivity`：low / medium / high
- `phase`：P0 / P1 / P2

### 5.1 已有或可快速对齐（P0）

| capability | 含义 | 端 | 系统权限 | 实现路径 |
|------------|------|----|----------|----------|
| `host.screenshot` | 截屏 | desktop（主） | 录屏/屏幕录制 | 复用 `host_screenshot` → image_base64 → attachment；MicroApp RPC 同桥 |
| `host.clipboard.read` | 读剪贴板 | desktop/mobile | 剪贴板 | Host 桥；high；默认 allow_once |
| `host.clipboard.write` | 写剪贴板 | 同上 | 同 | 同上 |
| `host.fs.read` | 读用户选定文件 | desktop | 文件选择器 | 系统文件对话框，**不**广域扫盘 |
| `host.fs.write` | 写到用户选定路径 | desktop | 文件保存框 | 同上 |
| `cloud.http` | 服务端代发受限 HTTP | 全端 | 无 | API allowlist 代理；禁任意 SSRF |
| `ui.notify` | 应用内通知 | 全端 | 无 | 客户端 toast / 会话卡片 |
| `chat.attach` | 把结果图/文件送进当前会话 | 有会话上下文 | 无 | 复用 attachments + markdown 图链 |

### 5.2 Host 增强（P1）

| capability | 含义 | 端 | 系统权限 | 实现路径 |
|------------|------|----|----------|----------|
| `host.app.find` | 找已装应用 | desktop | 无/辅助 | 对齐 `host_find_app` |
| `host.app.open` | 打开应用/URL | desktop/mobile | 无 | 系统 open URL / deep link |
| `host.shell.run` | 受控命令 | desktop | 高敏 | 可声明；Grant 三态；建议默认弹 allow_once；可配 allowlist，**不**默认整项关闭 |
| `host.fs.workspace` | 读写 Bot 工作区目录 | desktop | 目录授权 | 限定 workspace root |
| `device.notify` | 系统通知 | desktop/mobile | 通知权限 | Capacitor Local Notifications / OS |
| `device.camera` | 拍照/扫码 | mobile | 相机 | Capacitor Camera；Grant + OS 双授权 |
| `device.mic` | 录音 | mobile/desktop | 麦克风 | 同上 |
| `device.geo` | 定位 | mobile | 定位 | 同上 |
| `device.contacts` | 通讯录 | mobile | 通讯录 | **默认不进第一批**；需单独产品开关 |
| `device.share` | 系统分享 | mobile | 无 | Share Sheet |

### 5.3 云与账号（P0–P1）

| capability | 含义 | 实现路径 |
|------------|------|----------|
| `account.profile` | 读展示名等非敏感资料 | API scope 最小化 |
| `agent.invoke` | 唤起绑定 Bot 跑一轮 | 限该 micro_app.agent_id；带用户可见确认 |
| `skill.toggle` | 开关某 skill | 走现有 skills API；不可关 `always_on` |
| `routine.manage` | 创建/改 routine | 对齐服务端 routines（若已有）或延后 |

### 5.4 明确不做或极高门槛（P2+）

- 任意短信/通话、后台偷偷录屏、无提示读全盘、无提示通讯录批量导出。
- Web 端伪装成已有桌面 host：无 host 则入口灰显，可「在电脑上打开」。

---

## 6. 权限与授权状态机

```
请求 capability C
  → C ∉ MicroApp.capabilities？ → 400 capability_not_declared
  → 当前 surface 不支持 C？ → 403 capability_unavailable_on_surface（UI 灰）
  → 需要 host 且无可用 machine？ → 403 host_required
  → 查 grants(user, app, C, machine)
       deny → 拒绝
       always_allow 且未过期 → 执行
       allow_once 剩余次数>0 → 执行并消费
       无记录 → 弹审批卡
            allow_once / always_allow / deny → 写 grants → 继续或停
  → 若需 OS 权限且未授 → 调起系统权限框；失败则停
  → Host/API 执行 → 审计日志
```

**双闸门**：Bot 工具策略（模型能否调 host_*）∩ MicroApp Grant（这个入口能否碰这台设备）。

敏感默认：`clipboard.read`、`shell.run`、`contacts`、`mic` → 默认无 always，或仅 allow_once。

---

## 7. 客户端实现路径

### 7.1 Web / Desktop 壳（`apps/web`）

1. 侧栏「我的工具」→ `GET /v1/micro-apps?surface=hub`
2. `MicroAppShell`：顶栏标题 + iframe
3. `HostBridge`（desktop）：与现有 desktop host 通道共用；注入 `machine_id`
4. 审批卡：复用审批三态组件
5. chat_pin：输入框上方快捷条（P1）

### 7.2 Android（Capacitor）

1. 同 H5「我的工具」
2. `MobileHostBridge`：Camera / Mic / Notify / Share 插件
3. `host.screenshot` 等桌面能力：灰显 +「请在已连接电脑上使用」
4. 登录手机 ≠ host：沿用 `host_eligible` / `device_type`

### 7.3 桌面原生 host

1. 扩展 RPC 表：与 capability 名 1:1 或映射表
2. 每次调用带 `micro_app_id` + session token，防越权
3. 录屏等 OS 权限失败时返回结构化错误，供 UI 引导

---

## 8. Runtime / 创建与固定路径

```
聊天中 bot 实现
  → 仅当用户有保存意图，或 bot 确认「要不要固定」且用户同意
  → draft_micro_app 写入 status=draft + bundle（或 skill 绑定）
  → 助手气泡确认卡 / 用户说固定 → POST .../pin
       · 写 confirmed_*
       · placement hub
       · 若 kind=skill → Seed/Enable 该 skill
  → WS micro_apps_changed → 各端刷新
```

禁止：实现完静默建 draft；禁止仅凭模型一句「已固定」而无 pin API。

Bundle 规范（ui）：

```
bundle.zip
  manifest.json   # name, entry, capabilities[], openbot_sdk_version
  index.html
  assets/...
```

`manifest.capabilities` 必须 ⊆ 服务端写入的 `micro_apps.capabilities`（pin 时校验）。

---

## 9. 安全

1. iframe：`sandbox` 无 `allow-same-origin`（或隔离 origin blob）；严格 CSP。
2. Session token：短 TTL、绑定 `micro_app_id`、不可升为用户全权 token。
3. `cloud.http`：URL allowlist / 禁止内网。
4. Bundle：大小上限、hash 校验、病毒扫描可后期加。
5. 审计：`micro_app_id, capability, machine_id, decision, ts` 入库。
6. 与 journal「不存图」策略：展图走 attachment；bundle 存对象存储，不进 LLM journal。

---

## 10. 分阶段落地（实现路径总表）

### Phase 0 — 协议与空壳（约 1 迭代）

- [x] DB：`micro_apps` / `placements` / `grants`
- [x] API：list/get/pin/archive + session
- [x] Web：我的工具列表 + 空壳打开（无 host RPC）
- [x] Runtime：draft + 确认卡文案；pin 仅用户触发（API `user_intent` 门；runtime 工具 Phase 1）
- [x] WS：`micro_apps_changed`

### Phase 1 — UI 微应用 + P0 能力

- [ ] Bundle 上传/下载 + 沙箱 iframe + JS SDK
- [ ] RPC：`host.screenshot`、`host.fs.read/write`（选文件）、`chat.attach`、`ui.notify`、`cloud.http`（窄）
- [ ] Grants + 审批三态复用
- [ ] 与 `present_image` 对齐：微应用产出图可进会话

### Phase 2 — 入口与移动

- [ ] chat_pin 快捷条
- [ ] Android：`device.camera` / `device.notify` / `device.share`
- [ ] 端能力矩阵 UI（不可用原因）
- [ ] kind=skill 固定 ↔ agent_skills

### Phase 3 — 增强与暂缓项

- [ ] desktop_shortcut / mobile_shortcut（应用内捷径，非系统 Widget）
- [ ] `host.shell.run`（P1 可声明；三态审批，建议默认 allow_once）
- [ ] kind=routine
- [ ] 系统级 Widget（单独立项）
- [ ] 团队模板包分发微应用

---

## 11. 验收标准（产品）

1. 用户确认后，微应用出现在「我的工具」，杀进程重开仍在。
2. 换 Web/Desktop/Android 登录同一账号，hub 列表一致。
3. 未声明能力调用失败；未授权弹三态；拒绝后不再执行。
4. 手机上打开需桌面截屏的微应用：入口或按钮灰显，并提示连电脑。
5. 仅口头「已固定」而无 pin 记录 → 验收失败。
6. 截图展图与固定互不干扰：可展可不固定；可固定后从 hub 再打开。

---

## 12. 与现有决策对齐

| 已拍板 | 在本架构中的落点 |
|--------|------------------|
| 精选内置 skills + find-skills always_on | Capability 层；发现仍走 find-skills |
| 助手带图 present_image | `chat.attach` / 展图通道 |
| 审批三态 | Grant.decision |
| 手机登录≠host | host_required 灰显 |
| 团队包暂缓 | Phase 3 分发 |

---

## 13. 已拍板（2026-10-19）

1. **Phase 0–1 按本文开工。**
2. **`host.shell.run` 不默认关**：可声明；仍走「声明 ∩ 端能力 ∩ Grant 三态」；高敏默认倾向 `allow_once`，但不做「永远默认关 / 仅管理端白名单」一刀切。
3. **draft 时机**：不在「实现完」时静默建库。仅当（a）用户表达保存/固定意图，或（b）bot 向用户确认「要不要固定到我的工具」且用户同意后，才创建 draft 并进入 pin 流程。

## 14. 下一步

交给 open bot：按 Phase 0 落库+API+空壳「我的工具」，再 Phase 1 沙箱与 P0 能力；develop 本地 commit，不推，除非用户在 open bot 1:1 说 push。

