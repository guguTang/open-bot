"""In-process durable runs. A checkpoint with status=running is not enough:
the executor may have died between nodes (reload, kill). Callers use this set
to tell a live graph apart from that stale pause.
"""

from __future__ import annotations

_live: set[str] = set()


def mark_live(thread_id: str) -> None:
    tid = (thread_id or "").strip()
    if tid:
        _live.add(tid)


def release_live(thread_id: str) -> None:
    _live.discard((thread_id or "").strip())


def is_live(thread_id: str) -> bool:
    return (thread_id or "").strip() in _live
