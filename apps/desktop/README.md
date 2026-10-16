# Open Bot Desktop（Tauri 2）

macOS arm64 桌面壳，**前端直接复用** `apps/web`（不复制 UI）。

## 依赖

- Rust（rustup）+ Xcode CLT
- Node / pnpm（workspace 已含 `@tauri-apps/cli`）
- 本地已启动：Postgres、`make dev-api`、`make dev-runtime`

## 开发

```bash
# 终端 1–2（仓库根）
make compose-postgres
make dev-runtime
make dev-api

# 终端 3
make dev-desktop
# 或：pnpm --dir apps/desktop tauri dev
```

- 窗口标题：Open Bot；默认约 1200×800；深色背景 `#0f0f12`
- 开发时 Tauri 加载 `http://127.0.0.1:5173`（由 `beforeDevCommand` 启动 web vite）
- API：默认 `http://127.0.0.1:18080`（web 的 `VITE_API_BASE`）；可在仓库根 `.env` 覆盖

## 构建

```bash
make check-desktop          # cargo check
pnpm --dir apps/desktop test
# debug .app + DMG：
pnpm --dir apps/desktop tauri build --debug
# release：
make build-desktop
```

在 macOS 上，`tauri build` / `make build-desktop` 会先让 Tauri 打出签名过的 `Open Bot.app`，再写安装 DMG。Windows / Linux 的 `app` 与 `dmg` 目标会被 Tauri 忽略，原有的 `--target` 交叉编译参数保持不变。

| 构建 | 应用包 | DMG |
|------|--------|-----|
| release | `src-tauri/target/release/bundle/macos/Open Bot.app` | `src-tauri/target/release/bundle/dmg/Open Bot_0.1.0_<arch>.dmg` |
| `--debug` | `src-tauri/target/debug/bundle/macos/Open Bot.app` | `src-tauri/target/debug/bundle/dmg/Open Bot_0.1.0_<arch>.dmg` |

`<arch>` 为 `aarch64` 或 `x64`。带 `--target <triple>` 时，目录在 `target/<triple>/…` 下。

### 安装与权限

1. 打开 DMG。窗口里是 **Open Bot** 和 **Applications** 快捷方式，把应用拖进去。
2. 从「应用程序」或 DMG 里打开 **Open Bot.app**。
3. 到「系统设置 → 隐私与安全性」，把 **Open Bot** 加进「屏幕录制」和「辅助功能」。较新的 macOS 若还列出「输入监控」（Input Monitoring）或「事件发布」（Event Posting），同样允许 Open Bot。桌面端「设置 → 电脑」可以打开前两个页面。

请打开 `.app` 或 DMG。不要双击 `Open Bot.app/Contents/MacOS/open-bot-desktop`：那是裸 Mach-O，会先拉起终端，签名也只是链接器打的 ad-hoc（标识类似 `open_bot_desktop-…`，`Info.plist` 未绑定，没有密封资源），系统设置无法把权限稳定授给「这个应用」。

### 签名

默认 `bundle.macOS.signingIdentity` 为 `"-"`：没有 Apple 证书时，Tauri 仍按正常路径对整个 `.app` 做 ad-hoc 签名（先签内部二进制，再签包），并带上 Hardened Runtime 和 `Entitlements.plist`。签完后可以用：

```bash
codesign -dv --verbose=4 "src-tauri/target/release/bundle/macos/Open Bot.app"
```

期望看到：

- `Identifier=com.openbot.desktop`
- `Signature=adhoc`，flags 为 adhoc（例如 `flags=0x2(adhoc)`）
- `Info.plist entries=`（plist 已绑进签名）
- `Sealed Resources version=2`

`APPLE_SIGNING_IDENTITY` 会覆盖配置里的 `"-"`。ad-hoc 的 cdhash 每次重编都会变，授权要重新做一次。DMG 本身在 ad-hoc 时不签名（与 Tauri 相同）；若设置了真实的 Developer ID，构建完会用该身份签 DMG。

DMG 布局不走 Tauri 自带的 `bundle_dmg.sh`。那条脚本用 `/usr/bin/osascript` 驱动 Finder，终端没有「自动化」权限时会失败并留下 `rw.*.dmg`。这里在 `.app` 签完后用 `hdiutil` 写盘，并用 `.DS_Store` 摆好图标和 Applications 快捷方式，不需要 Finder。

### 公证（可选，本仓库不要求密钥）

本地安装不需要公证。要给别人下载、并通过 Gatekeeper，再准备：

| 变量 | 作用 |
|------|------|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: 名字 (TEAMID)`，覆盖 ad-hoc |
| `APPLE_CERTIFICATE` | CI 上的 p12，base64 |
| `APPLE_CERTIFICATE_PASSWORD` | p12 密码 |
| `APPLE_ID` | 公证用的 Apple ID |
| `APPLE_PASSWORD` | app 专用密码 |
| `APPLE_TEAM_ID` | Team ID。只设了 Apple ID 和密码、没设 Team ID 时，Tauri 会直接失败 |

这三项公证变量要一起给。没有它们时，构建会跳过公证，ad-hoc DMG 仍可在本机安装。自动更新不在这次范围内。

## 结构说明

| 路径 | 作用 |
|------|------|
| `src-tauri/` | Rust + Tauri 2 壳 |
| `tauri.conf.json` → `frontendDist` | `../../web/dist` |
| `devUrl` | `http://127.0.0.1:5173` |

## 在 macOS 上核对

```bash
make build-desktop
open "apps/desktop/src-tauri/target/release/bundle/dmg/Open Bot_0.1.0_aarch64.dmg"
```

Intel 机器把文件名里的 `aarch64` 换成 `x64`。打开 DMG 应看到 Open Bot 和 Applications。拖进「应用程序」后启动应用，再跑上面的 `codesign`。然后打开「系统设置 → 隐私与安全性」：用应用里的截屏或点「+」把 **Open Bot** 加到屏幕录制；辅助功能（以及列出的输入监控 / 事件发布）同样选择这个应用。列表里的名字是 Open Bot，标识是 `com.openbot.desktop`。
