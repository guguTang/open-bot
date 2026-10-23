"""Smoke tests for client_env + list_machines tool registration."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.client_env import (  # noqa: E402
    ClientContext,
    format_environment_block,
    tool_display_label,
)
from app.llm import TOOL_DEFS, build_system_prompt  # noqa: E402


def _ok(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  OK  {msg}")


def test_from_any_and_env_block() -> None:
    c = ClientContext.from_any(
        {
            "platform": "web",
            "app": "browser",
            "os": "darwin",
            "capabilities": {"host_tools": False, "workspace_tools": True},
        }
    )
    _ok(c is not None and c.platform == "web", "parse web client")
    block = format_environment_block(c, machines=[])
    _ok("环境" in block and "sandbox_*" in block, "env block mentions internal sandbox_*")
    _ok("工作电脑" not in block, "env block does not invent 工作电脑 for users")
    _ok("禁止提及" in block and "Docker" in block, "instructs model not to say Docker")
    _ok("网页浏览器" in block, "browser chat is explicit")
    _ok("硬性" in block and "编造" in block, "hard rule when no connected hosts")
    _ok("已连接" in block and "代操作" in format_environment_block(
        c,
        machines=[{"id": "m1", "label": "书房 Mac", "connected": True, "file_op_count": 3}],
    ), "browser can still use a connected desktop")


def test_browser_ignores_stale_machine_label() -> None:
    c = ClientContext(
        platform="web",
        app="browser",
        os="darwin",
        machine_id="m-mac",
        machine_label="我的 Mac",
    )
    machines = [
        {
            "id": "m-mac",
            "label": "我的 Mac",
            "connected": False,
            "online": False,
            "file_op_count": 9,
        }
    ]
    block = format_environment_block(c, machines)
    _ok("网页浏览器" in block, "states browser")
    _ok("用户当前正在这台设备上聊天：我的 Mac" not in block, "does not claim chatting on Mac")
    _ok("未连接" in block and "硬性" in block, "offline machines trigger hard rule")


def test_tool_defs_include_list_machines() -> None:
    names = {str((t.get("function") or {}).get("name") or "") for t in TOOL_DEFS}
    _ok("list_machines" in names, "list_machines in TOOL_DEFS")
    _ok("host_ls" in names and "host_read" in names and "host_write" in names, "host file tools present")
    _ok("host_delete" in names and "host_move" in names, "dangerous host tools present")
    _ok("host_find_app" in names and "host_open" in names and "host_shell" in names, "host find/open and shell tools present")
    _ok("host_ssh_exec" in names and "host_ssh_ls" in names and "host_ssh_read" in names, "ssh client tools present")
    shell = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_shell")
    desc = str((shell.get("function") or {}).get("description") or "")
    _ok("host-ssh" in desc, "local shell points remote ssh at host-ssh skill")
    env = format_environment_block(
        ClientContext(platform="macos", app="tauri", os="darwin", arch="arm64")
    )
    _ok("load_skill" in env and "host-ssh" in env, "env points remote ssh at host-ssh skill via load_skill")
    _ok("fingerprint" not in env.lower() and "ssh-agent" not in env.lower(), "env omits long ssh tutorial")
    _ok("Auto-review" not in env and "host_delete" not in env, "env omits auto-review / delete how-to")
    _ok(tool_display_label("sandbox_ls") == "列出目录", "sandbox_ls alias")
    _ok(tool_display_label("sandbox_write") == "写入文件", "sandbox_write alias")


def test_system_prompt_routing() -> None:
    client = ClientContext(platform="macos", app="tauri", os="darwin", arch="arm64")
    prompt = build_system_prompt(
        agent_id="open-bot",
        skills_catalog="（无）",
        memory_snippets=[],
        tools_enabled=True,
        available_tool_names=["list_machines", "sandbox_ls", "get_current_time", "load_skill"],
        client=client,
    )
    _ok("## 环境" in prompt, "has 环境 section")
    _ok("list_machines" in prompt, "mentions list_machines")
    _ok("sandbox_*" in prompt, "mentions internal sandbox_*")
    _ok("工作电脑" not in prompt, "no 工作电脑 in prompt")
    _ok("沙箱电脑" not in prompt, "no 沙箱电脑 in prompt")
    _ok("完全透明" in prompt or "只谈结果" in prompt, "instructs outcome-only user speech")
    _ok("必须 host_ls" not in prompt, "no longer forces host_ls for largest/newest")
    _ok("load_skill" in prompt, "always-on prompt points at load_skill")
    _ok("host-file-query" in prompt or "host-shell" in prompt, "routing names host skills to load")
    _ok("必须" in prompt and "动手前必须" in prompt, "Hermes-style: must load_skill before acting on match")
    _ok("需要时 load_skill" not in prompt and "需要做法时" not in prompt, "soft optional load_skill phrasing removed")
    _ok("无匹配" in prompt or "不必" in prompt, "still not load before every reply regardless of match")
    _ok("find/du" not in prompt.lower() and "host_ls 只用于" not in prompt, "no find/du or host_ls how-to recipe")
    _ok("paths 一次" not in prompt and "硬危险命令" not in prompt, "no delete-paths / auto-review how-to")
    _ok("load_skill 不会自动执行" not in prompt and "脚本要你再用" not in prompt, "no host-file-query script recipe in prompt")
    _ok("skill_view" not in prompt, "keeps open-bot tool name load_skill not skill_view")




def test_machine_label_in_env_block() -> None:
    client = ClientContext(
        platform="macos",
        app="tauri",
        os="darwin",
        machine_id="m-1",
        machine_label="旧名",
    )
    machines = [
        {"id": "m-1", "label": "书房 Mac", "connected": True, "file_op_count": 3},
        {"id": "m-2", "label": "公司本", "connected": False, "file_op_count": 1},
    ]
    block = format_environment_block(client, machines)
    _ok("书房 Mac" in block, "prefers server-side renamed label")
    _ok("用户当前正在这台设备上聊天：书房 Mac" in block, "states current chatting device")
    _ok("已登记的电脑：" in block and "公司本" in block, "lists other machines by name")
    _ok("工作电脑" not in block, "no 工作电脑 wording")


def test_app_lookup_prefers_host_open() -> None:
    find = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_find_app")
    fdesc = str((find.get("function") or {}).get("description") or "")
    _ok("installed" in fdesc.lower() or "without opening" in fdesc.lower(), "host_find_app is check-only")
    _ok("host_open" in fdesc, "host_find_app points open to host_open")
    _ok(".app" in fdesc, "host_find_app resolves .app on Mac")
    _ok("mdfind" in fdesc, "host_find_app steers away from mdfind")
    opened = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_open")
    ofn = opened.get("function") or {}
    odesc = str(ofn.get("description") or "")
    props = (ofn.get("parameters") or {}).get("properties") or {}
    _ok("launch" not in props, "host_open has no launch parameter")
    _ok("host_find_app" in odesc, "host_open points install-check to host_find_app")
    _ok(".app" in odesc, "host_open resolves .app on Mac")
    _ok("mdfind" in odesc, "host_open steers away from mdfind")
    shell = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_shell")
    sdesc = str((shell.get("function") or {}).get("description") or "")
    _ok("host_find_app" in sdesc, "host_shell sends install-check to host_find_app")
    _ok("host_open" in sdesc, "host_shell sends open to host_open")
    _ok("kMDItemKind" in sdesc and "mdfind" in sdesc, "host_shell warns against localized Spotlight Kind")
    _ok("does not mean the app is not installed" in sdesc, "empty mdfind is not not-installed")
    _ok("find/du" not in sdesc.lower(), "app-lookup hint does not embed find/du how-to")
    skills = Path(__file__).resolve().parents[3] / "skills"
    host_shell_skill = (skills / "host-shell" / "SKILL.md").read_text()
    computer_use_skill = (skills / "computer-use" / "SKILL.md").read_text()
    for label, text in (("host-shell", host_shell_skill), ("computer-use", computer_use_skill)):
        _ok("host_find_app" in text and "host_open" in text and "kMDItemKind" in text, f"{label} skill splits find vs open")
        _ok("应用程序" in text, f"{label} skill names the zh_CN Kind")


def test_host_ls_tool_is_shallow_browse() -> None:
    ls = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_ls")
    desc = str((ls.get("function") or {}).get("description") or "")
    props = ((ls.get("function") or {}).get("parameters") or {}).get("properties") or {}
    _ok("Not for largest" in desc or "shallow" in desc.lower() or "Shallow" in desc, "host_ls desc is shallow-browse")
    _ok("limit" in props and "sort" in props and "glob" in props, "host_ls has limit/sort/glob params")
    shell = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_shell")
    sdesc = str((shell.get("function") or {}).get("description") or "")
    _ok("load_skill" in sdesc and "host-shell" in sdesc, "host_shell desc points at load_skill host-shell")
    _ok("find/du" not in sdesc.lower(), "host_shell desc does not embed find/du how-to")


if __name__ == "__main__":
    test_from_any_and_env_block()
    test_browser_ignores_stale_machine_label()
    test_tool_defs_include_list_machines()
    test_system_prompt_routing()
    test_machine_label_in_env_block()
    test_app_lookup_prefers_host_open()
    test_host_ls_tool_is_shallow_browse()
    print("all passed")


def test_tools_routing_distinguishes_ask_vs_send():
    from app.client_env import format_tools_routing_block

    block = format_tools_routing_block(
        tools_enabled=True,
        available_tool_names=["ask_agent", "send_to_agent", "get_current_time"],
    )
    assert "ask_agent" in block and "send_to_agent" in block
    assert "移交" in block or "接手" in block
    assert "咨询" in block or "问答" in block

