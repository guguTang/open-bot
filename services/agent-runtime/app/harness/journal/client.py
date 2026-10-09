"""HTTP client for Go harness journal endpoints (fail-soft)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger("open-bot.harness.journal")

DEFAULT_API_URL = "http://127.0.0.1:18080"
DEFAULT_INTERNAL_TOKEN = "open-bot-dev-internal"


def _api_base() -> str:
    return (
        os.getenv("OPENBOT_API_URL") or os.getenv("API_BASE_URL") or DEFAULT_API_URL
    ).rstrip("/")


def _internal_token() -> str:
    return (
        (
            os.getenv("INTERNAL_TOKEN")
            or os.getenv("OPENBOT_INTERNAL_TOKEN")
            or DEFAULT_INTERNAL_TOKEN
        ).strip()
        or DEFAULT_INTERNAL_TOKEN
    )


class JournalClient:
    """Thin sync client; callers wrap in asyncio.to_thread when needed."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 8.0,
        enabled: bool | None = None,
    ) -> None:
        self.base_url = (base_url or _api_base()).rstrip("/")
        self.token = token or _internal_token()
        self.timeout = timeout
        if enabled is None:
            raw = (os.getenv("RUNTIME_JOURNAL") or "1").strip().lower()
            enabled = raw not in ("0", "false", "no", "off")
        self.enabled = enabled

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.enabled:
            return {"ok": False, "skipped": True}
        url = f"{self.base_url}{path}"
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "X-Internal-Token": self.token,
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8") or "{}"
                out = json.loads(raw)
                return out if isinstance(out, dict) else {"ok": True, "raw": out}
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            logger.warning("journal %s %s failed: %s", method, path, exc)
            return {"ok": False, "error": str(exc)}

    def upsert_thread(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/internal/harness/threads", payload)

    def append_entry(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/internal/harness/entries", payload)

    def put_doc(self, thread_id: str, kind: str, data: Any) -> dict[str, Any]:
        return self._request(
            "POST",
            "/internal/harness/docs",
            {"thread_id": thread_id, "kind": kind, "data": data},
        )

    def list_resumable(self) -> list[str]:
        out = self._request("GET", "/internal/harness/resumable")
        ids = out.get("thread_ids") if isinstance(out, dict) else None
        return list(ids) if isinstance(ids, list) else []


_default: JournalClient | None = None


def get_journal() -> JournalClient:
    global _default
    if _default is None:
        _default = JournalClient()
    return _default
