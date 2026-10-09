"""failed_done_frames must emit SSE error so clients are not silent."""

from __future__ import annotations

from app.harness.frames import failed_done_frames


def test_failed_done_frames_emits_error_then_done() -> None:
    frames = list(failed_done_frames(rid="r1", tid="t1", error="ReadTimeout"))
    assert len(frames) == 2
    assert frames[0].startswith("event: error\n")
    assert '"message": "ReadTimeout"' in frames[0]
    assert frames[1].startswith("event: done\n")
    assert '"ok": false' in frames[1]
    assert '"error": "ReadTimeout"' in frames[1]
