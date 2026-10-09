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
| **`react-native-mmkv` 存偏好**  | 列表折叠、引导标记、上次打开这类数据不是机密，而且要频繁读写 —— 为它付 Keychain 往返的代价不划算。MMKV 还是**同步**的，页面首帧就能拿到正确值，不用来回闪一帧。                       |

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
- **完整功能需要 dev build**（MMKV 与 OIDC 都依赖 Expo Go 没有的能力）—— 详见下方「部署注意」。

## 启动

```bash
cp .env.example .env      # 真机必须改成电脑局域网 IP
pnpm start                # 模拟器直接用默认地址
pnpm start --clear        # 改过 .env 后必须 -c 重启才会重新注入
```

`EXPO_PUBLIC_OPENBOT_API_BASE` 的取值：

| 环境             | 值                                                            |
| ---------------- | ------------------------------------------------------------- |
| iOS 模拟器 / web | `http://127.0.0.1:18080`（默认）                              |
| Android 模拟器   | `http://10.0.2.2:18080`（默认已处理）                         |
| 真机             | `http://<电脑局域网IP>:18080`，用 `ipconfig getifaddr en0` 查 |

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
│   └── settings/     全量设置页
│       ├── index.tsx  分区入口
│       ├── llm.tsx / skills.tsx / mcp.tsx / routines.tsx
│       ├── compact.tsx / sandbox.tsx / machines.tsx / secrets.tsx
├── components/     共享组件（Markdown / Composer / 气泡 / 弹窗 / 脚手架 / ConversationList）
├── lib/            纯函数（路径归一化、产物拆分、格式化、附件校验、@提及解析）
└── providers/
    ├── session.tsx       登录态 Context
    └── secretPrompt.tsx  全局密钥授权弹窗（8s 轮询）
```

## 功能对齐状态

已从 `apps/mobile`（即 `apps/web` 的功能面）迁移过来：

- **聊天**：Markdown 渲染、运行状态动画（thinking / tool）、附件上传、产物文件卡、结果导向的 JSON 折叠、首次引导卡、停止 / 打断、重连续跑、群聊 @点名与发言者归属
- **聊天互动**：表情回应（9 个白名单，负表情联动追问原因）、消息长按操作面板（表情 / 回复 / 复制正文 / 复制请求 ID / 反馈）、引用回复、线程回复（「N 条回复」可展开）、消息反馈、Bot 交接卡、本机操作确认卡
- **训练**：`/train` 三 Tab 面板（待确认 / 已生效 / 已忽略），可确认、编辑、停用、恢复、删除
- **产物**：卡片可直接下载并分享（带鉴权落盘 + 系统分享），HTML / SVG 走 WebView 预览，Mermaid 用 `expo-mermaid` 原生渲染
- **导航**：助手列表、群聊频道、助手新建 / 编辑 / 删除、账号菜单、设置入口、协作收件箱入口；列表支持搜索、分区折叠、「继续上次」
- **形象**：助手剪影（6 种有机形状）与主色（12 色正式色板）可自选，桌面与手机显示一致；支持绑定「优先电脑」
- **协作**：agent-bus 收件箱（WS 实时推送 + 断线 3s 轮询回退）、消息投递与 priority 唤醒、频道成员管理
- **设置**：Bot 设置、审核与时区、优先电脑、模型、扩展能力包、插件 / MCP、例行任务、数据与压缩、运行环境、密钥——与 Web 端分区一一对应
- **登录**：用户名密码 + Casdoor OIDC（后端启用时才显示入口）

## 已知缺口 / 有意降级

以下是**主动的能力裁剪**，不是遗漏：

- **Mermaid 覆盖 25 种图表，语法变体有限**：`expo-mermaid` 不支持 `flowchart-elk`、`init` 指令、部分 handDrawn 变体。遇到解析不了的类型，卡片会自动退回源码视图而不是渲染一个空框（判断逻辑见 `mermaidTypeOf()`），并始终保留「复制源码」这条永远可用的路。
- **沙箱内部信息对用户隐藏**：`container_id` / `image` / `workdir_host` / 宿主路径都不下发到界面（产品硬要求：运行环境对用户透明）。
- **会话列表无独立页面**：主导航是「助手 / 群聊」，每个助手固定一条主线程；`ConversationList.tsx` 仍作为备选组件存在，Web 端同样没有独立会话列表。
- **MCP server 无编辑表单**：与 Web 端一致（Web 的 `updateMCPServer` 也只用于 toggle `enabled`）。
- **协作页的助手 / 频道选择器是文本输入**：输入名称做精确匹配回填 id，没有正经下拉。名称重复时不好选。
- **HTML 消毒是保守实现**：RN 没有 DOM，Web 端那套 `DOMParser` 遍历用不了，改为正则剥离 `script` / `iframe` / `on*` 事件 / `javascript:`，并加文档内 CSP 兜底。宁可多删，不留可执行内容 —— 副作用是**依赖 JS 的 HTML 产物（小游戏等）预览出来是静态的**。
- **技能包不支持文件夹选择**：RN 没有 `webkitdirectory` 的等价物，zip 上传可用。
- **`ConversationList.tsx` 尚未挂载**：主导航是「助手 / 群聊」，每个助手一条主线程。

## 部署注意

### ⚠️ 需要 dev build，不能用 Expo Go

项目里有两处依赖**自定义原生模块 / scheme 回调**，Expo Go 都满足不了：

| 依赖                   | 为什么 Expo Go 不行                                   | 缺了会怎样                                                  |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| `react-native-mmkv` v4 | 走 `react-native-nitro-modules`，是自定义原生模块     | 偏好数据降级为内存存储（**重启即丢**），应用能正常启动      |
| OIDC / Casdoor 登录    | 自定义 scheme 回调需要注册 URL scheme，Expo Go 不支持 | 「用 Casdoor 登录」按钮点了没反应（用户名密码登录不受影响） |

所以要拿到完整功能，必须用 dev build：

```bash
npx expo prebuild        # 生成 ios/ 与 android/ 原生工程
npx expo run:ios         # 或 run:android
# 或者用 EAS Build 打到真机
```

`lib/storage.ts` 做了兜底：MMKV 不可用时自动降级为内存存储并打一条 warning，
**同步 API 契约不变、代码一行不用改**。之所以不降级到 AsyncStorage，是因为
那一层对外是同步契约（zustand persist 的 storage 异步会让 hydrate 变异步，
页面就会先闪一帧默认值 —— 正是换 MMKV 要消掉的问题）。宁可少一个持久化能力，
也不把同步 API 换回异步。

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
