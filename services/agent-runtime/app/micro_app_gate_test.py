"""Unit tests for Phase 6 micro-app dual-gate helpers (no live API)."""

from __future__ import annotations

import json

from .micro_app_gate import (
    TOOL_TO_CAPABILITY,
    capability_declared,
    capability_for_tool,
    filter_tools_for_micro_app,
    is_hostish_tool,
    reject_payload,
)


def test_tool_capability_map():
    assert capability_for_tool("host_shell") == "host.shell.run"
    assert capability_for_tool("host_screenshot") == "host.screenshot"
    assert capability_for_tool("host_click") is None
    assert TOOL_TO_CAPABILITY["host_ls"] == "host.fs.read"


def test_capability_declared_alternates():
    assert capability_declared(["host.fs.workspace"], "host.fs.read")
    assert capability_declared(["host.fs.workspace"], "host.fs.write")
    assert not capability_declared(["host.fs.workspace"], "host.shell.run")
    assert capability_declared(["host.shell.run"], "host.shell.run")


def test_filter_tools_for_micro_app():
    names = [
        "get_current_time",
        "host_shell",
        "host_screenshot",
        "host_click",
        "sandbox_shell",
        "list_machines",
    ]
    filtered = filter_tools_for_micro_app(
        names,
        capabilities=["host.shell.run"],
        host_tools=True,
    )
    assert "get_current_time" in filtered
    assert "sandbox_shell" in filtered
    assert "list_machines" in filtered
    assert "host_shell" in filtered
    assert "host_screenshot" not in filtered
    assert "host_click" not in filtered

    no_host = filter_tools_for_micro_app(
        names, capabilities=["host.shell.run"], host_tools=False
    )
    assert "host_shell" not in no_host
    assert "get_current_time" in no_host


def test_reject_payload_structured():
    raw = reject_payload(
        error_code="capability_not_declared",
        tool="host_shell",
        micro_app_id="app1",
        capability="host.shell.run",
    )
    data = json.loads(raw)
    assert data["ok"] is False
    assert data["error_code"] == "capability_not_declared"
    assert data["capability"] == "host.shell.run"
    assert data["micro_app_id"] == "app1"


def test_is_hostish():
    assert is_hostish_tool("host_shell")
    assert is_hostish_tool("host_ssh_exec")
    assert not is_hostish_tool("sandbox_shell")
    assert not is_hostish_tool("draft_micro_app")
    assert not is_hostish_tool("upload_micro_app_bundle")
    assert not is_hostish_tool("pin_micro_app")


def test_iter_tool_defs_allowed_names():
    from .llm import iter_tool_defs

    all_tools = iter_tool_defs(allow_ask_agent=False)
    names = {t["function"]["name"] for t in all_tools}
    assert "host_shell" in names
    filtered = iter_tool_defs(
        allow_ask_agent=False,
        allowed_names=["get_current_time", "host_shell"],
    )
    fnames = {t["function"]["name"] for t in filtered}
    assert fnames == {"get_current_time", "host_shell"}
