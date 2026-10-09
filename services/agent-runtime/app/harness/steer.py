"""Steer / abort / approve / inbox against a durable thread."""

from __future__ import annotations

from typing import Any

from langgraph.types import Command

from .graph import get_compiled_graph
from .inbox import submit_when_busy, thread_is_busy
from .journal import JournalSession, get_journal
from . import tracing
from .child import abort_owned_children


async def steer_thread(
    thread_id: str,
    *,
    text: str,
    mode: str = "follow_up",
    conversation_id: str = "",
    user_id: str = "",
    agent_id: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    """Queue steer/follow-up/reject onto a busy thread (whenBusy semantics)."""
    t = (text or "").strip()
    if not t:
        return {"ok": False, "error": "empty_text"}
    m = (mode or "follow_up").strip().lower()
    if m in ("follow_up", "steer", "reject"):
        busy = await thread_is_busy(thread_id)
        if busy or m == "reject":
            return await submit_when_busy(
                thread_id,
                text=t,
                when_busy=m,  # type: ignore[arg-type]
                conversation_id=conversation_id,
                user_id=user_id,
                agent_id=agent_id,
                request_id=request_id,
            )
    # Not busy: still park on queue for next prepare/llm.
    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    field = "steer_queue" if m == "steer" else "follow_up_queue"
    await graph.aupdate_state(config, {field: [t]})
    return {"ok": True, "thread_id": thread_id, "mode": m}


async def abort_thread(thread_id: str) -> dict[str, Any]:
    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    await graph.aupdate_state(
        config,
        {
            "status": "aborted",
            "pending_tool_calls": [],
            "interrupted_reason": "aborted",
        },
    )
    journal = JournalSession(thread_id=thread_id, client=get_journal())
    await journal.set_status("aborted")
    await abort_owned_children(thread_id, include_background=False)
    return {"ok": True, "thread_id": thread_id, "status": "aborted"}


async def approve_thread(
    thread_id: str,
    *,
    approve: bool = True,
    reason: str = "",
    root_obs: Any | None = None,
) -> dict[str, Any]:
    """Resume an interrupt with an approval decision."""
    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    payload = {"approve": bool(approve), "reason": reason or ""}
    journal = JournalSession(thread_id=thread_id, client=get_journal())
    if approve:
        tracing.mark_resumed(root_obs)
        await journal.set_status("running")
    else:
        await journal.append(
            "approval_rejected",
            {"reason": reason or "user_rejected"},
            project=False,
        )
    result = await graph.ainvoke(Command(resume=payload), config)
    status = str((result or {}).get("status") or "")
    if status:
        await journal.set_status(status)
    return {
        "ok": True,
        "thread_id": thread_id,
        "status": status,
        "final_text": str((result or {}).get("final_text") or ""),
    }


async def get_thread_state(thread_id: str) -> dict[str, Any]:
    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    snap = await graph.aget_state(config)
    values = getattr(snap, "values", None) or {}
    tasks = getattr(snap, "tasks", None) or ()
    interrupted = bool(tasks)
    return {
        "thread_id": thread_id,
        "status": values.get("status"),
        "interrupted": interrupted,
        "waiting_approval": interrupted,
        "next": list(getattr(snap, "next", None) or []),
        "final_text": values.get("final_text") or "",
        "langfuse_trace_id": values.get("langfuse_trace_id") or "",
        "run_id": (values.get("meta") or {}).get("run_id") or "",
    }
