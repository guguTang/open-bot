# Open Bot Mobile（Capacitor 7）

iOS / Android 壳，**前端直接复用** `apps/web` 的构建产物（`webDir: ../web/dist`），不复制 UI 源码。

## 依赖

- macOS + Xcode（优先 iOS；`pod` / CocoaPods，终端需 `LANG=en_US.UTF-8`）
- Node / pnpm（workspace 含 `@capacitor/*@7`）
- Android Studio / SDK（可选；本仓库已生成 `android/`，无 SDK 时仍可 `cap sync`）
- 本地已启动：Postgres、`make dev-api`、`make dev-runtime`（聊天才可用）

## 同步与打开

```bash
# 仓库根
make build-web          # pnpm --dir apps/web build → apps/web/dist
make sync-mobile        # build-web + npx cap sync（写入 ios/ android/）

make dev-mobile-ios     # sync 后 npx cap open ios（打开 Xcode）
# 或 Android：
make open-mobile-android
```

也可手动：

```bash
pnpm --dir apps/web build
cd apps/mobile && npx cap sync
npx cap open ios          # 或 open android / run ios
```

## 开发（Live Reload，仅模拟器）

1. 终端：`make dev-web`（Vite `http://127.0.0.1:5173`）+ `make dev-api` + `make dev-runtime`
2. 同步时打开 live reload：

```bash
CAP_LIVE_RELOAD=1 make sync-mobile
# 等价：CAP_LIVE_RELOAD=1 CAP_SERVER_URL=http://127.0.0.1:5173
make dev-mobile-ios
```

- **模拟器**：`127.0.0.1` 指向宿主机，可用。
- **真机**：`127.0.0.1` 是手机自己；Vite 与 API 都要改成电脑的**局域网 IP**，例如：
  - `CAP_LIVE_RELOAD=1 CAP_SERVER_URL=http://192.168.1.10:5173 make sync-mobile`
  - 构建 web 前设 `VITE_API_BASE=http://192.168.1.10:18080`（或写在仓库根 `.env`）
  - 真机与电脑须同一 Wi‑Fi；API / Vite 需监听可达地址（必要时改 `vite` `server.host`）

生产/打包壳（无 `CAP_LIVE_RELOAD`）加载的是打包进原生工程的 `dist` 静态资源。

## API

与 Web / 桌面相同，默认 **`http://127.0.0.1:18080`**（见 `apps/web/src/api.ts` 的 `VITE_API_BASE`）。

| 场景 | `VITE_API_BASE` |
|------|-----------------|
| iOS 模拟器 / Android 模拟器 | `http://127.0.0.1:18080`（Android 模拟器有时需 `http://10.0.2.2:18080`） |
| 真机 | `http://<电脑局域网IP>:18080` |

改完后需重新 `make build-web && make sync-mobile`（live reload 开发时重启 `make dev-web` 并带上 env）。

iOS 已开 `NSAllowsLocalNetworking`；Android 开发包开了 `usesCleartextTraffic`（HTTP）。

## 结构

| 路径 | 作用 |
|------|------|
| `capacitor.config.ts` | appId `com.openbot.mobile`，appName `Open Bot`，webDir `../web/dist` |
| `ios/` | Xcode 工程（CocoaPods） |
| `android/` | Android Studio 工程 |
| `CAP_LIVE_RELOAD=1` | 写入 `server.url`（默认 `http://127.0.0.1:5173`） |


## 微应用 Device 插件（Camera / Geo / Mic / Notify / Share）

`apps/mobile/package.json` 已声明：

| 能力 | npm |
|------|-----|
| `device.camera` | `@capacitor/camera` |
| `device.geo` | `@capacitor/geolocation` |
| `device.mic` | `@mozartec/capacitor-microphone`（注册名 `Microphone`） |
| `device.notify` | `@capacitor/local-notifications` |
| `device.share` | `@capacitor/share` |

Web 侧 `deviceBridge.ts` **运行时探测** `Capacitor.Plugins.*`：壳 `pnpm install` + `npx cap sync` 后矩阵亮起；未授权 OS 权限时仍灰显/引导系统框（`requestPermissions`）。

iOS：`Info.plist` 含 Camera / Microphone / Location When-In-Use / Photo Library 文案。  
Android：`AndroidManifest.xml` 含 CAMERA / RECORD_AUDIO / ACCESS_*_LOCATION。

```bash
pnpm --dir apps/mobile install
make sync-mobile   # 或 cd apps/mobile && npx cap sync
```

## 本轮不做

应用商店上架、推送证书、原生插件大集合、自动更新。

## 验收

- `pnpm --dir apps/web build` + `npx cap sync` 成功
- `npx cap open ios` 能打开 Xcode（不要求本机一定跑通模拟器）
