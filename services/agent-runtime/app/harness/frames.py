"""Reusable SSE frame sequences for durable runner terminal states."""

from __future__ import annotations

from typing import Any, Iterator

from .sse import sse, tokens_from_text


def idempotent_done_frames(
    *, meta: dict[str, Any], final: str, rid: str, tid: str
) -> Iterator[str]:
    yield sse("meta", meta)
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


def waiting_approval_frames(
    *,
    meta: dict[str, Any] | None,
    rid: str,
    tid: str,
    detail: str = "",
) -> Iterator[str]:
    if meta is not None:
        yield sse("meta", meta)
    status: dict[str, Any] = {
        "phase": "waiting_approval",
        "label": "等待确认后继续",
        "thread_id": tid,
    }
    if detail:
        status["detail"] = detail[:300]
    yield sse("status", status)
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


def success_done_frames(*, rid: str, tid: str) -> Iterator[str]:
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


def failed_done_frames(*, rid: str, tid: str, error: str) -> Iterator[str]:
    # Emit a dedicated error event so Go/proxy + web client can show a bubble.
    # done.ok=false alone is swallowed by proxyRuntimeRun (per-agent done).
    msg = (error or "runtime run failed")[:500]
    yield sse("error", {"message": msg})
    yield sse(
        "done",
        {
            "ok": False,
            "error": msg,
            "run_id": rid,
            "thread_id": tid,
            "durable": True,
        },
    )
