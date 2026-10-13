"""Process-level resume worker: continue unfinished durable threads on startup."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .config import durable_enabled
from .graph import get_compiled_graph
from .journal.client import get_journal
from .pause import is_approval_pause

logger = logging.getLogger("open-bot.harness.worker")

_task: asyncio.Task | None = None
_stop = asyncio.Event()


async def _heal_journal_status(thread_id: str, status: str) -> None:
    """Best-effort journal status update so stuck rows leave list_resumable."""
    try:
        journal = get_journal()
        await asyncio.to_thread(
            journal.upsert_thread,
            {
                "thread_id": thread_id,
                "status": status,
                "conversation_id": "",
                "user_id": "",
                "org_id": "",
                "agent_id": "",
                "request_id": "",
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("resume heal journal failed thread=%s status=%s", thread_id, status)


async def resume_thread(thread_id: str) -> dict[str, Any]:
    """Inspect a resumable journal thread; never auto-ainvoke without work.

    LangGraph 1.2+: ``ainvoke(None)`` only continues a checkpoint that is already
    mid-graph (``CONFIG_KEY_RESUMING`` / pending next). Approval interrupts need
    ``Command(resume=...)`` via ``approve_thread``. A finished or empty checkpoint
    plus ``ainvoke(None)`` raises ``EmptyInputError: Received no input for
    __start__`` — which used to spam logs and leave journal status stuck in
    ``running``/``interrupted``, so the conversation stayed "busy" and the model
    could re-plan another ``gmail_send`` (extra confirm cards).
    """
    graph = await get_compiled_graph()
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    snap = await graph.aget_state(config)
    values = getattr(snap, "values", None) or {}
    status = str(values.get("status") or "")
    tasks = getattr(snap, "tasks", None) or ()
    next_nodes = list(getattr(snap, "next", None) or [])

    if status in ("done", "aborted", "failed"):
        return {"ok": True, "skipped": True, "reason": status, "thread_id": thread_id}
    if is_approval_pause(tasks):
        # Human gate — presence only, do not auto-run. Heal journal if still
        # listed as running/interrupted so list_resumable stops picking it up.
        logger.info("resume skip waiting_approval thread=%s", thread_id)
        await _heal_journal_status(thread_id, "waiting_approval")
        return {
            "ok": True,
            "skipped": True,
            "reason": "waiting_approval",
            "thread_id": thread_id,
        }
    if tasks or next_nodes:
        # Next node is scheduled, but this process has no model credentials or
        # tool handler. Auto-ainvoke would 401 and leave status=running, which
        # makes every later user message queue-and-close. The next /v1/runs
        # resumes the checkpoint.
        logger.info("resume skip paused thread=%s next-task-without-executor", thread_id)
        return {
            "ok": True,
            "skipped": True,
            "reason": "paused",
            "thread_id": thread_id,
        }

    # No pending tasks/next — nothing to continue. Do NOT ainvoke(None): that
    # raises EmptyInputError (no input for __start__). Heal stuck journal rows
    # so they drop out of list_resumable (running/interrupted).
    logger.info(
        "resume skip no_pending_work thread=%s values_status=%s",
        thread_id,
        status or "(empty)",
    )
    await _heal_journal_status(thread_id, "done")
    return {
        "ok": True,
        "skipped": True,
        "reason": "no_pending_work",
        "thread_id": thread_id,
        "healed_status": "done",
    }


async def scan_and_resume(*, limit: int = 50) -> list[dict[str, Any]]:
    if not durable_enabled():
        return []
    client = get_journal()
    ids = await asyncio.to_thread(client.list_resumable)
    out: list[dict[str, Any]] = []
    for tid in ids[:limit]:
        tid = str(tid or "").strip()
        if not tid:
            continue
        out.append(await resume_thread(tid))
    return out


async def _loop(interval_sec: float = 30.0) -> None:
    # Startup sweep immediately.
    try:
        results = await scan_and_resume()
        if results:
            logger.info("resume worker startup resumed=%s", len(results))
    except Exception:  # noqa: BLE001
        logger.exception("resume worker startup sweep failed")

    while not _stop.is_set():
        try:
            await asyncio.wait_for(_stop.wait(), timeout=interval_sec)
            break
        except asyncio.TimeoutError:
            pass
        try:
            await scan_and_resume()
        except Exception:  # noqa: BLE001
            logger.exception("resume worker periodic sweep failed")


def start_resume_worker(*, interval_sec: float = 30.0) -> asyncio.Task | None:
    """Start background resume loop (idempotent)."""
    global _task
    if not durable_enabled():
        return None
    if _task is not None and not _task.done():
        return _task
    _stop.clear()
    _task = asyncio.create_task(_loop(interval_sec), name="harness-resume-worker")
    return _task


async def stop_resume_worker() -> None:
    global _task
    _stop.set()
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=5.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            _task.cancel()
        _task = None
