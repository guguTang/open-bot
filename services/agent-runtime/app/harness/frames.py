"""Reusable SSE frame sequences for durable runner terminal states."""

from __future__ import annotations

from typing import Any, Iterator

from .sse import sse, tokens_from_text


def usage_for_done(usage: Any) -> dict[str, int] | None:
    """Canonical token counts for the done SSE, or None when unknown.

    The API records usage_runs only from this object. Omit it when the
    model gateway did not report tokens; do not invent zeros.
    """
    if not isinstance(usage, dict):
        return None
    out: dict[str, int] = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        val = usage.get(key)
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            continue
        out[key] = int(val)
    if "total_tokens" not in out and (
        "prompt_tokens" in out or "completion_tokens" in out
    ):
        out["total_tokens"] = out.get("prompt_tokens", 0) + out.get("completion_tokens", 0)
    return out or None


def _with_usage(payload: dict[str, Any], usage: Any) -> dict[str, Any]:
    attached = usage_for_done(usage)
    if attached:
        payload["usage"] = attached
    return payload


def idempotent_done_frames(
    *,
    meta: dict[str, Any],
    final: str,
    rid: str,
    tid: str,
    usage: dict[str, Any] | None = None,
) -> Iterator[str]:
    yield sse("meta", meta)
    for part in tokens_from_text(final):
        yield sse("token", {"text": part})
    yield sse(
        "done",
        _with_usage(
            {
                "ok": True,
                "mode": "openai",
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
                "idempotent": True,
            },
            usage,
        ),
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


def success_done_frames(
    *, rid: str, tid: str, usage: dict[str, Any] | None = None
) -> Iterator[str]:
    yield sse(
        "done",
        _with_usage(
            {
                "ok": True,
                "mode": "openai",
                "run_id": rid,
                "thread_id": tid,
                "durable": True,
            },
            usage,
        ),
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
