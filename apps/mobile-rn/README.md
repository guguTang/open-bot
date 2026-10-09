# @open-bot/mobile-rn

Open Bot 的 React Native 移动端。**独立于** `apps/mobile`（那是复用 `apps/web/dist` 的 Capacitor 壳，两条路线并存）。

技术栈：**Expo SDK 57 · React Native 0.86 · Expo Router · HeroUI Native（Uniwind）**

## 为什么是这套

| 决策                                    | 原因                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo/fetch` 而非全局 `fetch`           | RN 内置 fetch 是 XHR polyfill，拿不到 `res.body`，SSE 会退化成一次性返回。`expo/fetch` 提供真正的 ReadableStream，Web 端 `readSSEStream` 的逻辑可以原样移植。                                                                                     |
| `expo-secure-store` 而非 `localStorage` | JWT 存 Keychain / Keystore，不进明文存储。                                                                                                                                                                                                        |
| 保持 pnpm 隔离安装                      | Expo SDK 55+ 在 monorepo 里自动启用 `autolinkingModuleResolution`，Metro 默认跟随 symlink，**不需要**把仓库降级成 `nodeLinker: hoisted`。                                                                                                         |
| `heroui-native` 而非 `@heroui/react`    | 两者包名、样式引擎（Uniwind vs Tailwind）、颜色格式（HSL vs oklch）都不同，Web 端的写法不能直接搬。                                                                                                                                               |
| **自研 Markdown 渲染器**                | 不引 `react-native-markdown-display`（多年未维护，React 19 / RN 0.86 上有风险），也不用 Expo DOM 复用 `react-markdown`（包体大、与流式重解析配合脆）。自研能精确控制**增量解析**：流式每来一个 token 只重解析仍在生长的尾巴，实测提速约 13.7 倍。 |
| 不引 `react-native-webview`             | 文件预览和沙箱桌面都需要它，但会显著拖慢首屏。改为纯文本预览 + `Linking.openURL` 交给系统浏览器。                                                                                                                                                 |

## 前置条件

- Node ≥ 20.19.4、pnpm ≥ 10
- 后端已启动：`make dev-runtime` + `make dev-api`（默认 `http://127.0.0.1:18080`）
- **iOS 模拟器需要完整 Xcode**（本机当前只有 CommandLineTools，`xcrun simctl` 不可用）。装不了 Xcode 时用真机 + Expo Go。

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

- **聊天**：Markdown 渲染、运行状态动画（thinking / tool）、附件上传、产物文件卡片、结果导向的 JSON 折叠、首次引导卡、停止 / 打断、重连续跑、群聊 @点名与发言者归属
- **导航**：助手列表、群聊频道、助手新建 / 编辑 / 删除、账号菜单、设置入口、协作收件箱入口
- **协作**：agent-bus 收件箱（WS 实时推送 + 断线 3s 轮询回退）、消息投递与 priority 唤醒、频道成员管理
- **设置**：模型、Skills、MCP、例行任务、压缩（只读）、运行环境、电脑、密钥——与 Web 端分区一一对应

## 已知缺口 / 有意降级

以下是**主动的能力裁剪**，不是遗漏：

- **HTML 不在应用内渲染**：Web 端用 `<iframe srcdoc>` 预览文件，RN 没有 WebView（`react-native-webview` 会显著拖慢首屏）。文件预览统一降级为「等宽纯文本 + 复制」，HTML / SVG 只能看源码。
- **沙箱桌面走系统浏览器**：同上没有 WebView 承载 noVNC，改用 `Linking.openURL(sandboxDesktopURL())`，并已在 UI 上注明。
- **沙箱内部信息对用户隐藏**：`container_id` / `image` / `workdir_host` / 宿主路径都不下发到界面（产品硬要求：运行环境对用户透明）。
- **OIDC 登录未做**：Web 端的 Casdoor OIDC 流程需要 `expo-web-browser` + `expo-auth-session`，本轮没引。当前只有用户名密码。
- **会话列表无独立页面**：主导航是「助手 / 群聊」，每个助手固定一条主线程；独立的会话列表只作为组件提供，没有单独路由。
- **MCP server 无编辑表单**：与 Web 端一致（Web 的 `updateMCPServer` 也只用于 toggle `enabled`）。
- **协作页的助手 / 频道选择器是文本输入**：输入名称做精确匹配回填 id，没有正经下拉。名称重复时不好选。
- **`ConversationList.tsx` 尚未挂载**：主导航是「助手 / 群聊」，每个助手一条主线程，独立会话列表作为组件备好但没接路由。

技术债：

- `app.json` 里 `NSAppTransportSecurity.NSAllowsArbitraryLoads: true` 是为本地开发放开的，**上架前必须移除**。
- Metro `watchFolders` 指向仓库根，会监听整个仓库；装 `watchman`（`brew install watchman`）能明显减轻负担。
- `Markdown.tsx` 的增量解析缓存读写发生在渲染期（已加 `eslint-disable` 与理由注释）。它在 StrictMode 双渲染下结果收敛，但如果将来引入并发特性（`useTransition` / Offscreen），需要重新评估。
