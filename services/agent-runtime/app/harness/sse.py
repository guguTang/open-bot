"""Map harness state updates to existing + fine-grained SSE event shapes."""

from __future__ import annotations

import json
from typing import Any


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def tokens_from_text(text: str, chunk: int = 24) -> list[str]:
    t = text or ""
    if not t:
        return []
    return [t[i : i + chunk] for i in range(0, len(t), chunk)]


def message_start(message_id: str = "", role: str = "assistant") -> str:
    return sse("message_start", {"message_id": message_id, "role": role})


def message_update(text: str, *, message_id: str = "") -> str:
    return sse("message_update", {"message_id": message_id, "text": text})


def message_end(message_id: str = "", *, ok: bool = True) -> str:
    return sse("message_end", {"message_id": message_id, "ok": ok})


def tool_execution_start(name: str, tool_call_id: str = "") -> str:
    return sse(
        "tool_execution_start",
        {"tool": name, "tool_call_id": tool_call_id},
    )


def tool_execution_update(name: str, detail: str = "", tool_call_id: str = "") -> str:
    return sse(
        "tool_execution_update",
        {"tool": name, "tool_call_id": tool_call_id, "detail": detail},
    )


def tool_execution_end(name: str, tool_call_id: str = "", *, ok: bool = True) -> str:
    return sse(
        "tool_execution_end",
        {"tool": name, "tool_call_id": tool_call_id, "ok": ok},
    )


def compaction_event(phase: str, **extra: Any) -> str:
    return sse(f"compaction_{phase}", dict(extra))


def inbox_updated(payload: dict[str, Any]) -> str:
    return sse("inbox_updated", payload)
