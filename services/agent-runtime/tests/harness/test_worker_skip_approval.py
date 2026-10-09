"""Resume worker skips approval interrupts and credential-less pauses."""

from __future__ import annotations

import os

import pytest

os.environ["RUNTIME_CHECKPOINT"] = "memory"
os.environ["RUNTIME_DURABLE"] = "1"
os.environ["RUNTIME_JOURNAL"] = "0"


class _ApprovalTask:
    interrupts = ("tool_approval",)


class _NextNodeTask:
    interrupts = ()


@pytest.mark.asyncio
async def test_resume_skips_interrupt_tasks(monkeypatch):
    from app.harness import worker as worker_mod

    class FakeSnap:
        values = {"status": "running"}
        tasks = (_ApprovalTask(),)
        next = ("tools",)

    class FakeGraph:
        async def aget_state(self, config):
            return FakeSnap()

        async def ainvoke(self, *a, **k):
            raise AssertionError("should not ainvoke waiting_approval")

    async def fake_compiled():
        return FakeGraph()

    monkeypatch.setattr(worker_mod, "get_compiled_graph", fake_compiled)
    out = await worker_mod.resume_thread("c:wait1")
    assert out["skipped"] is True
    assert out["reason"] == "waiting_approval"


@pytest.mark.asyncio
async def test_resume_skips_scheduled_next_node(monkeypatch):
    from app.harness import worker as worker_mod

    class FakeSnap:
        values = {"status": "running"}
        tasks = (_NextNodeTask(),)
        next = ("llm",)

    class FakeGraph:
        async def aget_state(self, config):
            return FakeSnap()

        async def ainvoke(self, *a, **k):
            raise AssertionError("paused next-node must wait for /v1/runs")

    async def fake_compiled():
        return FakeGraph()

    monkeypatch.setattr(worker_mod, "get_compiled_graph", fake_compiled)
    out = await worker_mod.resume_thread("c:paused1")
    assert out["skipped"] is True
    assert out["reason"] == "paused"
