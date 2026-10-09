"""Long-task UX for durable harness: early ack, continue nudges, auto-defer.

Ports legacy run_tool_loop autos (_defer_if_unfinished, CONTINUE_WORK /
host_followup) onto LangGraph nodes. Coexists with finalize-at-cap: prefer
defer_work when unfinished; otherwise finalize synthesizes (no canned 上限).
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from ..deferral import (
    CONTINUE_WORK,
    host_followup_prompt,
    last_real_user_text,
    turn_unfinished,
)

# Same user-facing confirm as legacy llm.DEFER_ON_EXHAUST_REPLY / Go statusWaitText.
DEFER_CONFIRM = "还在做，做好会发在这里。"

ToolHandler = Callable[[str, dict[str, Any]], Awaitable[str]]
StatusFn = Callable[[dict[str, Any]], Awaitable[None]]


def looks_like_delivery_work(tools_used: list[str] | None) -> bool:
    """Host / sandbox / skill turns may still need background handoff at cap."""
    for name in tools_used or []:
        if (
            name.startswith("host_")
            or name.startswith("sandbox_")
            or name in ("load_skill", "list_machines", "defer_work")
        ):
            return True
    return False


def continue_nudge(
    tools_used: list[str] | None,
    messages: list[dict[str, Any]] | None,
    *,
    already_continued: bool,
) -> str | None:
    """One-shot internal nudge when the model stopped too early."""
    if already_continued:
        return None
    if turn_unfinished(tools_used, messages):
        return CONTINUE_WORK
    return host_followup_prompt(tools_used, messages)


def early_ack_visible(text: str) -> str:
    """Strip to user-facing early ack; empty means do not project."""
    return (text or "").strip()


async def try_auto_defer(
    *,
    tool_handler: ToolHandler | None,
    tools_used: list[str] | None,
    messages: list[dict[str, Any]] | None,
    final_text: str = "",
    finished_cleanly: bool = False,
    on_status: StatusFn | None = None,
) -> str | None:
    """Enqueue defer_work for unfinished long turns; return confirm text or None.

    Mirrors legacy llm._defer_if_unfinished. Skips when already deferred, no
    tools ran, or a short chat already answered cleanly. Caller should append
    ``defer_work`` to tools_used when this returns a confirm.
    """
    used = list(tools_used or [])
    if finished_cleanly or not used or "defer_work" in used:
        return None
    if tool_handler is None:
        return None

    final = (final_text or "").strip()
    if not turn_unfinished(used, messages) and not looks_like_delivery_work(used):
        if final:
            return None

    goal = (last_real_user_text(messages) or "").strip()
    if not goal:
        return None

    if on_status is not None:
        await on_status(
            {
                "phase": "thinking",
                "label": "回合用尽，转到后台继续",
            }
        )
    try:
        raw = await tool_handler("defer_work", {"goal": goal})
    except Exception:  # noqa: BLE001
        return None
    try:
        obj = json.loads(raw) if isinstance(raw, str) else None
    except json.JSONDecodeError:
        obj = None
    if isinstance(obj, dict) and obj.get("error"):
        return None
    return DEFER_CONFIRM
