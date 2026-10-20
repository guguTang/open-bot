"""Park/resume for model-path micro-app grant_required.

Hot path: in-process asyncio.Future keyed by grant-card req_id.
Durable source of truth: Postgres micro_app_parks via Go internal API
(`/internal/micro-apps/parks*`) so decide still completes cleanly after
API/runtime restart.

After restart the in-flight tool stack is gone — resolve returns
park_resolved=false with reason waiter_lost; client fallback continue
(sendUserText) runs only then. Same-stack resume after restart is not
supported (documented limitation).
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


def _persist_upsert(rec: ParkRecord, *, timeout_sec: float = DEFAULT_TIMEOUT_SEC, alias_of: str = "") -> None:
    """Best-effort durable park upsert (source of truth across restarts)."""
    try:
        from . import openbot_api as obapi

        payload: dict[str, Any] = {
            "req_id": rec.req_id,
            "user_id": rec.user_id,
            "micro_app_id": rec.micro_app_id,
            "conversation_id": rec.conversation_id,
            "request_id": rec.request_id,
            "tool": rec.tool,
            "capability": rec.capability,
            "args": rec.args,
            "timeout_sec": int(timeout_sec) if timeout_sec > 0 else int(DEFAULT_TIMEOUT_SEC),
        }
        if alias_of:
            payload["alias_of"] = alias_of
        obapi._post("/internal/micro-apps/parks", payload, timeout=8.0)
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "micro_app_park persist upsert failed req_id=%s err=%s",
            rec.req_id,
            e,
        )


def _persist_resolve(req_id: str, decision: str) -> dict[str, Any] | None:
    """Best-effort durable park resolve. Returns Go response or None."""
    try:
        from . import openbot_api as obapi

        out = obapi._post(
            "/internal/micro-apps/parks/resolve",
            {"req_id": req_id, "decision": decision},
            timeout=8.0,
        )
        return out if isinstance(out, dict) else None
    except Exception as e:  # noqa: BLE001
        logger.warning(
            "micro_app_park persist resolve failed req_id=%s err=%s",
            req_id,
            e,
        )
        return None


def _persist_expire() -> None:
    try:
        from . import openbot_api as obapi

        obapi._post("/internal/micro-apps/parks/expire", {}, timeout=8.0)
    except Exception:  # noqa: BLE001
        pass


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
    timeout_sec: float = DEFAULT_TIMEOUT_SEC,
    persist: bool = True,
) -> ParkRecord:
    """Register a park Future for req_id (idempotent if already pending)."""
    rid = (req_id or "").strip()
    if not rid:
        raise ValueError("req_id required")
    async with _lock:
        existing = _parks.get(rid)
        if existing is not None and not existing.future.done():
            if persist:
                _persist_upsert(existing, timeout_sec=timeout_sec)
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
    if persist:
        # Outside lock: HTTP must not hold the park lock.
        _persist_upsert(rec, timeout_sec=timeout_sec)
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
    """Unblock a parked tool call. Called from the grant-decide API path.

    Durable store is consulted when the in-process waiter is gone (restart):
    park_resolved=false, reason=waiter_lost|expired|not_parked — client may
    fallback-continue; grant upsert still applies.
    """
    rid = (req_id or "").strip()
    dec = (decision or "").strip() or "deny"
    async with _lock:
        rec = _parks.get(rid)
        if rec is not None:
            if rec.future.done():
                hot = {
                    "ok": True,
                    "park_resolved": True,
                    "reason": "already_resolved",
                    "req_id": rid,
                    "decision": str(rec.future.result()),
                    "tool": rec.tool,
                    "micro_app_id": rec.micro_app_id,
                    "conversation_id": rec.conversation_id,
                    "request_id": rec.request_id,
                }
            else:
                rec.future.set_result(dec)
                logger.info(
                    "micro_app_park resolve req_id=%s decision=%s tool=%s",
                    rid,
                    dec,
                    rec.tool,
                )
                hot = {
                    "ok": True,
                    "park_resolved": True,
                    "reason": "resolved",
                    "req_id": rid,
                    "decision": dec,
                    "tool": rec.tool,
                    "micro_app_id": rec.micro_app_id,
                    "conversation_id": rec.conversation_id,
                    "request_id": rec.request_id,
                }
        else:
            hot = None

    # Always sync durable row (decide path may have already resolved it).
    durable = _persist_resolve(rid, dec)

    if hot is not None:
        return hot

    # No in-process waiter — restart or never parked in this process.
    if durable and durable.get("park_found"):
        dreason = str(durable.get("reason") or "")
        # Same-stack resume is impossible without the Future; treat as safe fail.
        if dreason == "expired":
            reason = "expired"
        else:
            reason = "waiter_lost"
        logger.info(
            "micro_app_park resolve durable-only req_id=%s reason=%s decision=%s",
            rid,
            reason,
            dec,
        )
        park = durable.get("park") if isinstance(durable.get("park"), dict) else {}
        return {
            "ok": True,
            "park_resolved": False,
            "reason": reason,
            "req_id": rid,
            "decision": dec,
            "tool": str(park.get("tool") or ""),
            "micro_app_id": str(park.get("micro_app_id") or ""),
            "conversation_id": str(park.get("conversation_id") or ""),
            "request_id": str(park.get("request_id") or ""),
            "durable": True,
        }

    return {
        "ok": True,
        "park_resolved": False,
        "reason": "not_parked",
        "req_id": rid,
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
    persist_rec: ParkRecord | None = None
    async with _lock:
        crec = _parks.get(canon)
        if crec is None:
            return False
        arec = _parks.get(alias)
        if arec is None:
            arec = ParkRecord(
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
            _parks[alias] = arec
        elif not arec.future.done() and arec.future is not crec.future:
            try:
                arec.future.cancel()
            except Exception:  # noqa: BLE001
                pass
            arec.future = crec.future
            _parks[alias] = arec
        persist_rec = _parks[alias]
    # Persist alias key so decide(card req_id) finds durable row after restart.
    if persist_rec is not None:
        _persist_upsert(persist_rec)
    return True


def clear_all() -> None:
    """Test helper."""
    for rec in list(_parks.values()):
        if not rec.future.done():
            rec.future.cancel()
    _parks.clear()


def rehydrate_on_startup() -> None:
    """On runtime start: expire stale durable parks; hot Futures are empty.

    Cannot restore in-flight tool stacks. Decide after restart uses durable
    resolve → waiter_lost + client fallback continue.
    """
    _persist_expire()
    logger.info("micro_app_park rehydrate_on_startup: hot cache empty; expired stale durable parks")
