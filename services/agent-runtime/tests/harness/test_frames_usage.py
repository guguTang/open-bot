"""Durable done frames must carry token usage so the API can record it."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.harness import runner as runner_mod
from app.harness.frames import idempotent_done_frames, success_done_frames


def _done_payload(frame: str) -> dict[str, Any]:
    for line in frame.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())
    raise AssertionError(f"no data line in {frame!r}")


def test_success_done_frames_include_usage() -> None:
    usage = {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}
    frames = list(success_done_frames(rid="r1", tid="t1", usage=usage))
    done = _done_payload(frames[-1])
    assert done["usage"] == usage


def test_idempotent_done_frames_include_usage() -> None:
    usage = {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5}
    frames = list(
        idempotent_done_frames(meta={"run_id": "r1"}, final="hi", rid="r1", tid="t1", usage=usage)
    )
    done = _done_payload(frames[-1])
    assert done["ok"] is True
    assert done["usage"] == usage


class _FakeJournal:
    async def set_status(self, status: str) -> dict[str, Any]:
        return {"status": status}


@pytest.mark.asyncio
async def test_durable_done_sse_includes_graph_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    usage = {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}

    class _FakeSnap:
        def __init__(self, values: dict[str, Any]) -> None:
            self.values = values
            self.tasks = ()
            self.next = ()

    class _FakeGraph:
        def __init__(self) -> None:
            self.calls = 0

        async def aget_state(self, config: Any) -> _FakeSnap:
            self.calls += 1
            if self.calls == 1:
                return _FakeSnap({})
            return _FakeSnap(
                {
                    "status": "done",
                    "final_text": "hello",
                    "usage": usage,
                }
            )

        async def astream(self, inp: Any, config: Any, stream_mode: str = "updates"):
            yield {
                "llm": {
                    "final_text": "hello",
                    "status": "done",
                    "usage": usage,
                }
            }

    async def fake_get_compiled_graph() -> _FakeGraph:
        return _FakeGraph()

    monkeypatch.setattr(runner_mod, "get_compiled_graph", fake_get_compiled_graph)
    monkeypatch.setattr(runner_mod, "JournalSession", lambda **kwargs: _FakeJournal())
    monkeypatch.setattr(runner_mod, "mark_live", lambda tid: None)
    monkeypatch.setattr(runner_mod, "release_live", lambda tid: None)
    monkeypatch.setattr(runner_mod.tracing, "attach_run_metadata", lambda *a, **k: None)
    monkeypatch.setattr(runner_mod.lf, "update_obs", lambda *a, **k: None)

    body = MagicMock()
    body.conversation_id = "c1"
    body.user_id = "u1"
    body.agent_id = "a1"
    body.request_id = "r1"

    frames: list[str] = []
    agen = runner_mod.run_durable_events(
        body=body,
        history=[{"role": "user", "content": "hi"}],
        api_key="sk-test",
        override=None,
        run_id="r1",
        request_id="r1",
    )
    async for frame in agen:
        frames.append(frame)

    done_frames = [f for f in frames if f.startswith("event: done\n")]
    assert done_frames, frames
    assert _done_payload(done_frames[-1])["usage"] == usage
