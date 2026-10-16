"""Client environment envelope shared with Go/TS (platform / app / capabilities)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ClientCapabilities(BaseModel):
    host_tools: bool = False
    workspace_tools: bool = True


class ClientContext(BaseModel):
    platform: str = Field(default="web")  # web|macos|windows|linux|ios|android
    app: str = Field(default="browser")  # browser|tauri|capacitor
    os: str = Field(default="")
    arch: str = Field(default="")
    app_version: str = Field(default="")
    locale: str = Field(default="")
    timezone: str = Field(default="")  # IANA; from user settings
    machine_id: str = Field(default="")
    machine_label: str = Field(default="")  # display name of current device
    capabilities: ClientCapabilities = Field(default_factory=ClientCapabilities)

    @classmethod
    def from_any(cls, raw: Any) -> ClientContext | None:
        if raw is None:
            return None
        if isinstance(raw, ClientContext):
            return raw
        if not isinstance(raw, dict):
            return None
        try:
            caps_raw = raw.get("capabilities") or {}
            if not isinstance(caps_raw, dict):
                caps_raw = {}
            caps = ClientCapabilities(
                host_tools=bool(caps_raw.get("host_tools", False)),
                workspace_tools=bool(caps_raw.get("workspace_tools", True)),
            )
            return ClientContext(
                platform=str(raw.get("platform") or "web").strip() or "web",
                app=str(raw.get("app") or "browser").strip() or "browser",
                os=str(raw.get("os") or "").strip(),
                arch=str(raw.get("arch") or "").strip(),
                app_version=str(raw.get("app_version") or "").strip(),
                locale=str(raw.get("locale") or "").strip(),
                timezone=str(raw.get("timezone") or "").strip(),
                machine_id=str(raw.get("machine_id") or "").strip(),
                machine_label=str(
                    raw.get("machine_label") or raw.get("display_name") or ""
                ).strip(),
                capabilities=caps,
            )
        except Exception:  # noqa: BLE001
            return None


_PLATFORM_LABEL = {
    "web": "网页浏览器",
    "macos": "macOS 桌面应用",
    "windows": "Windows 桌面应用",
    "linux": "Linux 桌面应用",
    "ios": "iOS 应用",
    "android": "Android 应用",
}


def format_environment_block(
    client: ClientContext | None,
    machines: list[dict[str, Any]] | None = None,
) -> str:
    """Build the 「环境」 system-prompt section (user-facing wording; no sandbox/Docker)."""
    lines = ["## 环境"]
    connected_labels = _connected_labels(machines)
    if client is None:
        lines.append(
            "当前客户端信息未知。不要假设用户在某台具体电脑上；"
            "若用户提到「我的电脑 / Downloads / 桌面」，先调用 list_machines 查看已注册主机。"
        )
    else:
        is_browser = client.app == "browser" or client.platform == "web"
        display = "" if is_browser else _current_device_display_name(client, machines)
        plat = _PLATFORM_LABEL.get(client.platform, client.platform)
        if is_browser:
            lines.append(
                "用户当前正在网页浏览器里聊天（不是桌面应用）。"
                "浏览器进程本身不能直接读写本机文件；"
                "但若 list_machines 显示另有已连接（connected）的电脑应用，"
                "必须通过那台电脑代操作 Downloads / 桌面（先 load_skill 对应技能；不要拒绝、不要改用 sandbox）。"
                "没有任何已连接电脑时，才说明需要先打开桌面应用。"
            )
        elif display:
            lines.append(f"用户当前正在这台设备上聊天：{display}。")
        bits = [f"当前客户端：{plat}（app={client.app}"]
        if client.os:
            bits.append(f"os={client.os}")
        if client.arch:
            bits.append(f"arch={client.arch}")
        if client.app_version:
            bits.append(f"version={client.app_version}")
        if client.locale:
            bits.append(f"locale={client.locale}")
        if client.timezone:
            bits.append(f"timezone={client.timezone}")
        if display:
            bits.append(f"device={display}")
        if client.machine_id and not is_browser:
            bits.append(f"machine_id={client.machine_id}")
        lines.append("，".join(bits) + "）。")
        if client.timezone:
            lines.append(f"用户偏好时区：{client.timezone}（报告时间请用此时区）。")
        lines.append(
            "本机文件只在已连接的电脑上读写；可用绝对路径或 ~/...。"
            "用户点名某台电脑时，用 list_machines 里对应且 connected 的 machine_id（以 label 识别）。"
            "没点名时：有当前会话 machine_id（发消息的那台）就用它；它没连接就说明要打开那台，不要改到别的电脑。"
            "浏览器没有 machine_id 时：用可选的优先电脑，否则仅一台已连接时用那一台；多台且无优先则先问用户。"
            "对不上或有多台都像时先问用户。"
            # Must-load details live in ## 工具路由; keep a short pointer (tests expect load_skill + host-ssh here).
            "本机/远程操作前先 load_skill（host-shell / host-file-query / host-ssh / computer-use）。"
            "禁止编造文件名和大小；不要用内部运行环境冒充本机文件。"
        )
        lines.extend(_usual_machine_lines(machines))
        if not connected_labels:
            lines.append(
                "【硬性】此刻没有任何已连接的电脑应用。"
                "用户问 Downloads / 桌面 / 本机文件 / 本机命令时："
                "必须先 list_machines（或直接说明没有已打开的电脑应用）；"
                "禁止编造文件名、大小、修改时间；禁止用 sandbox_* 或记忆里的旧结果冒充本机。"
                "正确说法示例：「要看你电脑上的下载文件夹，请先打开桌面应用并保持在线。」"
            )

    lines.append(
        "内部工具 sandbox_*（仅模型可见）：用于脚本、临时文件与安全执行。"
        "对用户完全透明：禁止提及 sandbox / Docker / 容器 / /workspace，"
        "禁止把内部环境说成用户的另一台电脑；只谈结果（已生成、可预览、可下载）。"
        "该环境 ≠ 用户本机 Downloads/桌面；不要把内部路径说成用户的下载文件夹。"
    )
    lines.append(
        "关于本机文件的长期记忆可能过时；必须以本次 list_machines / host_* 的实时结果为准，"
        "不能凭记忆报「最大的文件是 xxx」。"
    )
    return "\n".join(lines)


def _connected_labels(machines: list[dict[str, Any]] | None) -> list[str]:
    if not machines:
        return []
    out: list[str] = []
    for m in machines:
        if not isinstance(m, dict):
            continue
        if not (m.get("connected") or m.get("online")):
            continue
        label = str(m.get("label") or m.get("id") or "").strip()
        if label:
            out.append(label)
    return out



def _current_device_display_name(
    client: ClientContext | None,
    machines: list[dict[str, Any]] | None,
) -> str:
    """Prefer server-side renamed label for the current machine_id."""
    if client is None:
        return ""
    mid = (client.machine_id or "").strip()
    if mid and machines:
        for m in machines:
            if not isinstance(m, dict):
                continue
            if str(m.get("id") or "").strip() == mid:
                label = str(m.get("label") or "").strip()
                if label:
                    return label
    return (client.machine_label or "").strip()


def _usual_machine_lines(machines: list[dict[str, Any]] | None) -> list[str]:
    if not machines:
        return []
    best: dict[str, Any] | None = None
    best_count = 0
    connected: list[str] = []
    for m in machines:
        if not isinstance(m, dict):
            continue
        label = str(m.get("label") or m.get("id") or "").strip()
        if m.get("connected") or m.get("online"):
            if label:
                connected.append(label)
        try:
            count = int(m.get("file_op_count") or 0)
        except (TypeError, ValueError):
            count = 0
        if count > best_count:
            best = m
            best_count = count
    lines: list[str] = []
    named: list[str] = []
    for m in machines:
        if not isinstance(m, dict):
            continue
        label = str(m.get("label") or m.get("id") or "").strip()
        mid = str(m.get("id") or "").strip()
        if not label:
            continue
        state = "已连接" if (m.get("connected") or m.get("online")) else "未连接"
        named.append(f"{label}（machine_id={mid}，{state}）")
    if named:
        lines.append("已登记的电脑：" + "；".join(named) + "。")
    if connected:
        lines.append("当前已连接、可打开软件和运行命令的电脑：" + "、".join(connected) + "。")
    if best is not None:
        label = str(best.get("label") or "工作设备")
        mid = str(best.get("id") or "")
        state = "已连接" if (best.get("connected") or best.get("online")) else "未连接"
        lines.append(f"历史上文件操作较多的电脑：{label}（machine_id={mid}，{state}；路由不优先它）。")
    return lines


def format_tools_routing_block(*, tools_enabled: bool, available_tool_names: list[str] | None) -> str:
    """Clarify builtins vs workspace vs host vs skills when tools are on."""
    if not tools_enabled:
        return ""
    names = [n for n in (available_tool_names or []) if n]
    lines = ["## 工具路由"]
    lines.append(
        "始终可用的内置工具（若已列出）：get_current_time / calculator / http_fetch / "
        "load_skill / memory_write / memory_recall 等；另有 MCP（mcp__*）与密钥工具。"
    )
    if any(n.startswith("sandbox_") for n in names):
        lines.append(
            "sandbox_*（内部名）：读写/执行临时文件与脚本；"
            "用户要跑脚本、写文件、生成可预览内容时用它们；回复只谈结果，不提工具或路径。"
        )
    if "list_machines" in names or any(n.startswith("host_") for n in names):
        lines.append(
            # Machine selection detail lives in ## 环境; keep must-load as the canonical host-skill rule.
            "主机：选机规则见「环境」。本机命令、文件查询、远程 SSH 的用法不写在系统提示里——"
            "目录有匹配技能时，动手前必须 load_skill"
            "（host-shell / host-file-query / host-ssh / computer-use），读完再调用工具；禁止跳过 load 直接调。"
            "禁止用 sandbox 冒充本机。"
        )
    if "clone_agent" in names:
        lines.append(
            "复制助手：用户在单聊里明确要复制/克隆你，或「复制后把副本改成… / 让副本去做…」时调用 clone_agent；"
            "改副本的要求一次放进参数，让副本做的事放 follow_up（副本自己执行，你不要代做）；"
            "默认会复制本助手专属记忆（copy_memory 默认 true）；当新任务与过去工作相关或设置了 follow_up 时必定复制记忆，"
            "以便副本承接旧上下文；例行任务只在用户要求时复制；完成后告诉用户新助手名称，它已出现在左侧助手列表。群聊里不要复制。"
        )
    lines.append(
        "Skills：目录有匹配技能时，动手（工具/本机命令）前必须 load_skill(name)，读完自己执行；"
        "无匹配则不必 load；禁止每条回复无条件 load；load_skill 不会自动跑脚本。"
    )
    return "\n".join(lines)


# User-visible aliases for tool status events (API names unchanged).
TOOL_DISPLAY_ALIASES: dict[str, str] = {
    "sandbox_ensure": "准备运行环境",
    "sandbox_shell": "执行命令",
    "sandbox_read": "读取文件",
    "sandbox_write": "写入文件",
    "sandbox_ls": "列出目录",
    "list_machines": "查看我的电脑",
    "host_ls": "列出本机目录",
    "host_read": "读取本机文件",
    "host_write": "写入本机文件",
    "host_delete": "删除本机文件",
    "host_move": "移动本机文件",
    "host_open": "打开软件",
    "host_screenshot": "截取屏幕",
    "host_click": "点击界面",
    "host_type": "输入文字",
    "host_key": "发送按键",
    "host_scroll": "滚动界面",
    "host_mouse_move": "移动鼠标",
    "host_drag": "拖拽",
    "host_list_windows": "列出窗口",
    "host_ax": "查看界面元素",
    "host_tcc_status": "检查权限",
    "host_shell": "在本机运行命令",
    "host_ssh_ls": "列出远程目录",
    "host_ssh_read": "读取远程文件",
    "host_ssh_write": "写入远程文件",
    "host_ssh_delete": "删除远程文件",
    "host_ssh_exec": "在远程主机上运行",
    "get_current_time": "获取当前时间",
    "calculator": "计算",
    "http_fetch": "获取网页",
    "load_skill": "正在准备…",
    "memory_write": "写入记忆",
    "memory_recall": "回忆",
    "read_upload": "查阅上传的文件",
    "send_to_agent": "发送给助手",
    "ask_agent": "正在询问同事",
    "request_secret": "请求密钥",
    "secret_http": "带密钥请求",
    "gmail_status": "Gmail 连接状态",
    "gmail_send": "Gmail 发信",
    "clone_agent": "复制助手",
}


def tool_display_label(name: str) -> str:
    """Status bubble text for users — never expose raw tool/skill ids."""
    n = (name or "").strip()
    if not n:
        return "正在处理…"
    if n in TOOL_DISPLAY_ALIASES:
        return TOOL_DISPLAY_ALIASES[n]
    if n.startswith("mcp__"):
        return "正在处理…"
    if "skill" in n.lower():
        return "正在准备…"
    return "正在处理…"
