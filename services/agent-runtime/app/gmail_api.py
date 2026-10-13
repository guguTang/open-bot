"""Web Gmail integration helpers: call Go internal HTTP APIs."""

from __future__ import annotations

from typing import Any

from . import sandbox as sbx


def gmail_status(user_id: str) -> dict[str, Any]:
    return sbx._post(  # noqa: SLF001 — shared internal POST helper
        "/internal/gmail/status",
        {"user_id": user_id},
        timeout=30.0,
    )


def gmail_send(
    user_id: str,
    *,
    conversation_id: str = "",
    agent_id: str = "",
    to: str = "",
    subject: str = "",
    body: str = "",
    cc: str = "",
    bcc: str = "",
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Confirm wait can approach hostConfirmTimeout (90s).
    payload: dict[str, Any] = {
        "user_id": user_id,
        "conversation_id": conversation_id or "",
        "agent_id": agent_id or "",
        "to": to,
        "subject": subject,
        "body": body,
        "cc": cc or "",
        "bcc": bcc or "",
    }
    if attachments:
        payload["attachments"] = attachments
    return sbx._post(  # noqa: SLF001
        "/internal/gmail/send",
        payload,
        timeout=120.0,
    )
