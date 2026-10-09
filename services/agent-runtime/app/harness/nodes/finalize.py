"""Forced finalization: one tools-off LLM turn when the round cap is hit."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from ... import langfuse_trace as lf
from ...llm import (
    chat_completion,
    fold_tool_results_in_messages,
    openai_config,
    postprocess_text,
    profile_for,
    sanitize_fake_tool_narration,
    strip_think,
)
from ...tool_markup import strip_tool_markup
from .. import tracing
from ..long_task import try_auto_defer
from ..state import AgentState
from .llm import _is_group_pass

# Nudge the model to answer from history. Do NOT mention round limits to the user.
_FINALIZE_NUDGE = (
    "请根据到目前为止的工具结果与对话内容，直接回答用户的问题。"
    "给出实质性结论与要点；如信息不足请说明已查到什么、还缺什么。"
    "不要提及轮次、上限、工具次数或内部限制。"
)

_FINALIZE_RETRIES = 2


def _cfg(config: dict[str, Any] | RunnableConfig) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


async def finalize_node(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Synthesize a user-facing answer with tools disabled (cap / empty final_text)."""
    cfg = _cfg(config)
    api_key = str(cfg.get("api_key") or "")
    override = cfg.get("override")
    on_status = cfg.get("on_status")
    on_event = cfg.get("on_event")
    journal = cfg.get("journal")
    msgs = list(state.get("messages") or [])
    usage_acc = state.get("usage")
    existing = str(state.get("final_text") or "").strip()
    if existing:
        return {
            "final_text": existing,
            "pending_tool_calls": [],
            "status": "done",
            "needs_finalize": False,
            "needs_continue": False,
        }

    # Prefer background handoff when the inline turn is still unfinished.
    used = list(state.get("tools_used") or [])
    deferred = await try_auto_defer(
        tool_handler=cfg.get("tool_handler"),
        tools_used=used,
        messages=msgs,
        final_text="",
        finished_cleanly=False,
        on_status=on_status,
    )
    if deferred:
        if "defer_work" not in used:
            used.append("defer_work")
        out_msgs = list(msgs)
        out_msgs.append({"role": "assistant", "content": deferred})
        if journal is not None:
            await journal.commit_assistant(deferred, project=not _is_group_pass(deferred))
            await journal.put_live({"phase": "assistant", "len": len(deferred)}, force=True)
        if on_event is not None:
            await on_event("message_end", {"text": deferred})
        return {
            "messages": out_msgs,
            "final_text": deferred,
            "pending_tool_calls": [],
            "tools_used": used,
            "status": "done",
            "needs_finalize": False,
            "needs_continue": False,
            "needs_compaction": False,
        }

    _, base, model = openai_config(override)
    profile = profile_for(model, base)

    if on_status is not None:
        await on_status({"phase": "thinking", "label": "整理结论"})

    work_msgs = fold_tool_results_in_messages(list(msgs))
    # Avoid duplicating the nudge if finalize is re-entered.
    if not any(
        m.get("role") == "user" and m.get("content") == _FINALIZE_NUDGE for m in work_msgs
    ):
        work_msgs.append({"role": "user", "content": _FINALIZE_NUDGE})

    def _accumulate(data: dict[str, Any]) -> None:
        nonlocal usage_acc
        usage_acc = lf.merge_usage_details(
            usage_acc, lf.parse_usage_details(_raw_usage(data))
        )

    final = ""
    last_err: Exception | None = None
    with tracing.generation_span(model=model, messages=work_msgs) as gen_obs:
        for _attempt in range(_FINALIZE_RETRIES):
            try:
                data = await chat_completion(
                    work_msgs,
                    api_key=api_key,
                    tools=None,
                    tool_choice=None,
                    override=override,
                )
                _accumulate(data)
                choices = data.get("choices") or []
                if not choices:
                    last_err = RuntimeError("empty LLM completion (no choices)")
                    continue
                raw = str((choices[0].get("message") or {}).get("content") or "")
                final = postprocess_text(strip_think(strip_tool_markup(raw)), profile)
                final = sanitize_fake_tool_narration(final)
                if final.strip():
                    lf.update_obs(gen_obs, output=lf.truncate(final))
                    break
                last_err = RuntimeError("empty finalize completion")
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                continue

    if not final.strip():
        # Surface as run failure so clients show（失败）… — never a「上限」canned line.
        detail = str(last_err or "未能生成最终回复")[:300]
        raise RuntimeError(detail)

    out_msgs = list(msgs)
    out_msgs.append({"role": "assistant", "content": final})
    if journal is not None:
        await journal.commit_assistant(final, project=not _is_group_pass(final))
        await journal.put_usage(usage_acc if isinstance(usage_acc, dict) else None)
        await journal.put_live({"phase": "assistant", "len": len(final)}, force=True)
    if on_event is not None:
        await on_event("message_end", {"text": final})

    return {
        "messages": out_msgs,
        "final_text": final,
        "pending_tool_calls": [],
        "status": "done",
        "usage": usage_acc,
        "needs_finalize": False,
        "needs_compaction": False,
    }


def _raw_usage(data: dict[str, Any]) -> dict[str, Any] | None:
    u = data.get("usage")
    return u if isinstance(u, dict) else None
