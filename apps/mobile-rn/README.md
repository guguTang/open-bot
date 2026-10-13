# @open-bot/mobile-rn

Open Bot 的 React Native 移动端。**独立于** `apps/mobile`（那是复用 `apps/web/dist` 的 Capacitor 壳，两条路线并存）。

技术栈：**Expo SDK 57 · React Native 0.86 · Expo Router · HeroUI Native（Uniwind）**

## 为什么是这套

> 选型原则：**`apps/mobile` 只是功能参考，不是实现参考。**
> 那个 Capacitor 壳把整个 `apps/web` 塞进 WebView，它的做法属于浏览器那一套；
> 这里要按 React Native 的路子重新选型，依据是 2026 年 RN 生态的社区实践。

### 状态与数据

| 决策                            | 原因                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack Query 管服务端状态** | 社区共识：服务端状态（列表、会话、设置页数据）和客户端状态必须分开管。两者失败的方式不同 —— 前者会过期、要重取、会因写操作失效；后者不会。混在一个 store 里，缓存失效逻辑会写成一团。 |
| **Zustand 管客户端状态**        | 同一套共识的另一半。当前选了哪个 Bot、列表折叠、在线绿点这些「不来自服务器、又跨页共享」的东西放 `src/stores/`。                                                                      |
| `expo-secure-store` 只存密钥    | JWT 存 Keychain / Keystore，不进明文存储。                                                                                                                                            |
| **AsyncStorage 存偏好**         | 列表折叠、引导标记、上次打开这类数据不是机密，不必进 Keychain。经内存镜像对外仍同步读；Expo Go 可持久化，启动时 `hydratePrefs()` 灌盘。                                              |

### 渲染

| 决策                                           | 原因                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@ronradtke/react-native-markdown-display`** | 社区标准库（v9，周下载 5.6 万，维护活跃）。关键是 `MarkdownStream`：解析前会补齐未闭合围栏，正好解决流式输出时半截代码块反复改变布局的问题 —— 这个坑原先要靠手写增量缓存硬扛。附带 prism 语法高亮和代码复制按钮。 |
| **`expo-mermaid` 而非第三方渲染服务**          | 纯 JS 解析 + `react-native-svg` 直绘，无 WebView、无第三方服务、离线可用，覆盖 25 种图表。早期版本曾把图表源码发给 mermaid.ink 换图 —— 那是当时 RN 生态没有原生方案时的将就。                                     |
| **`expo/fetch` 而非全局 `fetch`**              | RN 内置 fetch 是 XHR polyfill，拿不到 `res.body`，SSE 会退化成一次性返回。`expo/fetch` 提供真正的 ReadableStream，Web 端 `readSSEStream` 的逻辑可以原样移植。                                                     |
| **`react-native-webview` 只用于 HTML 与桌面**  | HTML 产物本来就是网页、noVNC 桌面本来就是网页，这两处没有原生等价物，所以走 WebView。Markdown 和 Mermaid **不走** WebView。WebView 只在真正打开预览时挂载，不进首屏树。                                           |
| `heroui-native` 而非 `@heroui/react`           | 两者包名、样式引擎（Uniwind vs Tailwind）、颜色格式（HSL vs oklch）都不同，Web 端的写法不能直接搬。                                                                                                               |
| 文件下载走 `expo-file-system` + `expo-sharing` | 产物与附件接口都要 `Authorization: Bearer`，所以不能把地址丢给 `Linking.openURL`（那等于把 JWT 暴露在 URL 和系统日志里）。带鉴权头落盘到 cache，再交给系统分享面板。                                              |
| 保持 pnpm 隔离安装                             | Expo SDK 55+ 在 monorepo 里自动启用 `autolinkingModuleResolution`，Metro 默认跟随 symlink，**不需要**把仓库降级成 `nodeLinker: hoisted`。                                                                         |

## 前置条件

- Node ≥ 20.19.4、pnpm ≥ 10
- 后端已启动：`make dev-runtime` + `make dev-api`（默认 `http://127.0.0.1:18080`）
- **iOS 模拟器需要完整 Xcode**（本机当前只有 CommandLineTools，`xcrun simctl` 不可用）。
- **OIDC / Casdoor 登录需要 dev build**（自定义 scheme 回调 Expo Go 不支持）—— 详见下方「部署注意」。用户名密码登录与偏好持久化在 Expo Go 可用。

## 启动

```bash
pnpm start          # 或 make dev-mobile-rn（仓库根）
pnpm clear          # 清 Metro 缓存再起（换网 / 改过强制覆盖后）
```

`pnpm start` 经 `scripts/with-lan-api.mjs` **自动探测本机局域网 IP**，注入
`EXPO_PUBLIC_OPENBOT_API_BASE=http://<LAN>:18080`，真机与模拟器都能打到 API。
启动时终端会打印一行 `[mobile-rn] API base (LAN): ...`。

覆盖方式（按优先级）：

1. shell：`EXPO_PUBLIC_OPENBOT_API_BASE=https://xxxx.ngrok-free.app pnpm start`
2. `apps/mobile-rn/.env` 里写非环回地址（见 `.env.example`）
3. 否则自动 LAN IP

未走启动脚本时的平台回退：iOS 模拟器 `127.0.0.1`，Android 模拟器 `10.0.2.2`。

## HeroUI Pro

本项目用的是开源版 `heroui-native`。Pro 版是**独立付费包** `heroui-native-pro`，需要授权：

```bash
npx heroui-pro@latest login     # 浏览器里用 GitHub 账号授权，必须本人在终端操作
npx heroui-pro@latest install   # 拉取产物 + 装 peer deps + 配置包管理器
```

装完还需要在 `src/global.css` 里补两行：

```css
@import "heroui-native-pro/styles";
@source '../node_modules/heroui-native-pro/lib';
```

`pnpm-workspace.yaml` 已经把 `heroui-pro` / `heroui-native-pro` 加进 `onlyBuiltDependencies`，否则 pnpm 10 会拦掉它们的 postinstall，产物下不下来。CI 用 `HEROUI_AUTH_TOKEN` 环境变量代替交互登录。

## 目录

```
src/
├── api/
│   ├── config.ts   API 地址（平台默认值 + EXPO_PUBLIC_* 覆盖）
│   ├── http.ts     expo/fetch 封装，统一鉴权、multipart 上传与错误
│   ├── sse.ts      SSE 解析，逐行移植自 apps/web/src/api.ts
│   ├── session.ts  SecureStore 存取 JWT
│   ├── client.ts   客户端环境信封 + 本机 machine key
│   ├── index.ts    业务端点（与 Web 端一一对应）
│   └── types.ts    与 Web 端对齐的契约类型
├── app/            Expo Router 路由（root 在 src/app）
│   ├── _layout.tsx  Provider 装配
│   ├── index.tsx    按登录态重定向
│   ├── login.tsx    登录 / 注册
│   ├── collab.tsx   协作收件箱（agent-bus + 频道成员）
│   ├── chats/
│   │   ├── index.tsx  助手 + 群聊列表，长按管理
│   │   └── [id].tsx   聊天页（SSE 流式 + 附件 + @点名 + 停止 + 重连续跑）
│   └── settings/     全量设置页（对齐 Web MobileSettingsHub）
│       ├── index.tsx  分区入口
│       ├── server.tsx / review.tsx / integrations.tsx
│       ├── llm / skills / mcp / routines / compact / sandbox / machines / secrets / bot / general
├── components/     共享组件（Markdown / Composer / 气泡 / CloneAgent / GroupMembers / …）
├── lib/            纯函数（toolAllowlist、citationMarkers、格式化、附件、@提及…）
└── providers/
    ├── session.tsx       登录态 Context
    └── secretPrompt.tsx  全局密钥授权弹窗（8s 轮询）
```

## 功能对齐状态

已与 `apps/web` 终端用户功能面对齐（本轮全量对照追平）：

- **聊天**：Markdown、运行状态、附件、产物卡、引导卡、停止 / 打断、群聊 @、引用脚注（citation + 来源 footer）
- **聊天互动**：表情、长按面板、引用回复、线程、反馈（提交后可「去训练」）、Handoff、Host 确认**三态**（允许一次 / 始终允许 / 拒绝，含 `email_send`）
- **训练**：账号菜单入口 + `/train` 三 Tab；反馈后可达
- **产物**：鉴权下载分享、HTML/SVG WebView、Mermaid（`expo-mermaid`）
- **导航**：助手 / 群聊、新建 / 编辑 / **复制助手** / 删除、协作、设置、训练
- **群聊**：聊天页成员 sheet（增删成员）
- **形象**：剪影 + 主色 + 优先电脑
- **协作**：收件箱 WS + 轮询；投递与成员用**列表 Chip 选择**（非文本精确匹配）
- **设置 Hub**（对齐 MobileSettingsHub）：服务器、插件、当前 Bot、优先电脑、审核 allowlist、模型、技能、沙箱、例行、压缩、**连接应用 / Gmail**、密钥、时区与自动审核
- **登录**：用户名密码 + Casdoor OIDC

## 对照矩阵（相对 apps/web）

### 已追平

| 能力 | Web | mobile-rn |
|------|-----|-----------|
| 审批三态 | HostConfirmCard + decision | HostConfirmCard + `/settings/review` |
| 审核 allowlist | ReviewSettingsTab | `/settings/review` |
| 连接应用 / Gmail | IntegrationsSettingsTab | `/settings/integrations` |
| 服务器切换 | Hub「服务器」 | `/settings/server` |
| 复制助手 | CloneAgentModal | 列表菜单 + Bot 设置 |
| 引用脚注 | citationMarkers + sources footer | Markdown + MessageSourcesFooter |
| Host `email_send` | 确认卡文案 | HostConfirmCard |
| Train 入口 | 反馈链路 | 账号菜单 + 反馈后「去训练」 |
| Hub 分区 | MobileSettingsHub | `settings/index` |
| 群成员管理 | GroupMembersSettings | `GroupMembersSheet` |
| 协作选择器 | 下拉 | Chip 列表选择 |

### 有意裁剪 —— 裁决（保留，非遗漏）

- **Mermaid 覆盖 25 种图表，语法变体有限**：`expo-mermaid` 不支持 `flowchart-elk`、`init` 指令、部分 handDrawn 变体。解析不了则退回源码视图，并保留「复制源码」。
- **沙箱内部信息对用户隐藏**：`container_id` / `image` / `workdir_host` / 宿主路径不下发（产品硬要求）。
- **会话列表无独立页面**：主导航是「助手 / 群聊」主线程；`ConversationList.tsx` 备选未挂载（与 Web 产品模型一致）。
- **MCP server 无编辑表单**：与 Web 一致（仅 toggle `enabled`）。
- **HTML 消毒偏保守**：RN 无 DOM，正则剥离 `script` / `iframe` / `on*` / `javascript:` + CSP；依赖 JS 的 HTML 产物预览为静态。
- **技能包不支持文件夹选择**：无 `webkitdirectory`；zip / 正文上传可用。
- **ATS `NSAllowsArbitraryLoads`**：上架前另开任务清理，不进本轮功能追平。

## 部署注意

### ⚠️ OIDC 需要 dev build（Expo Go 不够）

偏好已改用 `@react-native-async-storage/async-storage`（Expo Go 可用）。
仍依赖自定义 scheme 的是 OIDC：

| 依赖                | 为什么 Expo Go 不行                                   | 缺了会怎样                                                  |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| OIDC / Casdoor 登录 | 自定义 scheme 回调需要注册 URL scheme，Expo Go 不支持 | 「用 Casdoor 登录」按钮点了没反应（用户名密码登录不受影响） |

要用 Casdoor 登录，打 dev build：

```bash
npx expo prebuild        # 生成 ios/ 与 android/ 原生工程
npx expo run:ios         # 或 run:android
# 或者用 EAS Build 打到真机
```

`lib/storage.ts`：AsyncStorage 落盘 + 内存镜像，对外仍是同步 `readJson` /
`writeJson`；根布局 `hydratePrefs()` 后再渲染，避免首帧默认值闪烁。

### OIDC 需要把回调地址配成自定义 scheme

后端把 `redirect_uri` 烘焙进 `authorize_url`（见 `services/api/internal/auth/oidc.go`），所以必须：

```bash
# .env
CASDOOR_REDIRECT_URI=openbot://auth/callback
```

并把这个地址登记到 Casdoor 的回调白名单。scheme 见 `app.json` 的 `scheme: "openbot"`。

技术债：

- `app.json` 里 `NSAppTransportSecurity.NSAllowsArbitraryLoads: true` 是为本地开发放开的，**上架前必须移除**。
- Metro `watchFolders` 指向仓库根，会监听整个仓库；装 `watchman`（`brew install watchman`）能明显减轻负担。
- `expo-mermaid` 把 TypeScript 源码当 `types` 入口发布，导致 `tsc` 会去检查它的内部实现（对 RN 0.86 / React 19 不兼容）。已用 `src/types/expo-mermaid.d.ts` + tsconfig `paths` 绕开，只保留我们用到的公开 API 类型。**等上游改成发 `.d.ts` 后删掉这个文件**。
