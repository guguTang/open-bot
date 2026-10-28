# 发布

GitHub Release **发布**（`published`）时，[`.github/workflows/release.yml`](../.github/workflows/release.yml) 会构建后端镜像和客户端安装包。只推送 `v*` tag、或保存为草稿，都不会跑这条流水线。PR 与分支 CI 仍是 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)（web lint / build），互不影响。

镜像推到 GHCR，登录用 Actions 自带的 `GITHUB_TOKEN`（`packages: write`），不需要单独的 registry token。客户端安装包挂到**同一个 Release** 上；Actions 页面也会留一份 artifact（约 90 天）。

## 切一个 Release

在要发布的提交上打三个数字的 semver tag（可带预发布后缀），然后**发布** Release。tag 建议带 `v`。

```bash
git tag v0.2.0
git push origin v0.2.0
gh release create v0.2.0 --target develop --generate-notes --title "v0.2.0"
```

预发布不移动镜像的 `:latest`：

```bash
gh release create v0.2.0-rc.1 --target develop --prerelease --generate-notes --title "v0.2.0-rc.1"
```

也可以在 GitHub 网页上选 tag、写说明，再点 Publish release。发布后等 workflow 跑完，安装包会出现在该 Release 的 Assets 里。刚点发布时还没有这些文件，这是预期的。

手动试跑（不创建 Release、不移动 `:latest`）：Actions → Release → Run workflow，输入 `1.2.3`（不要带 `v`）。镜像会打上这个版本号；安装包只在 Actions artifacts 里。

## 镜像

均为 **linux/amd64**。仓库 owner 会转成小写。

| 镜像 | Dockerfile | 说明 |
|------|------------|------|
| `ghcr.io/<owner>/openbot-api` | `services/api/Dockerfile` | API。同一镜像里有 `openbot-worker`，例行任务进程用这个命令 |
| `ghcr.io/<owner>/openbot-agent-runtime` | `services/agent-runtime/Dockerfile` | Python runtime |
| `ghcr.io/<owner>/openbot-markitdown` | `services/markitdown/Dockerfile` | 文档解析，compose core 也用这份 Dockerfile |
| `ghcr.io/<owner>/openbot-sandbox` | `deploy/sandbox/Dockerfile` | 运行环境 CLI 镜像 |
| `ghcr.io/<owner>/openbot-sandbox-desktop` | `deploy/sandbox-desktop/Dockerfile` | 带 noVNC 的桌面镜像，基于上面的 CLI 镜像 |

正式版 tag：`<version>`（去掉 `v`）、`v<version>`、`latest`。预发布和手动试跑没有 `latest`。

公开仓库里，GHCR 包有时默认是 private。拉不下来时，到 Packages 里把对应包设为 public，并确认它关联到本仓库。

本地构建（只打 tag，不推送）：

```bash
make image-api
make image-runtime
make image-markitdown
make sandbox-image
make sandbox-image-desktop
```

用发布出来的 API / runtime / worker 配合现有的 Postgres、MinIO、MarkItDown：

```bash
OPENBOT_IMAGE_PREFIX=ghcr.io/<owner> OPENBOT_IMAGE_TAG=0.2.0 \
  docker compose -f deploy/compose.yaml --project-directory deploy --profile app up -d
```

`app` profile 默认关掉运行环境（`SANDBOX_ENABLED=0`）。API 镜像里带了 docker CLI，但进程用户是 `openbot`，不能直接用宿主机的 docker socket。要开运行环境，把 api 服务改成 root、挂上 `/var/run/docker.sock`，并设 `SANDBOX_ENABLED=1`。说明写在 `deploy/compose/app.yaml` 顶部。镜像是 amd64；Apple Silicon 上要跑 arm64 容器时，仍在本机构 `make sandbox-image`。

## 客户端包

桌面是 Tauri 2，复用 `apps/web`。没有签名密钥时也能装，用来测试：

| 产物 | 任务 | 说明 |
|------|------|------|
| `open-bot-<version>-linux-amd64.deb` | `desktop-linux` | `make build-desktop-linux` |
| `open-bot-<version>-linux-amd64.AppImage` | `desktop-linux` | 同上 |
| `open-bot-<version>-windows-x64-setup.exe` | `desktop-windows` | `make build-desktop-windows`（NSIS）。未签名时 SmartScreen 会提示 |
| `open-bot-<version>-macos-<arch>.dmg` | `desktop-macos` | `make build-desktop`。GitHub 托管的 macOS 是 Apple Silicon，所以是 `aarch64`。无证书时 Tauri 做 ad-hoc 签名（`signingIdentity: "-"`），可在本机安装，过不了 Gatekeeper 的「任意来源」以外的分发 |
| `open-bot-<version>-android-debug.apk` | `android` | 没有 keystore 时。debug 签名，可以装到测试机 |
| `open-bot-<version>-android-release.apk` 与 `.aab` | `android` | 配了 keystore 才打。这时不再上传 debug APK |

`make build-desktop-macos` 仍是 Intel 交叉编译，发布流程不用它。需要 x64 DMG 时在 Intel Mac 上本地打。

Web 壳在打包时写死 API 地址。仓库 **Variables**（不是 Secrets）里的 `VITE_API_BASE` 会传给桌面和 Android。不设的话，应用默认 `http://127.0.0.1:18080`，适合桌面连本机 API。真机 Android 要连电脑时，发布前设成局域网或公网地址。

Android 的 `versionName` 跟着 release 版本走。`versionCode` 仍是工程里的 `1`，不能直接拿去 Play 递增上架。Gradle wrapper 在仓库里指向腾讯云镜像（方便国内本机）；CI 会改成 `services.gradle.org` 再下载，不改仓库文件。

## 签名密钥（都可选）

名字要和 workflow 里一致。不配也能发布，只是对应平台保持未签名 / debug。

### macOS（Developer ID + 公证）

和 `apps/desktop/README.md` 相同。证书要先导入登录钥匙串，workflow 在 `APPLE_CERTIFICATE` 非空时做这件事。

| Secret | 作用 |
|--------|------|
| `APPLE_CERTIFICATE` | Developer ID 的 `.p12`，base64 |
| `APPLE_CERTIFICATE_PASSWORD` | p12 密码 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: 名字 (TEAMID)`，覆盖 ad-hoc |
| `APPLE_ID` | 公证 Apple ID |
| `APPLE_PASSWORD` | app 专用密码 |
| `APPLE_TEAM_ID` | Team ID |

公证这三项要一起给。只给其中一项时，Tauri 会失败。没有它们时跳过公证，ad-hoc DMG 仍会上传。

### Windows

| Secret | 作用 |
|--------|------|
| `WINDOWS_CERTIFICATE` | Authenticode `.pfx`，base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | pfx 密码 |

只签 NSIS 安装包，不逐个签包里的二进制。未配置时安装包不签名。

### Android

| Secret | 作用 |
|--------|------|
| `ANDROID_KEYSTORE_BASE64` | PKCS12 keystore，base64 |
| `ANDROID_KEYSTORE_PASSWORD` | store 密码 |
| `ANDROID_KEY_ALIAS` | key 别名 |
| `ANDROID_KEY_PASSWORD` | key 密码 |

四项都要有。`apps/mobile/android/app/build.gradle` 在 `ANDROID_KEYSTORE_PATH` 指向解码后的文件时给 release 签名。

## 这次不打的包

- **iOS IPA**：没有签名 job。`make build-ios` 仍是本机 `CODE_SIGNING_ALLOWED=NO` 的 debug 编译，产物不能装到设备上。以后若要接，需要分发证书和 provisioning profile（例如 `IOS_CERTIFICATE`、`IOS_CERTIFICATE_PASSWORD`、`IOS_PROVISIONING_PROFILE`）。现在配了也不会被读取。
- **`apps/mobile-rn`（Expo）**：商店包要走 EAS 和另一套凭据，不在这条流水线里。
- **linux/arm64 与 macOS x64 安装包**、**arm64 镜像**：CI 不打。沙箱镜像要在实际运行的机器架构上构建，见 `deploy/sandbox/README.md`。
