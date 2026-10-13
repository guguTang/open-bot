"""approve_thread must use Command(resume=...) only when interrupt() is pending."""

from __future__ import annotations

import os

import pytest

os.environ["RUNTIME_CHECKPOINT"] = "memory"
os.environ["RUNTIME_DURABLE"] = "1"
os.environ["RUNTIME_JOURNAL"] = "0"


class _NextNodeTask:
    interrupts = ()


@pytest.mark.asyncio
async def test_approve_rejects_when_not_waiting(monkeypatch):
    from app.harness import steer as steer_mod

    class FakeSnap:
        values = {"status": "running"}
        tasks = (_NextNodeTask(),)
        next = ("tools",)

    class FakeGraph:
        async def aget_state(self, config):
            return FakeSnap()

        async def ainvoke(self, *a, **k):
            raise AssertionError("must not Command(resume) without interrupt")

    async def fake_compiled():
        return FakeGraph()

    monkeypatch.setattr(steer_mod, "get_compiled_graph", fake_compiled)
    out = await steer_mod.approve_thread("c:r1", approve=True)
    assert out["ok"] is False
    assert out["error"] == "not_waiting_approval"
