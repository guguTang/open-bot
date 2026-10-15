---
name: findmy
description: Locate Apple devices / AirTags through FindMy.app on a connected Mac (host_open + host_screenshot). Use for 查找设备 / AirTag 在哪.
---

# Find My (Apple)

> 改编自 [Hermes Agent](https://github.com/NousResearch/hermes-agent) `skills/apple/findmy`（MIT，Nous Research）。工具名已换成 open-bot 自己的。

## open-bot 运行方式

- **在哪执行**：用户已连接的电脑。先 `list_machines` 选机，再 `load_skill host-shell`；命令用 `host_shell`（一次一条，stdout 会截断），读写文件用 `host_read` / `host_write`，搜文件内容用 `host_shell` 跑 `rg` / `grep`，查「最大/某类文件」用 `host-file-query`。
- **长进程**：没有后台进程工具。用 `nohup <cmd> > /tmp/<name>.log 2>&1 &` 启动，再用 `host_shell` 跑 `tail -n 50 /tmp/<name>.log` 轮询；整体耗时很长的任务用 `defer_work` 放后台交付。
- **确认**：写入/删除/有风险的命令由系统确认卡处理；结果 waiting = 尚未执行，denied = 用户拒绝，如实说明，不要编造输出。


Track Apple devices and AirTags via the FindMy.app on macOS. Since Apple doesn't
provide a CLI for FindMy, this skill uses AppleScript to open the app and
screen capture to read device locations.

## Prerequisites

- **macOS** with Find My app and iCloud signed in
- Devices/AirTags already registered in Find My
- Screen Recording permission for **Open Bot** (系统设置 → 隐私与安全性 → 屏幕录制). If `host_screenshot` returns `screen_recording_denied`, ask the user to grant it and stop retrying.
- **Optional but recommended**: Install `peekaboo` for better UI automation:
  `brew install steipete/tap/peekaboo`

## When to Use

- User asks "where is my [device/cat/keys/bag]?"
- Tracking AirTag locations
- Checking device locations (iPhone, iPad, Mac, AirPods)
- Monitoring pet or item movement over time (AirTag patrol routes)

## Method 1: AppleScript + Screenshot (Basic)

### Open FindMy and Navigate

```bash
# Open Find My app
osascript -e 'tell application "FindMy" to activate'

# Wait for it to load
sleep 3

# Then call host_screenshot (the image is attached to the tool result; read it directly).
# Do not use screencapture — that only writes a file the model cannot see.
```

然后调用 `host_screenshot`，根据附上的画面读出设备名和位置。不要说自己看不到图。

### Switch Between Tabs

```bash
# Switch to Devices tab
osascript -e '
tell application "System Events"
    tell process "FindMy"
        click button "Devices" of toolbar 1 of window 1
    end tell
end tell'

# Switch to Items tab (AirTags)
osascript -e '
tell application "System Events"
    tell process "FindMy"
        click button "Items" of toolbar 1 of window 1
    end tell
end tell'
```

## Method 2: Peekaboo UI Automation (Recommended)

If `peekaboo` is installed, use it for more reliable UI interaction:

```bash
# Open Find My
osascript -e 'tell application "FindMy" to activate'
sleep 3

# Capture and annotate the UI
peekaboo see --app "FindMy" --annotate --path /tmp/open-bot-scratch/findmy-ui.png

# Click on a specific device/item by element ID
peekaboo click --on B3 --app "FindMy"

# Capture the detail view
peekaboo image --app "FindMy" --path /tmp/open-bot-scratch/findmy-detail.png
```

然后调用 `host_screenshot` 阅读详情页上的地址和坐标。`peekaboo image` 只是存文件，不能代替 `host_screenshot`。

## Workflow: Track AirTag Location Over Time

For monitoring an AirTag (e.g., tracking a cat's patrol route):

```bash
# 1. Open FindMy to Items tab
osascript -e 'tell application "FindMy" to activate'
sleep 3

# 2. Click on the AirTag item (stay on page — AirTag only updates when page is open)

# 3. Periodically call host_screenshot and note the location from the attached image.
# Do not loop screencapture into /tmp.
```

每次 `host_screenshot` 后从画面里记下坐标，再汇总路线。

## Limitations

- FindMy has **no CLI or API** — must use UI automation
- AirTags only update location while the FindMy page is actively displayed
- Location accuracy depends on nearby Apple devices in the FindMy network
- Screen Recording permission required for screenshots
- AppleScript UI automation may break across macOS versions

## Rules

1. Keep FindMy app in the foreground when tracking AirTags (updates stop when minimized)
2. Use `host_screenshot` to read the screen — the image is attached to the tool result. Do not pretend a `/tmp` PNG was visible.
3. For ongoing tracking, propose an open-bot routine (`create_routine`) that periodically captures and logs locations — only with the user's explicit consent, and only while the Mac is connected
4. Respect privacy — only track devices/items the user owns
