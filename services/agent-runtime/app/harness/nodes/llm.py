"""LLM node: one model turn; populates pending_tool_calls or final_text."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from ... import langfuse_trace as lf
from ...llm import (
    AutoToolChoiceUnsupported,
    TOOL_DEFS,
    chat_completion,
    is_context_length_error,
    openai_config,
    postprocess_text,
    profile_for,
    sanitize_fake_tool_narration,
    strip_think,
    tools_enabled,
)
from ...tool_markup import (
    content_has_tool_markup,
    parse_tool_markup,
    strip_tool_markup,
    to_openai_tool_calls,
)
from ..long_task import continue_nudge, early_ack_visible, try_auto_defer
from ..state import AgentState
from .. import tracing



def _is_group_pass(text: str) -> bool:
    """Mirror API ContentIsGroupPass: silence sentinel must not project to messages."""
    import re

    t = (text or "").strip()
    if not t:
        return True
    for _ in range(8):
        prev = t
        t = t.strip().strip("` \t\r\n\"'").strip("*_~").strip()
        for a, b in (
            ("[", "]"),
            ("【", "】"),
            ("（", "）"),
            ("(", ")"),
            ("「", "」"),
            ("『", "』"),
            ("<", ">"),
            ("《", "》"),
        ):
            if t.startswith(a) and t.endswith(b) and len(t) >= len(a) + len(b):
                t = t[len(a) : len(t) - len(b)].strip()
        t = t.rstrip("。.!！…").strip()
        if t == prev:
            break
    return bool(re.fullmatch(r"pass", t, flags=re.I))


def _cfg(config: dict[str, Any]) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


async def llm_node(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    cfg = _cfg(config)
    api_key = str(cfg.get("api_key") or "")
    override = cfg.get("override")
    on_status = cfg.get("on_status")
    on_event = cfg.get("on_event")
    journal = cfg.get("journal")
    extra_tools = list(cfg.get("extra_tools") or [])
    msgs = list(state.get("messages") or [])
    rnd = int(state.get("round") or 0) + 1
    max_rounds = int(state.get("max_rounds") or 12)
    compaction_retries = int(state.get("compaction_retries") or 0)

    if rnd > max_rounds:
        # Prefer auto-defer for unfinished long work; else finalize-at-cap (no 上限 canned).
        existing = str(state.get("final_text") or "").strip()
        if existing:
            return {
                "status": "done",
                "final_text": existing,
                "pending_tool_calls": [],
                "round": rnd,
                "needs_finalize": False,
                "needs_continue": False,
            }
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
            used = list(used)
            if "defer_work" not in used:
                used.append("defer_work")
            if journal is not None:
                await journal.commit_assistant(deferred, project=not _is_group_pass(deferred))
                await journal.put_live({"phase": "assistant", "len": len(deferred)}, force=True)
            if on_event is not None:
                await on_event("message_end", {"text": deferred})
            return {
                "status": "done",
                "final_text": deferred,
                "pending_tool_calls": [],
                "tools_used": used,
                "round": rnd,
                "needs_finalize": False,
                "needs_continue": False,
            }
        return {
            "status": "running",
            "final_text": "",
            "pending_tool_calls": [],
            "round": rnd,
            "needs_finalize": True,
            "needs_continue": False,
        }

    # Merge follow-ups before the next model call.
    follow = list(state.get("follow_up_queue") or [])
    if follow:
        for text in follow:
            t = (text or "").strip()
            if t:
                msgs.append({"role": "user", "content": t})

    _, base, model = openai_config(override)
    profile = profile_for(model, base)
    tools_on = tools_enabled(override)

    if on_status is not None:
        await on_status({"phase": "thinking", "label": "思考中"})

    usage_acc = state.get("usage")

    def _accumulate(data: dict[str, Any]) -> None:
        nonlocal usage_acc
        usage_acc = lf.merge_usage_details(
            usage_acc, lf.parse_usage_details(_raw_usage(data))
        )

    with tracing.generation_span(model=model, messages=msgs) as gen_obs:
        if not tools_on:
            data = await chat_completion(msgs, api_key=api_key, tools=None, override=override)
            _accumulate(data)
            choices = data.get("choices") or []
            if not choices:
                raise RuntimeError("empty LLM completion (no choices)")
            raw = str((choices[0].get("message") or {}).get("content") or "")
            final = postprocess_text(strip_think(strip_tool_markup(raw)), profile)
            final = sanitize_fake_tool_narration(final)
            lf.update_obs(gen_obs, output=lf.truncate(final))
            if journal is not None and final:
                await journal.commit_assistant(final, project=not _is_group_pass(final))
                await journal.put_usage(usage_acc if isinstance(usage_acc, dict) else None)
            if on_event is not None and final:
                await on_event("message_end", {"text": final})
            return {
                "messages": msgs,
                "final_text": final,
                "pending_tool_calls": [],
                "status": "done",
                "round": rnd,
                "usage": usage_acc,
                "follow_up_queue": [],
                "needs_compaction": False,
            }

        tools = list(TOOL_DEFS) + extra_tools
        choice: str | None = "auto" if profile.tool_choice_auto else None
        try:
            data = await chat_completion(
                msgs,
                api_key=api_key,
                tools=tools,
                tool_choice=choice,
                override=override,
            )
        except AutoToolChoiceUnsupported:
            data = await chat_completion(
                msgs, api_key=api_key, tools=None, override=override
            )
        except RuntimeError as exc:
            if not is_context_length_error(str(exc)):
                raise
            # Align pi: one compaction + retry on same thread.
            if compaction_retries < 1:
                if on_event is not None:
                    await on_event("compaction_start", {"reason": "context_overflow"})
                return {
                    "messages": msgs,
                    "needs_compaction": True,
                    "compaction_retries": compaction_retries + 1,
                    "pending_tool_calls": [],
                    "status": "running",
                    "round": rnd - 1,  # compact then re-llm same logical round
                    "follow_up_queue": follow,
                }
            raise

        _accumulate(data)
        if journal is not None and usage_acc:
            await journal.put_usage(usage_acc if isinstance(usage_acc, dict) else None)

        choices = data.get("choices") or []
        if not choices:
            # Empty completion must surface as a run failure (not silent PASS / no bubble).
            raise RuntimeError("empty LLM completion (no choices)")

        msg = choices[0].get("message") or {}
        tool_calls = list(msg.get("tool_calls") or [])
        content = msg.get("content")
        content_str = str(content or "")

        if not tool_calls and content_has_tool_markup(content_str):
            parsed = parse_tool_markup(content_str)
            if parsed:
                tool_calls = to_openai_tool_calls(parsed)
                cleaned = strip_tool_markup(content_str)
                content = cleaned if cleaned else None
                content_str = str(content or "")

        if tool_calls:
            msgs.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": tool_calls,
                }
            )
            lf.update_obs(
                gen_obs,
                output=lf.truncate({"content": content, "tool_calls": len(tool_calls)}),
            )
            if journal is not None:
                await journal.commit_tool_intent(tool_calls)
                ack = early_ack_visible(
                    postprocess_text(strip_think(strip_tool_markup(content_str)), profile)
                )
                if ack and not _is_group_pass(ack):
                    # Project early so the user sees an ack soon (not journal-only).
                    await journal.append(
                        "assistant_partial",
                        {"role": "assistant", "content": ack},
                        project=True,
                        role="assistant",
                        content=ack,
                    )
                    await journal.put_live({"phase": "assistant_partial", "len": len(ack)}, force=True)
                    if on_status is not None:
                        await on_status(
                            {
                                "phase": "thinking",
                                "label": "正在做…",
                            }
                        )
                elif content_str.strip():
                    await journal.append(
                        "assistant_partial",
                        {"content": content_str},
                        project=False,
                    )
            return {
                "messages": msgs,
                "pending_tool_calls": tool_calls,
                "final_text": "",
                "status": "running",
                "round": rnd,
                "usage": usage_acc,
                "follow_up_queue": [],
                "needs_compaction": False,
                "needs_continue": False,
            }

        final = postprocess_text(strip_think(strip_tool_markup(content_str)), profile)
        final = sanitize_fake_tool_narration(final)
        used = list(state.get("tools_used") or [])
        already = bool(state.get("work_continued"))
        # Build provisional history including this assistant text for unfinished checks.
        probe_msgs = list(msgs) + [{"role": "assistant", "content": final or content or ""}]
        nudge = continue_nudge(used, probe_msgs, already_continued=already)
        if nudge:
            if on_status is not None:
                label = (
                    "先访问本机…"
                    if "host_delete" in nudge or "list_machines" in nudge or "host_ls" in nudge
                    else "正在做…"
                )
                await on_status({"phase": "thinking", "label": label})
            msgs.append({"role": "assistant", "content": final or content or ""})
            msgs.append({"role": "user", "content": nudge})
            lf.update_obs(gen_obs, output=lf.truncate({"continued": True, "nudge": nudge[:40]}))
            return {
                "messages": msgs,
                "pending_tool_calls": [],
                "final_text": "",
                "status": "running",
                "round": rnd,
                "usage": usage_acc,
                "follow_up_queue": [],
                "needs_compaction": False,
                "needs_continue": True,
                "work_continued": True,
                "needs_finalize": False,
            }

        msgs.append({"role": "assistant", "content": content})
        lf.update_obs(gen_obs, output=lf.truncate(final))
        if journal is not None and final:
            await journal.commit_assistant(final, project=not _is_group_pass(final))
            await journal.put_live({"phase": "assistant", "len": len(final)}, force=True)
        if on_event is not None and final:
            await on_event("message_end", {"text": final})
        return {
            "messages": msgs,
            "pending_tool_calls": [],
            "final_text": final,
            "status": "done",
            "round": rnd,
            "usage": usage_acc,
            "follow_up_queue": [],
            "needs_compaction": False,
            "needs_continue": False,
        }


def _raw_usage(data: dict[str, Any]) -> dict[str, Any] | None:
    u = data.get("usage")
    return u if isinstance(u, dict) else None
