"""Inbox whenBusy: reject / steer / follow_up."""

from __future__ import annotations

import os

import pytest

os.environ["RUNTIME_CHECKPOINT"] = "memory"
os.environ["RUNTIME_DURABLE"] = "1"
os.environ["RUNTIME_JOURNAL"] = "0"


@pytest.mark.asyncio
async def test_reject_when_busy():
    from langgraph.checkpoint.memory import MemorySaver

    from app.harness.graph import build_graph, reset_compiled_graph
    from app.harness.state import initial_state
    from app.harness import inbox as inbox_mod
    from app.harness import graph as graph_mod

    reset_compiled_graph()
    saver = MemorySaver()

    async def fake_compiled(checkpointer=None):
        return build_graph().compile(checkpointer=saver)

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(inbox_mod, "get_compiled_graph", fake_compiled)
    monkeypatch.setattr(graph_mod, "get_compiled_graph", fake_compiled)
    try:
        g = await fake_compiled()
        config = {"configurable": {"thread_id": "c:busy1"}}
        st = initial_state(messages=[{"role": "user", "content": "x"}], max_rounds=2)
        st["prepared"] = True
        st["skip_recall"] = True
        st["status"] = "running"
        await g.aupdate_state(config, st, as_node="prepare")
        res = await inbox_mod.submit_when_busy(
            "c:busy1", text="nope", when_busy="reject"
        )
        assert res["ok"] is False
        assert res["error"] == "busy_rejected"
    finally:
        monkeypatch.undo()
        reset_compiled_graph()


@pytest.mark.asyncio
async def test_follow_up_when_busy():
    from langgraph.checkpoint.memory import MemorySaver

    from app.harness.graph import build_graph, reset_compiled_graph
    from app.harness.state import initial_state
    from app.harness import inbox as inbox_mod
    from app.harness import graph as graph_mod

    reset_compiled_graph()
    saver = MemorySaver()

    async def fake_compiled(checkpointer=None):
        return build_graph().compile(checkpointer=saver)

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(inbox_mod, "get_compiled_graph", fake_compiled)
    monkeypatch.setattr(graph_mod, "get_compiled_graph", fake_compiled)
    try:
        g = await fake_compiled()
        config = {"configurable": {"thread_id": "c:busy2"}}
        st = initial_state(messages=[{"role": "user", "content": "x"}], max_rounds=2)
        st["prepared"] = True
        st["skip_recall"] = True
        st["status"] = "running"
        await g.aupdate_state(config, st, as_node="prepare")
        res = await inbox_mod.submit_when_busy(
            "c:busy2", text="also Y", when_busy="follow_up"
        )
        assert res["ok"] is True
        snap = await g.aget_state(config)
        assert "also Y" in (snap.values.get("follow_up_queue") or [])
    finally:
        monkeypatch.undo()
        reset_compiled_graph()
