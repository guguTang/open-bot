"""Deep inbox: whenBusy follow_up / steer / reject (pi-durable aligned)."""

from __future__ import annotations

from typing import Any, Literal

from .graph import get_compiled_graph
from .journal import JournalSession, get_journal

WhenBusy = Literal["follow_up", "steer", "reject"]


async def thread_is_busy(thread_id: str) -> bool:
    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    snap = await graph.aget_state(config)
    values = getattr(snap, "values", None) or {}
    status = str(values.get("status") or "")
    if status in ("running", "interrupted"):
        return True
    tasks = getattr(snap, "tasks", None) or ()
    return bool(tasks)


async def submit_when_busy(
    thread_id: str,
    *,
    text: str,
    when_busy: WhenBusy = "follow_up",
    conversation_id: str = "",
    user_id: str = "",
    agent_id: str = "",
    request_id: str = "",
) -> dict[str, Any]:
    """Place a message relative to a busy run.

    - reject: error if busy
    - steer: insert after current tool round (steer_queue)
    - follow_up: after run ends (follow_up_queue)
    """
    t = (text or "").strip()
    if not t:
        return {"ok": False, "error": "empty_text"}
    mode = (when_busy or "follow_up").strip().lower()
    if mode not in ("follow_up", "steer", "reject"):
        mode = "follow_up"

    busy = await thread_is_busy(thread_id)
    if not busy:
        return {"ok": False, "error": "not_busy", "thread_id": thread_id}

    if mode == "reject":
        return {
            "ok": False,
            "error": "busy_rejected",
            "thread_id": thread_id,
            "when_busy": "reject",
        }

    graph = await get_compiled_graph()
    config = {"configurable": {"thread_id": thread_id}}
    field = "steer_queue" if mode == "steer" else "follow_up_queue"
    await graph.aupdate_state(config, {field: [t]})

    journal = JournalSession(
        thread_id=thread_id,
        conversation_id=conversation_id,
        user_id=user_id,
        agent_id=agent_id,
        request_id=request_id,
        client=get_journal(),
    )
    item = {"text": t, "when_busy": mode, "placed": True}
    journal.enqueue_inbox(item)
    await journal.put_inbox()
    await journal.append("inbox", item, project=False)

    return {
        "ok": True,
        "thread_id": thread_id,
        "when_busy": mode,
        "queued": True,
    }
