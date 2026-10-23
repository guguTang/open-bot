"""Agent bus helper: post via Go API so priority wake + WS push run on the same path.

Prefers POST /internal/agent-bus/messages (X-Internal-Token). Falls back to direct
Postgres insert only when OPENBOT_API_URL is empty / unreachable is NOT used for
priority — we raise so callers see the failure. Direct PG remains as last-resort
when OPENBOT_BUS_PG_FALLBACK=1 (dev only).
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

from .memory import database_url

DEFAULT_DATABASE_URL = "postgres://openbot:openbot@127.0.0.1:5432/openbot?sslmode=disable"
DEFAULT_API_URL = "http://127.0.0.1:18080"
DEFAULT_INTERNAL_TOKEN = "open-bot-dev-internal"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _api_base() -> str:
    return (os.getenv("OPENBOT_API_URL") or os.getenv("API_BASE_URL") or DEFAULT_API_URL).rstrip(
        "/"
    )


def _internal_token() -> str:
    return (
        (os.getenv("INTERNAL_TOKEN") or os.getenv("OPENBOT_INTERNAL_TOKEN") or DEFAULT_INTERNAL_TOKEN)
        .strip()
        or DEFAULT_INTERNAL_TOKEN
    )


def _post_via_api(
    *,
    user_id: str,
    from_agent_id: str,
    body: str,
    to_agent_id: str | None,
    channel_id: str | None,
    priority: bool,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    url = f"{_api_base()}/internal/agent-bus/messages"
    payload = {
        "user_id": user_id,
        "from_agent_id": from_agent_id,
        "body": body,
        "priority": bool(priority),
    }
    if to_agent_id:
        payload["to_agent_id"] = to_agent_id
    if channel_id:
        payload["channel_id"] = channel_id
    if conversation_id:
        payload["conversation_id"] = conversation_id
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": _internal_token(),
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"agent-bus api HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"agent-bus api unreachable: {e}") from e


def _post_via_pg(
    *,
    user_id: str,
    from_agent_id: str,
    body: str,
    to_agent_id: str | None,
    channel_id: str | None,
    priority: bool,
) -> dict[str, Any]:
    try:
        import psycopg
    except ImportError as e:
        raise RuntimeError("psycopg not installed") from e

    url = database_url() or DEFAULT_DATABASE_URL
    msg_id = str(uuid.uuid4())
    now = _utcnow()
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_messages
                  (id, user_id, from_agent_id, to_agent_id, channel_id, priority, body, created_at, read_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL)
                """,
                (
                    msg_id,
                    user_id,
                    from_agent_id,
                    to_agent_id,
                    channel_id,
                    bool(priority),
                    body,
                    now,
                ),
            )
        conn.commit()
    return {
        "id": msg_id,
        "user_id": user_id,
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "channel_id": channel_id,
        "priority": bool(priority),
        "body": body,
        "created_at": now.isoformat(),
        "_via": "postgres_fallback",
    }



def project_handoff_note(
    *,
    user_id: str,
    from_bot: str,
    to_bot: str,
    purpose: str,
    status: str,
    agent_message_id: str,
    conversation_id: str | None = None,
    channel_id: str | None = None,
    thread_root_id: str | None = None,
    viewer_agent_id: str | None = None,
    skip_if_projected: bool = True,
) -> dict[str, Any]:
    """P1 projection: POST /internal/handoff-notes (idempotent on agent_message_id)."""
    user_id = (user_id or "").strip()
    agent_message_id = (agent_message_id or "").strip()
    to_bot = (to_bot or "").strip()
    from_bot = (from_bot or "").strip() or "open-bot"
    if not user_id or not agent_message_id or not to_bot:
        return {"skipped": True, "reason": "missing_required"}
    status = (status or "running").strip() or "running"
    purpose = (purpose or "").strip() or "协作交接"
    if len(purpose) > 120:
        purpose = purpose[:120] + "…"
    payload: dict[str, Any] = {
        "user_id": user_id,
        "from_bot": from_bot,
        "to_bot": to_bot,
        "purpose": purpose,
        "status": status,
        "agent_message_id": agent_message_id,
        "skip_if_projected": bool(skip_if_projected),
    }
    if conversation_id:
        payload["conversation_id"] = conversation_id.strip()
    if channel_id:
        payload["channel_id"] = channel_id.strip()
    if thread_root_id:
        payload["thread_root_id"] = thread_root_id.strip()
    if viewer_agent_id:
        payload["viewer_agent_id"] = viewer_agent_id.strip()
    url = f"{_api_base()}/internal/handoff-notes"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": _internal_token(),
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except Exception as e:  # noqa: BLE001 — projection must not break bus send
        return {"error": str(e), "skipped": True}


def send_agent_message(
    *,
    user_id: str,
    from_agent_id: str,
    body: str,
    to_agent_id: str | None = None,
    channel_id: str | None = None,
    priority: bool = False,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    body = (body or "").strip()
    if not body:
        raise ValueError("body required")
    user_id = (user_id or "").strip()
    if not user_id:
        raise ValueError("user_id required for send_to_agent")
    from_agent_id = (from_agent_id or "open-bot").strip() or "open-bot"
    to_agent_id = (to_agent_id or "").strip() or None
    channel_id = (channel_id or "").strip() or None
    if not to_agent_id and not channel_id:
        raise ValueError("to_agent_id or channel_id required")

    try:
        out = _post_via_api(
            user_id=user_id,
            from_agent_id=from_agent_id,
            body=body,
            to_agent_id=to_agent_id,
            channel_id=channel_id,
            priority=priority,
            conversation_id=conversation_id,
        )
        # P1: project visible handoff onto user timeline (API also hooks; skip_if_projected).
        # Projection errors must not flip a successful bus send into a tool failure —
        # that previously pushed the model to fall back to ask_agent (H7).
        if to_agent_id and out.get("id"):
            try:
                status = "running" if priority else "done"
                proj = project_handoff_note(
                    user_id=user_id,
                    from_bot=from_agent_id,
                    to_bot=to_agent_id,
                    purpose=body,
                    status=status,
                    agent_message_id=str(out["id"]),
                    viewer_agent_id=from_agent_id,
                    conversation_id=conversation_id,
                    channel_id=channel_id,
                    skip_if_projected=True,
                )
                if proj:
                    out["_handoff_projection"] = proj
            except Exception as proj_err:  # noqa: BLE001
                out["_handoff_projection"] = {"error": str(proj_err), "skipped": True}
        return out
    except Exception as api_err:
        fallback = (os.getenv("OPENBOT_BUS_PG_FALLBACK") or "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if not fallback:
            raise
        # Dev-only: insert without wake/WS
        out = _post_via_pg(
            user_id=user_id,
            from_agent_id=from_agent_id,
            body=body,
            to_agent_id=to_agent_id,
            channel_id=channel_id,
            priority=priority,
        )
        out["_api_error"] = str(api_err)
        if to_agent_id and out.get("id"):
            try:
                status = "running" if priority else "done"
                proj = project_handoff_note(
                    user_id=user_id,
                    from_bot=from_agent_id,
                    to_bot=to_agent_id,
                    purpose=body,
                    status=status,
                    agent_message_id=str(out["id"]),
                    viewer_agent_id=from_agent_id,
                    conversation_id=conversation_id,
                    channel_id=channel_id,
                    skip_if_projected=True,
                )
                if proj:
                    out["_handoff_projection"] = proj
            except Exception as proj_err:  # noqa: BLE001
                out["_handoff_projection"] = {"error": str(proj_err), "skipped": True}
        return out
