"""Unit tests for session-scoped recent micro_app hint injection."""

from __future__ import annotations

from . import micro_app_session as sess


def setup_function():
    sess.clear_all()


def teardown_function():
    sess.clear_all()


def test_format_hint_includes_last_id():
    sess.record_touch(
        "conv-1",
        "draft_micro_app",
        {"id": "app-aaa", "title": "计算器", "status": "draft"},
    )
    hint = sess.format_recent_hint("conv-1")
    assert hint
    assert "id=app-aaa" in hint
    assert "title=计算器" in hint
    assert "status=draft" in hint
    assert "禁止再 draft" in hint
    assert "upload_micro_app_bundle" in hint
    assert "get_micro_app_runtime" in hint
    assert "list_micro_apps" in hint


def test_mru_and_upload_nested_micro_app():
    sess.record_touch(
        "conv-1",
        "draft_micro_app",
        {"id": "app-1", "title": "A", "status": "draft"},
    )
    sess.record_touch(
        "conv-1",
        "upload_micro_app_bundle",
        {
            "micro_app": {"id": "app-1", "title": "A", "status": "draft"},
            "bundle_hash": "h",
        },
        args={"id": "app-1"},
    )
    sess.record_touch(
        "conv-1",
        "pin_micro_app",
        {"id": "app-1", "title": "A", "status": "pinned"},
    )
    sess.record_touch(
        "conv-2",
        "draft_micro_app",
        {"id": "other", "title": "X", "status": "draft"},
    )
    # Same conversation: one entry, status upgraded to pinned
    recent = sess.list_recent("conv-1")
    assert len(recent) == 1
    assert recent[0].id == "app-1"
    assert recent[0].status == "pinned"
    hint = sess.format_recent_hint("conv-1")
    assert "id=app-1" in hint
    assert "status=pinned" in hint
    assert "other" not in hint


def test_apply_hint_appends_to_dynamic():
    sess.record_touch(
        "c",
        "update_micro_app",
        {"id": "u1", "title": "T", "status": "pinned"},
        args={"id": "u1", "title": "T"},
    )
    system, dynamic = sess.apply_recent_micro_app_hint("STATIC", "DYNAMIC", "c")
    assert "STATIC" in system
    assert "id=u1" in system
    assert "DYNAMIC" in dynamic
    assert "id=u1" in dynamic


def test_no_hint_without_touches_or_on_error():
    assert sess.format_recent_hint("missing") == ""
    system, dynamic = sess.apply_recent_micro_app_hint("S", "D", "missing")
    assert (system, dynamic) == ("S", "D")
    assert (
        sess.record_touch("c", "draft_micro_app", {"error": "nope"}) is None
    )
    assert sess.format_recent_hint("c") == ""
    # list_micro_apps is not a touch tool
    assert (
        sess.record_touch(
            "c", "list_micro_apps", {"micro_apps": [{"id": "x"}]}
        )
        is None
    )


def test_args_fallback_for_id_when_bundle_sparse():
    sess.record_touch(
        "c",
        "upload_micro_app_bundle",
        {"ok": True, "bundle_hash": "h"},
        args={"id": "from-args", "title": "FromArgs"},
    )
    hint = sess.format_recent_hint("c")
    assert "id=from-args" in hint
    assert "title=FromArgs" in hint
