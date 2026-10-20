"""Session-scoped recent micro_app touches for modify-path hints.

In-memory cache keyed by conversation_id. Updated on successful
draft_micro_app / pin_micro_app / upload_micro_app_bundle / get_micro_app_runtime /
update_micro_app.
Injected into the dynamic system prompt so modify flows prefer the same id.
Does not replace list_micro_apps.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

TOUCH_TOOLS = frozenset(
    {
        "draft_micro_app",
        "pin_micro_app",
        "upload_micro_app_bundle",
        "get_micro_app_runtime",
        "update_micro_app",
    }
)

_MAX_PER_CONV = 5

_lock = threading.Lock()
# conversation_id -> {micro_app_id -> RecentTouch} (insertion/MRU via re-insert)
_recent: dict[str, dict[str, "RecentTouch"]] = {}


@dataclass
class RecentTouch:
    id: str
    title: str = ""
    status: str = ""
    touched_at: float = field(default_factory=time.time)


def clear_all() -> None:
    """Test helper: drop the whole cache."""
    with _lock:
        _recent.clear()


def clear_conversation(conversation_id: str) -> None:
    cid = str(conversation_id or "").strip()
    if not cid:
        return
    with _lock:
        _recent.pop(cid, None)


def _extract_fields(
    result: Any,
    args: dict[str, Any] | None = None,
) -> tuple[str, str, str]:
    """Pull id / title / status from tool result (and optional args fallback)."""
    args = dict(args or {})
    app: dict[str, Any] = {}
    if isinstance(result, dict):
        nested = result.get("micro_app")
        if isinstance(nested, dict):
            app = nested
        else:
            app = result
    app_id = str(
        app.get("id")
        or app.get("micro_app_id")
        or args.get("id")
        or args.get("micro_app_id")
        or ""
    ).strip()
    title = str(app.get("title") or args.get("title") or "").strip()
    status = str(app.get("status") or "").strip()
    # upload often nests micro_app; if status still empty keep prior via merge
    return app_id, title, status


def record_touch(
    conversation_id: str,
    tool_name: str,
    result: Any,
    *,
    args: dict[str, Any] | None = None,
) -> RecentTouch | None:
    """Record a successful touch. No-op on empty conversation / errors / unknown tools."""
    cid = str(conversation_id or "").strip()
    name = str(tool_name or "").strip()
    if not cid or name not in TOUCH_TOOLS:
        return None
    if isinstance(result, dict) and result.get("error"):
        return None

    app_id, title, status = _extract_fields(result, args)
    if not app_id:
        return None

    now = time.time()
    with _lock:
        bucket = _recent.setdefault(cid, {})
        prev = bucket.get(app_id)
        if prev is not None:
            if not title:
                title = prev.title
            if not status:
                status = prev.status
            # re-insert for MRU order (Python 3.7+ dict preserves insertion)
            del bucket[app_id]
        touch = RecentTouch(id=app_id, title=title, status=status, touched_at=now)
        bucket[app_id] = touch
        while len(bucket) > _MAX_PER_CONV:
            oldest_key = next(iter(bucket))
            del bucket[oldest_key]
        return touch


def list_recent(conversation_id: str) -> list[RecentTouch]:
    """MRU-last list of recent touches for a conversation."""
    cid = str(conversation_id or "").strip()
    if not cid:
        return []
    with _lock:
        bucket = _recent.get(cid) or {}
        return list(bucket.values())


def format_recent_hint(conversation_id: str) -> str:
    """Short bilingual hint block, or empty if nothing recorded."""
    touches = list_recent(conversation_id)
    if not touches:
        return ""
    # Most recent last in dict order → show MRU first in the hint
    ordered = list(reversed(touches))
    parts: list[str] = []
    for t in ordered:
        bits = [f"id={t.id}"]
        if t.title:
            bits.append(f"title={t.title}")
        if t.status:
            bits.append(f"status={t.status}")
        parts.append(" ".join(bits))
    joined = "；".join(parts)
    return (
        f"本会话近期微应用: {joined}；"
        "修改请先 get_micro_app_runtime 读 files，再用同 id 调 upload_micro_app_bundle / "
        "update_micro_app，禁止再 draft_micro_app；勿向用户索要源码。"
        "仍可用 list_micro_apps 发现其它 id。"
        f" Recent in this session: {joined}. "
        "For edits: get_micro_app_runtime then upload/update same id; do not draft again; "
        "do not ask the user for source. Keep using list_micro_apps when needed."
    )


def apply_recent_micro_app_hint(
    system: str,
    dynamic_system: str,
    conversation_id: str,
) -> tuple[str, str]:
    """Append session recent-micro-app hint to system + dynamic (no-op if empty)."""
    hint = format_recent_hint(conversation_id)
    if not hint:
        return system, dynamic_system
    system_out = (f"{system}\n\n{hint}").strip() if (system or "").strip() else hint
    dynamic_out = (
        (f"{dynamic_system}\n\n{hint}").strip() if (dynamic_system or "").strip() else hint
    )
    return system_out, dynamic_out
