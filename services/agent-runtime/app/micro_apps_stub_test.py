"""Smoke tests for micro-app runtime tools (no live API)."""

from __future__ import annotations

from .micro_apps_stub import (
    MICRO_APP_TOOL_DEFS,
    MICRO_APP_TOOL_NAMES,
    require_user_intent,
    upload_micro_app_bundle,
)


def test_tool_defs_registered_names():
    assert MICRO_APP_TOOL_NAMES == {
        "draft_micro_app",
        "upload_micro_app_bundle",
        "pin_micro_app",
    }
    names = {t["function"]["name"] for t in MICRO_APP_TOOL_DEFS}
    assert names == MICRO_APP_TOOL_NAMES


def test_require_user_intent_rejects_silent():
    for bad in ("", None, "silent", "maybe"):
        try:
            require_user_intent(bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError as e:
            assert "user_intent required" in str(e)
    assert require_user_intent("save") == "save"
    assert require_user_intent("PIN_AGREE") == "pin_agree"


def test_upload_requires_id_and_payload(monkeypatch):
    calls: list[tuple] = []

    def fake_post(path, payload, timeout=60.0):
        calls.append((path, payload, timeout))
        return {"ok": True, "bundle_hash": "abc"}

    monkeypatch.setattr("app.micro_apps_stub.obapi._post", fake_post)

    try:
        upload_micro_app_bundle("u1", {"files": {"index.html": "<html/>"}})
        raise AssertionError("expected missing id")
    except ValueError as e:
        assert "id" in str(e)

    try:
        upload_micro_app_bundle("u1", {"id": "app1"})
        raise AssertionError("expected missing files")
    except ValueError as e:
        assert "zip_base64 or files" in str(e)

    out = upload_micro_app_bundle(
        "u1",
        {"id": "app1", "files": {"index.html": "<html>hi</html>"}},
    )
    assert out["ok"] is True
    assert calls[0][0] == "/internal/micro-apps/bundle"
    assert calls[0][1]["user_id"] == "u1"
    assert calls[0][1]["id"] == "app1"
    assert calls[0][1]["files"]["index.html"] == "<html>hi</html>"
    assert calls[0][2] == 120.0

    calls.clear()
    upload_micro_app_bundle(
        "u1",
        {"micro_app_id": "app2", "index_html": "<p>x</p>", "manifest": {"capabilities": []}},
    )
    assert "index.html" in calls[0][1]["files"]
    assert "manifest.json" in calls[0][1]["files"]
