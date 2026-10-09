"""Drive the durable graph and yield OpenBot SSE frames."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, AsyncIterator, Awaitable, Callable

from langgraph.types import Command

try:
    from langgraph.errors import GraphInterrupt
except ImportError:  # pragma: no cover
    GraphInterrupt = Exception  # type: ignore[misc, assignment]

from .. import langfuse_trace as lf
from ..tool_dispatch import dispatch_bound_tool
from .config import thread_id_for
from .graph import get_compiled_graph
from .sse import sse, tokens_from_text
from .state import initial_state
from . import tracing

logger = logging.getLogger("open-bot.harness.runner")

StatusCb = Callable[[dict[str, Any]], Awaitable[None]]


async def run_durable_events(
    *,
    body: Any,
    history: list[dict[str, Any]],
    api_key: str,
    override: Any,
    run_id: str | None = None,
    request_id: str | None = None,
    langfuse_trace_id: str = "",
    root_obs: Any = None,
    max_tool_rounds: int = 12,
    configurable_extra: dict[str, Any] | None = None,
    resume_command: Command | None = None,
) -> AsyncIterator[str]:
    """Execute or resume a durable run; yields SSE strings."""
    rid = (run_id or request_id or str(uuid.uuid4())).strip()
    tid = thread_id_for(
        conversation_id=str(getattr(body, "conversation_id", "") or ""),
        request_id=request_id or rid,
        run_id=rid,
    )
    graph = await get_compiled_graph()
    config: dict[str, Any] = {
        "configurable": {
            "thread_id": tid,
            "api_key": api_key,
            "override": override,
            "tool_handler": dispatch_bound_tool,
            "run_id": rid,
            "langfuse_trace_id": langfuse_trace_id,
            **(configurable_extra or {}),
        }
    }

    tracing.attach_run_metadata(
        root_obs, run_id=rid, thread_id=tid, trace_id=langfuse_trace_id
    )

    # Idempotent: completed thread returns stored answer.
    snap = await graph.aget_state(config)
    values = getattr(snap, "values", None) or {}
    if values.get("status") == "done":
        meta = dict(values.get("meta") or {})
        meta.setdefault("run_id", rid)
        meta["thread_id"] = tid
        meta["resumed"] = True
        meta["durable"] = True
        yield sse("meta", meta)
        final = str(values.get("final_text") or "")
        for part in tokens_from_text(final):
            yield sse("token", {"text": part})
        yield sse(
            "done",
            {
                "ok": True,
                "mode": "openai",
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
                "idempotent": True,
            },
        )
        return

    # Waiting on human approval — do not auto-continue without Command(resume=...).
    if resume_command is None and getattr(snap, "tasks", None):
        tracing.mark_interrupt(root_obs, "waiting_approval")
        meta = dict(values.get("meta") or {})
        meta.update(
            {
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
                "waiting_approval": True,
            }
        )
        yield sse("meta", meta)
        yield sse(
            "status",
            {
                "phase": "waiting_approval",
                "label": "等待确认后继续",
                "thread_id": tid,
            },
        )
        yield sse(
            "done",
            {
                "ok": False,
                "mode": "openai",
                "waiting_approval": True,
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
            },
        )
        return

    status_q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def on_status(payload: dict[str, Any]) -> None:
        await status_q.put(payload)

    config["configurable"]["on_status"] = on_status
    config["configurable"]["body"] = body
    config["configurable"]["root_obs"] = root_obs

    if resume_command is not None:
        inp: Any = resume_command
        tracing.mark_resumed(root_obs)
    elif values.get("prepared") or values.get("skip_recall"):
        # Crash mid-run: continue from last checkpoint.
        inp = None
    else:
        inp = initial_state(
            messages=list(history),
            max_rounds=max_tool_rounds,
            langfuse_trace_id=langfuse_trace_id,
            skip_recall=False,
        )

    meta_sent = False
    final_text = ""
    try:
        stream = graph.astream(inp, config, stream_mode="updates")

        async for update in stream:
            while not status_q.empty():
                payload = status_q.get_nowait()
                yield sse("status", payload)
            if not isinstance(update, dict):
                continue
            for _node, patch in update.items():
                if not isinstance(patch, dict):
                    continue
                if not meta_sent and patch.get("meta"):
                    meta = dict(patch["meta"])
                    meta["thread_id"] = tid
                    meta["durable"] = True
                    if api_key:
                        meta.setdefault("mode", "openai")
                    yield sse("meta", meta)
                    meta_sent = True
                if patch.get("final_text"):
                    final_text = str(patch["final_text"])
                if patch.get("status") == "interrupted":
                    tracing.mark_interrupt(
                        root_obs, str(patch.get("interrupted_reason") or "")
                    )
        while not status_q.empty():
            yield sse("status", status_q.get_nowait())

        # Final state
        snap = await graph.aget_state(config)
        values = getattr(snap, "values", None) or {}
        if getattr(snap, "tasks", None):
            tracing.mark_interrupt(root_obs, "waiting_approval")
            if not meta_sent:
                meta = dict(values.get("meta") or {})
                meta.update(
                    {
                        "run_id": rid,
                        "thread_id": tid,
                        "durable": True,
                        "waiting_approval": True,
                    }
                )
                yield sse("meta", meta)
            yield sse(
                "status",
                {
                    "phase": "waiting_approval",
                    "label": "等待确认后继续",
                    "thread_id": tid,
                },
            )
            yield sse(
                "done",
                {
                    "ok": False,
                    "waiting_approval": True,
                    "run_id": rid,
                    "thread_id": tid,
                    "durable": True,
                },
            )
            return

        final_text = str(values.get("final_text") or final_text or "")
        used = list(values.get("tools_used") or [])
        if used:
            yield sse("meta", {"tools_used": used})
        if not meta_sent and values.get("meta"):
            meta = dict(values["meta"])
            meta["thread_id"] = tid
            meta["durable"] = True
            yield sse("meta", meta)
        for part in tokens_from_text(final_text):
            yield sse("token", {"text": part})
        if root_obs is not None:
            lf.update_obs(root_obs, output=lf.truncate(final_text))
        yield sse(
            "done",
            {
                "ok": True,
                "mode": "openai",
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
            },
        )
    except GraphInterrupt as gi:
        tracing.mark_interrupt(root_obs, "graph_interrupt")
        if not meta_sent:
            yield sse(
                "meta",
                {
                    "run_id": rid,
                    "thread_id": tid,
                    "durable": True,
                    "waiting_approval": True,
                },
            )
        yield sse(
            "status",
            {
                "phase": "waiting_approval",
                "label": "等待确认后继续",
                "thread_id": tid,
                "detail": str(gi)[:300],
            },
        )
        yield sse(
            "done",
            {
                "ok": False,
                "waiting_approval": True,
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("durable run failed thread=%s", tid)
        if root_obs is not None:
            lf.update_obs(root_obs, level="ERROR", status_message=str(exc)[:500])
        err_msg = str(exc)[:500] or "runtime run failed"
        # Dedicated error event: proxyRuntimeRun forwards it, and Go persists a bubble.
        # done.ok=false alone used to be swallowed → silent empty / group PASS.
        yield sse("error", {"message": err_msg})
        yield sse(
            "done",
            {
                "ok": False,
                "error": err_msg,
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
            },
        )
