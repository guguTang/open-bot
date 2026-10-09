"""Journal session helpers (no live Go required)."""

from __future__ import annotations

import pytest

from app.harness.journal.client import JournalClient
from app.harness.journal.commit import JournalSession


class _FakeClient(JournalClient):
    def __init__(self) -> None:
        super().__init__(enabled=True)
        self.calls: list[tuple[str, dict]] = []

    def _request(self, method: str, path: str, body=None):
        self.calls.append((path, body or {}))
        if path.endswith("/entries"):
            return {"ok": True, "entry_id": body.get("entry_id"), "seq": 1}
        return {"ok": True}


@pytest.mark.asyncio
async def test_commit_assistant_projects():
    fake = _FakeClient()
    js = JournalSession(thread_id="c:r1", conversation_id="c", request_id="r1", client=fake)
    out = await js.commit_assistant("hello", project=True)
    assert out["ok"] is True
    paths = [p for p, _ in fake.calls]
    assert "/internal/harness/entries" in paths
    entry = next(b for p, b in fake.calls if p.endswith("/entries"))
    assert entry["project"] is True
    assert entry["kind"] == "assistant"


@pytest.mark.asyncio
async def test_live_throttle():
    fake = _FakeClient()
    js = JournalSession(thread_id="c:r1", client=fake, live_throttle_ms=10_000)
    a = await js.put_live({"phase": "a"})
    b = await js.put_live({"phase": "b"})
    assert a.get("ok") is True
    assert b.get("throttled") is True
