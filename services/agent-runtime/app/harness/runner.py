"""Drive the durable graph and yield OpenBot SSE frames (commit-before-show)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, AsyncIterator

from langgraph.types import Command

try:
    from langgraph.errors import GraphInterrupt
except ImportError:  # pragma: no cover
    GraphInterrupt = Exception  # type: ignore[misc, assignment]

from .. import langfuse_trace as lf
from ..tool_dispatch import dispatch_bound_tool
from .config import thread_id_for
from .frames import (
    failed_done_frames,
    idempotent_done_frames,
    success_done_frames,
    waiting_approval_frames,
)
from .graph import get_compiled_graph
from .journal import JournalSession
from .sse import (
    compaction_event,
    inbox_updated,
    message_end,
    message_start,
    sse,
    tokens_from_text,
    tool_execution_end,
    tool_execution_start,
)
from .state import initial_state
from . import tracing

logger = logging.getLogger("open-bot.harness.runner")


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
    max_tool_rounds: int = 24,
    configurable_extra: dict[str, Any] | None = None,
    resume_command: Command | None = None,
) -> AsyncIterator[str]:
    """Execute or resume a durable run; yields SSE after journal commit."""
    rid = (run_id or request_id or str(uuid.uuid4())).strip()
    conversation_id = str(getattr(body, "conversation_id", "") or "")
    tid = thread_id_for(
        conversation_id=conversation_id,
        request_id=request_id or rid,
        run_id=rid,
    )
    extra = dict(configurable_extra or {})
    journal = JournalSession(
        thread_id=tid,
        conversation_id=conversation_id,
        user_id=str(extra.get("user_id") or getattr(body, "user_id", "") or ""),
        agent_id=str(extra.get("agent_id") or getattr(body, "agent_id", "") or ""),
        request_id=rid,
        langfuse_trace_id=langfuse_trace_id,
        owner_thread_id=str(extra.get("owner_thread_id") or ""),
        background=bool(extra.get("background") or False),
    )
    await journal.set_status("running")

    graph = await get_compiled_graph()
    config: dict[str, Any] = {
        "configurable": {
            "thread_id": tid,
            "api_key": api_key,
            "override": override,
            "tool_handler": dispatch_bound_tool,
            "run_id": rid,
            "langfuse_trace_id": langfuse_trace_id,
            "journal": journal,
            **extra,
        }
    }
    tracing.attach_run_metadata(
        root_obs, run_id=rid, thread_id=tid, trace_id=langfuse_trace_id
    )

    snap = await graph.aget_state(config)
    values = getattr(snap, "values", None) or {}
    if values.get("status") == "done":
        meta = dict(values.get("meta") or {})
        meta.setdefault("run_id", rid)
        meta.update({"thread_id": tid, "resumed": True, "durable": True})
        for frame in idempotent_done_frames(
            meta=meta, final=str(values.get("final_text") or ""), rid=rid, tid=tid
        ):
            yield frame
        return

    if resume_command is None and getattr(snap, "tasks", None):
        tracing.mark_interrupt(root_obs, "waiting_approval")
        await journal.set_status("waiting_approval")
        meta = dict(values.get("meta") or {})
        meta.update(
            {"run_id": rid, "thread_id": tid, "durable": True, "waiting_approval": True}
        )
        for frame in waiting_approval_frames(meta=meta, rid=rid, tid=tid):
            yield frame
        return

    status_q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    event_q: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()

    async def on_status(payload: dict[str, Any]) -> None:
        await status_q.put(payload)

    async def on_event(name: str, payload: dict[str, Any]) -> None:
        await event_q.put((name, payload))

    config["configurable"]["on_status"] = on_status
    config["configurable"]["on_event"] = on_event
    config["configurable"]["body"] = body
    config["configurable"]["root_obs"] = root_obs

    if resume_command is not None:
        inp: Any = resume_command
        tracing.mark_resumed(root_obs)
    elif values.get("prepared") or values.get("skip_recall"):
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
    message_started = False

    async def _drain_side() -> AsyncIterator[str]:
        while not status_q.empty():
            yield sse("status", status_q.get_nowait())
        while not event_q.empty():
            name, payload = event_q.get_nowait()
            if name == "tool_execution_start":
                yield tool_execution_start(
                    str(payload.get("tool") or ""),
                    str(payload.get("tool_call_id") or ""),
                )
            elif name == "tool_execution_end":
                yield tool_execution_end(
                    str(payload.get("tool") or ""),
                    str(payload.get("tool_call_id") or ""),
                    ok=bool(payload.get("ok", True)),
                )
            elif name == "compaction_start":
                yield compaction_event("start", **payload)
            elif name == "message_end":
                yield message_end(ok=True)
            elif name == "inbox_updated":
                yield inbox_updated(payload)
            else:
                yield sse(name, payload)

    try:
        async for update in graph.astream(inp, config, stream_mode="updates"):
            async for frame in _drain_side():
                yield frame
            if not isinstance(update, dict):
                continue
            for node_name, patch in update.items():
                if not isinstance(patch, dict):
                    continue
                if node_name == "compact":
                    yield compaction_event("end", compacted=True)
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
                    if not message_started and final_text:
                        yield message_start()
                        message_started = True
                if patch.get("status") == "interrupted":
                    tracing.mark_interrupt(
                        root_obs, str(patch.get("interrupted_reason") or "")
                    )
                    await journal.set_status("interrupted")

        async for frame in _drain_side():
            yield frame

        snap = await graph.aget_state(config)
        values = getattr(snap, "values", None) or {}
        if getattr(snap, "tasks", None):
            tracing.mark_interrupt(root_obs, "waiting_approval")
            await journal.set_status("waiting_approval")
            meta = None
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
            for frame in waiting_approval_frames(meta=meta, rid=rid, tid=tid):
                yield frame
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
        if final_text and not message_started:
            yield message_start()
        for part in tokens_from_text(final_text):
            yield sse("token", {"text": part})
            yield sse("message_update", {"text": part})
        if final_text:
            yield message_end(ok=True)
        if root_obs is not None:
            lf.update_obs(root_obs, output=lf.truncate(final_text))
        await journal.set_status("done")
        for frame in success_done_frames(rid=rid, tid=tid):
            yield frame
    except GraphInterrupt as gi:
        tracing.mark_interrupt(root_obs, "graph_interrupt")
        await journal.set_status("waiting_approval")
        meta = None
        if not meta_sent:
            meta = {
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
                "waiting_approval": True,
            }
        for frame in waiting_approval_frames(
            meta=meta, rid=rid, tid=tid, detail=str(gi)
        ):
            yield frame
    except Exception as exc:  # noqa: BLE001
        logger.exception("durable run failed thread=%s", tid)
        await journal.set_status("failed")
        if root_obs is not None:
            lf.update_obs(root_obs, level="ERROR", status_message=str(exc)[:500])
        for frame in failed_done_frames(rid=rid, tid=tid, error=str(exc)):
            yield frame
