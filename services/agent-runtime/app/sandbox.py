"""Sandbox computer helpers: call Go internal HTTP APIs (same auth as agent_bus)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

DEFAULT_API_URL = "http://127.0.0.1:18080"
DEFAULT_INTERNAL_TOKEN = "open-bot-dev-internal"


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


def _post(path: str, payload: dict[str, Any], timeout: float = 120.0) -> dict[str, Any]:
    url = f"{_api_base()}{path}"
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
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"sandbox api HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"sandbox api unreachable: {e}") from e


def ensure(
    user_id: str,
    *,
    agent_id: str | None = None,
    mode: str | None = None,
    desktop: bool = False,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"user_id": user_id}
    if agent_id:
        payload["agent_id"] = agent_id
    if mode:
        payload["mode"] = mode
    if desktop:
        payload["desktop"] = True
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return _post("/internal/sandbox/ensure", payload)


def shell(
    user_id: str,
    cmd: str,
    *,
    workdir: str | None = None,
    timeout_sec: int | None = None,
    agent_id: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"user_id": user_id, "cmd": cmd}
    if workdir:
        payload["workdir"] = workdir
    if timeout_sec is not None:
        payload["timeout_sec"] = int(timeout_sec)
    if agent_id:
        payload["agent_id"] = agent_id
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return _post("/internal/sandbox/exec", payload, timeout=float((timeout_sec or 30) + 15))


def read_file(
    user_id: str,
    path: str,
    *,
    agent_id: str | None = None,
    mode: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"user_id": user_id, "path": path}
    if agent_id:
        payload["agent_id"] = agent_id
    if mode:
        payload["mode"] = mode
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return _post("/internal/sandbox/read", payload)


def write_file(
    user_id: str,
    path: str,
    content: str,
    *,
    agent_id: str | None = None,
    mode: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "user_id": user_id,
        "path": path,
        "content": content,
    }
    if agent_id:
        payload["agent_id"] = agent_id
    if mode:
        payload["mode"] = mode
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return _post("/internal/sandbox/write", payload)


def list_dir(
    user_id: str,
    path: str = "/workspace",
    *,
    agent_id: str | None = None,
    mode: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"user_id": user_id, "path": path or "/workspace"}
    if agent_id:
        payload["agent_id"] = agent_id
    if mode:
        payload["mode"] = mode
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return _post("/internal/sandbox/ls", payload)


def request_secret(
    user_id: str,
    *,
    agent_id: str | None = None,
    conversation_id: str | None = None,
    name: str = "",
    origin: str = "",
    auth_type: str = "bearer",
    reason: str = "",
) -> dict[str, Any]:
    return _post(
        "/internal/bot-secrets/request",
        {
            "user_id": user_id,
            "agent_id": agent_id or "",
            "conversation_id": conversation_id or "",
            "name": name,
            "origin": origin,
            "auth_type": auth_type,
            "reason": reason,
        },
    )


def secret_http(
    user_id: str,
    name: str,
    *,
    agent_id: str | None = None,
    method: str = "GET",
    url: str = "",
    headers: dict[str, str] | None = None,
    body: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "user_id": user_id,
        "agent_id": agent_id or "",
        "name": name,
        "method": method,
        "url": url,
        "body": body,
    }
    if headers:
        payload["headers"] = headers
    return _post("/internal/bot-secrets/http", payload, timeout=60.0)
