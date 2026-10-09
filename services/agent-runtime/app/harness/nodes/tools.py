"""Tools node: execute pending tool_calls with approval interrupt + replay policy."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.types import interrupt

from ...client_env import tool_display_label
from ...llm import guide_tool_result, truncate_tool_result_for_context
from ..config import require_approval_tools
from ..registry import get_registry
from ..replay import interrupted_result, policy_for
from ..state import AgentState


def _cfg(config: dict[str, Any]) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


def _parse_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            out = json.loads(raw)
            return out if isinstance(out, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


async def tools_node(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    cfg = _cfg(config)
    handler = cfg.get("tool_handler")
    on_status = cfg.get("on_status")
    on_event = cfg.get("on_event")
    journal = cfg.get("journal")
    tool_calls = list(state.get("pending_tool_calls") or [])
    msgs = list(state.get("messages") or [])
    used = list(state.get("tools_used") or [])
    replay_results = dict(state.get("replay_results") or {})
    approval_needed = require_approval_tools()
    registry = get_registry()
    if state.get("extension_names"):
        registry.select(list(state.get("extension_names") or []))

    needing = [
        tc
        for tc in tool_calls
        if str((tc.get("function") or {}).get("name") or "") in approval_needed
    ]
    if needing and not state.get("approval_pending"):
        names = [
            str((tc.get("function") or {}).get("name") or "") for tc in needing
        ]
        if journal is not None:
            await journal.set_status("waiting_approval")
            await journal.append(
                "approval_gate",
                {"tools": names},
                project=False,
            )
        if on_status is not None:
            await on_status(
                {
                    "phase": "waiting_approval",
                    "label": "等待确认后继续",
                    "tools": names,
                }
            )
        decision = interrupt(
            {
                "type": "tool_approval",
                "tools": names,
                "tool_calls": needing,
                "reason": "dangerous_or_sensitive_tool",
            }
        )
        approved = True
        if isinstance(decision, dict):
            approved = bool(decision.get("approve", True))
        if not approved:
            reason = ""
            if isinstance(decision, dict):
                reason = str(decision.get("reason") or "user_rejected")
            for tc in needing:
                tc_id = str(tc.get("id") or "")
                fn = tc.get("function") or {}
                name = str(fn.get("name") or "")
                body = json.dumps(
                    {"error": "rejected", "reason": reason or "user_rejected"},
                    ensure_ascii=False,
                )
                msgs.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "name": name,
                        "content": body,
                    }
                )
                used.append(name)
                if journal is not None:
                    await journal.commit_tool_result(tc_id, name, body)
            tool_calls = [tc for tc in tool_calls if tc not in needing]
        elif journal is not None:
            await journal.set_status("running")

    for tc in tool_calls:
        fn = tc.get("function") or {}
        name = str(fn.get("name") or "")
        tc_id = str(tc.get("id") or "")
        args = _parse_args(fn.get("arguments"))
        policy = policy_for(name)

        if tc_id and tc_id in replay_results:
            content = truncate_tool_result_for_context(replay_results[tc_id])
            msgs.append(
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "name": name,
                    "content": content,
                }
            )
            if name:
                used.append(name)
            continue

        if journal is not None:
            await journal.append(
                "tool_intent",
                {"tool_call_id": tc_id, "name": name, "arguments": args},
                project=False,
            )

        if on_status is not None:
            await on_status(
                {
                    "phase": "tool",
                    "label": tool_display_label(name),
                    "tool": name,
                }
            )
        if on_event is not None:
            await on_event(
                "tool_execution_start",
                {"tool": name, "tool_call_id": tc_id},
            )

        await registry.run_hooks("beforeTool", name=name, args=args, tool_call_id=tc_id)

        content = ""
        try:
            if handler is None:
                content = json.dumps({"error": "no tool_handler"}, ensure_ascii=False)
            else:
                content = await handler(name, args)
        except Exception as exc:  # noqa: BLE001
            if policy == "interrupted":
                content = interrupted_result(name, partial=str(exc))
            else:
                content = json.dumps({"error": str(exc)}, ensure_ascii=False)

        await registry.run_hooks(
            "afterTool", name=name, args=args, content=content, tool_call_id=tc_id
        )

        content = guide_tool_result(name, content)
        content = truncate_tool_result_for_context(content)
        if tc_id:
            replay_results[tc_id] = content
        msgs.append(
            {
                "role": "tool",
                "tool_call_id": tc_id,
                "name": name,
                "content": content,
            }
        )
        if name:
            used.append(name)
        if journal is not None:
            await journal.commit_tool_result(tc_id, name, content)
            await journal.put_live(
                {"phase": "tool", "tool": name, "tool_call_id": tc_id},
                force=False,
            )
        if on_event is not None:
            await on_event(
                "tool_execution_end",
                {"tool": name, "tool_call_id": tc_id, "ok": True},
            )

    return {
        "messages": msgs,
        "tools_used": used,
        "pending_tool_calls": [],
        "approval_pending": [],
        "replay_results": replay_results,
        "status": "running",
        "interrupted_reason": "",
    }
