"""In-process park/resume for model-path micro-app grant_required.

When Gate B returns grant_required, the tool handler awaits a Future keyed by
park req_id (same id as the micro_app_grant chat card). After the user allows
(UpsertGrant) or denies, Go calls POST /v1/micro-app-grants/resolve which
resolves the Future so the **same** tool call continues or fails cleanly.

This mirrors Go host_confirm parking and iframe MicroAppGrantDialog — not a
LangGraph interrupt()/Command(resume) path (approve_thread has no rebound
tool_handler, so interrupt resume cannot execute host_* today).

Process restart drops parks; decide still UpsertsGrant and returns
park_resolved=false for a documented client fallback.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("openbot.micro_app_park")

# Default wait: user may take a while on the grant card.
DEFAULT_TIMEOUT_SEC = 900.0


@dataclass
class ParkRecord:
    req_id: str
    micro_app_id: str
    tool: str
    capability: str
    conversation_id: str = ""
    request_id: str = ""
    user_id: str = ""
    args: dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    future: asyncio.Future[str] = field(default=None)  # type: ignore[assignment]


_parks: dict[str, ParkRecord] = {}
_lock = asyncio.Lock()


def _loop_future() -> asyncio.Future[str]:
    loop = asyncio.get_running_loop()
    return loop.create_future()


async def create_park(
    *,
    req_id: str,
    micro_app_id: str,
    tool: str,
    capability: str,
    conversation_id: str = "",
    request_id: str = "",
    user_id: str = "",
    args: dict[str, Any] | None = None,
) -> ParkRecord:
    """Register a park Future for req_id (idempotent if already pending)."""
    rid = (req_id or "").strip()
    if not rid:
        raise ValueError("req_id required")
    async with _lock:
        existing = _parks.get(rid)
        if existing is not None and not existing.future.done():
            return existing
        fut = _loop_future()
        rec = ParkRecord(
            req_id=rid,
            micro_app_id=(micro_app_id or "").strip(),
            tool=(tool or "").strip(),
            capability=(capability or "").strip(),
            conversation_id=(conversation_id or "").strip(),
            request_id=(request_id or "").strip(),
            user_id=(user_id or "").strip(),
            args=dict(args or {}),
            future=fut,
        )
        _parks[rid] = rec
        logger.info(
            "micro_app_park create req_id=%s tool=%s micro_app_id=%s",
            rid,
            rec.tool,
            rec.micro_app_id,
        )
        return rec


async def await_decision(
    req_id: str,
    *,
    timeout_sec: float = DEFAULT_TIMEOUT_SEC,
) -> str:
    """Block until resolve() or timeout.

    Returns decision string: allow_once | always_allow | deny | timeout.
    """
    rid = (req_id or "").strip()
    async with _lock:
        rec = _parks.get(rid)
    if rec is None:
        logger.warning("micro_app_park await missing req_id=%s", rid)
        return "timeout"
    try:
        decision = await asyncio.wait_for(asyncio.shield(rec.future), timeout=timeout_sec)
        return str(decision or "deny").strip() or "deny"
    except asyncio.TimeoutError:
        logger.warning("micro_app_park timeout req_id=%s", rid)
        await resolve(rid, "timeout")
        return "timeout"
    finally:
        async with _lock:
            cur = _parks.get(rid)
            if cur is not None and cur.future.done():
                _parks.pop(rid, None)


async def resolve(req_id: str, decision: str) -> dict[str, Any]:
    """Unblock a parked tool call. Called from the grant-decide API path."""
    rid = (req_id or "").strip()
    dec = (decision or "").strip() or "deny"
    async with _lock:
        rec = _parks.get(rid)
        if rec is None:
            return {
                "ok": True,
                "park_resolved": False,
                "reason": "not_parked",
                "req_id": rid,
            }
        if rec.future.done():
            return {
                "ok": True,
                "park_resolved": True,
                "reason": "already_resolved",
                "req_id": rid,
                "decision": str(rec.future.result()),
            }
        rec.future.set_result(dec)
        logger.info(
            "micro_app_park resolve req_id=%s decision=%s tool=%s",
            rid,
            dec,
            rec.tool,
        )
        return {
            "ok": True,
            "park_resolved": True,
            "req_id": rid,
            "decision": dec,
            "tool": rec.tool,
            "micro_app_id": rec.micro_app_id,
            "conversation_id": rec.conversation_id,
            "request_id": rec.request_id,
        }


def peek(req_id: str) -> dict[str, Any] | None:
    rid = (req_id or "").strip()
    rec = _parks.get(rid)
    if rec is None:
        return None
    return {
        "req_id": rec.req_id,
        "micro_app_id": rec.micro_app_id,
        "tool": rec.tool,
        "capability": rec.capability,
        "conversation_id": rec.conversation_id,
        "request_id": rec.request_id,
        "pending": not rec.future.done(),
        "age_sec": round(time.time() - rec.created_at, 1),
    }



async def alias_to(alias_req_id: str, canonical_req_id: str) -> bool:
    """Make alias_req_id wait on the same Future as canonical_req_id."""
    alias = (alias_req_id or "").strip()
    canon = (canonical_req_id or "").strip()
    if not alias or not canon or alias == canon:
        return False
    async with _lock:
        crec = _parks.get(canon)
        if crec is None:
            return False
        arec = _parks.get(alias)
        if arec is None:
            _parks[alias] = ParkRecord(
                req_id=alias,
                micro_app_id=crec.micro_app_id,
                tool=crec.tool,
                capability=crec.capability,
                conversation_id=crec.conversation_id,
                request_id=crec.request_id,
                user_id=crec.user_id,
                args=dict(crec.args),
                future=crec.future,
            )
            return True
        if not arec.future.done() and arec.future is not crec.future:
            # Prefer canonical; abandon alias future if unused.
            if not arec.future.done():
                try:
                    arec.future.cancel()
                except Exception:  # noqa: BLE001
                    pass
            arec.future = crec.future
            _parks[alias] = arec
        return True

def clear_all() -> None:
    """Test helper."""
    for rec in list(_parks.values()):
        if not rec.future.done():
            rec.future.cancel()
    _parks.clear()
