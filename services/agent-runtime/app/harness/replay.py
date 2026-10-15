"""Tool replay policy after crash mid-tool."""

from __future__ import annotations

from typing import Literal

ReplayPolicy = Literal["safe", "interrupted"]

# Tools that may re-run after a crash without corrupting external state.
_SAFE_DEFAULT = frozenset(
    {
        "load_skill",
        "memory_recall",
        "read_upload",
        "list_machines",
        "list_routines",
        "sandbox_ls",
        "sandbox_read",
        "host_ls",
        "host_read",
        "host_screenshot",
        "host_ssh_ls",
        "host_ssh_read",
        "time_now",
        "calc",
        "http_fetch",
    }
)


def policy_for(tool_name: str) -> ReplayPolicy:
    name = (tool_name or "").strip()
    if name in _SAFE_DEFAULT or name.startswith("mcp__"):
        # MCP default: interrupted (unknown side effects); mark safe via env later.
        if name.startswith("mcp__"):
            return "interrupted"
        return "safe"
    return "interrupted"


def interrupted_result(tool_name: str, partial: str = "") -> str:
    import json

    payload = {
        "error": "interrupted",
        "tool": tool_name,
        "message": "进程在工具执行中断后恢复；该工具不可安全重放，已返回 interrupted。",
    }
    if partial:
        payload["partial_output"] = partial[:4000]
    return json.dumps(payload, ensure_ascii=False)
