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
    host_list_hint,
    last_real_user_text,
    turn_unfinished,
)

# Same user-facing confirm as legacy llm.DEFER_ON_EXHAUST_REPLY / Go statusWaitText.
DEFER_CONFIRM = "还在做，好了发这里。"

# Soft system hint when the previous turn was superseded by a new user message.
# Model writes one short natural sentence about what it will do next for the NEW
# ask (plan / next step) — not a canned ack and not empty reassurance.
AFTER_INTERRUPT_HINT = (
    "上一轮被用户新消息打断。"
    "先用一句自然语言说明你接下来要为本轮新问题做什么"
    "（简短计划或下一步；禁止空安抚、禁止套话如「已认领」「收到」「好的我来处理」），"
    "然后再动手继续完成本轮请求。"
)


def apply_after_interrupt_hint(
    system: str, dynamic_system: str, *, after_interrupt: bool
) -> tuple[str, str]:
    """Append soft after-interrupt UX hint. No-op when flag is false."""
    if not after_interrupt:
        return system, dynamic_system
    hint = AFTER_INTERRUPT_HINT
    system_out = (f"{system}\n\n{hint}").strip() if (system or "").strip() else hint
    dynamic_out = (
        (f"{dynamic_system}\n\n{hint}").strip() if (dynamic_system or "").strip() else hint
    )
    return system_out, dynamic_out


def apply_host_list_hint(system: str, dynamic_system: str, user_text: str) -> tuple[str, str]:
    """Add the host-list line before the model acts, only for this turn's own ask."""
    hint = host_list_hint(user_text)
    if not hint:
        return system, dynamic_system
    system_out = (f"{system}\n\n{hint}").strip() if (system or "").strip() else hint
    dynamic_out = (
        (f"{dynamic_system}\n\n{hint}").strip() if (dynamic_system or "").strip() else hint
    )
    return system_out, dynamic_out



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


# Internal nudge when after_interrupt turn stopped after the plan sentence only.
CONTINUE_AFTER_INTERRUPT = (
    "上一轮已被新消息打断：刚才那句只是计划。"
    "立刻动手完成本轮新问题（该查就查、该总结就总结），"
    "不要再只复述计划或空安抚。"
)


def continue_nudge(
    tools_used: list[str] | None,
    messages: list[dict[str, Any]] | None,
    *,
    already_continued: bool,
    after_interrupt: bool = False,
    final_text: str = "",
    ask_routed: bool = False,
) -> str | None:
    """One-shot internal nudge when the model stopped too early."""
    if already_continued:
        return None
    # A colleague already delivered this turn. A sandbox link in their reply
    # must not look like unfinished work for the caller.
    if not ask_routed and turn_unfinished(tools_used, messages):
        return CONTINUE_WORK
    host = host_followup_prompt(tools_used, messages)
    if host:
        return host
    # Replace interrupt: model often emits only the soft plan sentence then
    # finishes (seen in prod: one-liner + tools_used=[]). Nudge once to actually
    # continue the NEW ask so the user gets a real reply, not a silent/idle UI.
    if after_interrupt:
        brief = (final_text or "").strip()
        if brief and len(brief) <= 240 and not (tools_used or []):
            return CONTINUE_AFTER_INTERRUPT
    return None


# Soft cap for projected first bubble when the model preamble is long.
_EARLY_ACK_MAX = 80


def early_ack_visible(text: str, *, max_chars: int = _EARLY_ACK_MAX) -> str:
    """Brief user-facing early ack; empty means do not project.

    Short preambles pass through. Long ones prefer the first Chinese sentence
    (or newline); soft-cap as last resort. Full assistant content still lives on
    the tool-call turn — only the projected bubble is shortened.
    """
    text = (text or "").strip()
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    brief = text
    for sep in ("。", "！", "？", "\n"):
        i = text.find(sep)
        if i < 0:
            continue
        candidate = text[: i if sep == "\n" else i + 1].strip()
        if candidate:
            brief = candidate
            break
    if len(brief) > max_chars:
        brief = brief[: max_chars - 1].rstrip() + "…"
    return brief


# Project first early ack, then at most every N tool-LLM rounds (阶段性进展).
STAGE_PROJECT_EVERY = 4


def should_project_tool_partial(
    *,
    already_projected: bool,
    tool_llm_rounds: int,
    every: int = STAGE_PROJECT_EVERY,
) -> bool:
    """Whether this tool-turn assistant_partial should hit chat.

    - First visible ack: always project (brief early ack).
    - Later turns: project only every ``every`` tool-LLM rounds so the user
      gets occasional short stage updates, not a monologue per tool call.
    ``tool_llm_rounds`` is 1-based count of LLM turns that emitted tool_calls
    in this run (including the current one).
    """
    if tool_llm_rounds < 1:
        return False
    if not already_projected:
        return True
    if every <= 0:
        return False
    # After the first ack (round 1), next projections at 1+every, 1+2*every, …
    return tool_llm_rounds > 1 and (tool_llm_rounds - 1) % every == 0


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
                "label": "后台继续…",
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
