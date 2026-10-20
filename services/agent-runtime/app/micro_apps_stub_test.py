"""Smoke tests for micro-app runtime tools (no live API)."""

from __future__ import annotations

from .micro_apps_stub import (
    MICRO_APP_TOOL_DEFS,
    MICRO_APP_TOOL_NAMES,
    coerce_explicit_bool,
    get_micro_app_runtime,
    list_micro_apps,
    pin_micro_app,
    require_user_intent,
    update_micro_app,
    upload_micro_app_bundle,
)


def test_tool_defs_registered_names():
    assert MICRO_APP_TOOL_NAMES == {
        "draft_micro_app",
        "upload_micro_app_bundle",
        "pin_micro_app",
        "list_micro_apps",
        "get_micro_app_runtime",
        "update_micro_app",
    }
    names = {t["function"]["name"] for t in MICRO_APP_TOOL_DEFS}
    assert names == MICRO_APP_TOOL_NAMES
    # Descriptions must steer modify away from draft and toward runtime read
    joined = " ".join(t["function"]["description"] for t in MICRO_APP_TOOL_DEFS)
    assert "禁止" in joined and "draft" in joined
    assert "list_micro_apps" in joined or "list" in joined
    assert "get_micro_app_runtime" in joined


def test_require_user_intent_rejects_silent():
    for bad in ("", None, "silent", "maybe"):
        try:
            require_user_intent(bad)
            raise AssertionError(f"expected ValueError for {bad!r}")
        except ValueError as e:
            assert "user_intent required" in str(e)
    assert require_user_intent("save") == "save"
    assert require_user_intent("PIN_AGREE") == "pin_agree"


def test_coerce_explicit_bool_chat_pin_rules():
    # true cases
    assert coerce_explicit_bool(True) is True
    assert coerce_explicit_bool("true") is True
    assert coerce_explicit_bool("True") is True
    assert coerce_explicit_bool("TRUE") is True
    assert coerce_explicit_bool("1") is True
    assert coerce_explicit_bool(1) is True

    # false cases — including the incident string "True" wait, "True" is true;
    # the bug was bool("False") == True in Python; we must treat "False" as false
    assert coerce_explicit_bool(False) is False
    assert coerce_explicit_bool("False") is False
    assert coerce_explicit_bool("false") is False
    assert coerce_explicit_bool("0") is False
    assert coerce_explicit_bool(0) is False
    assert coerce_explicit_bool("") is False
    assert coerce_explicit_bool(None) is False
    assert coerce_explicit_bool(None, default=False) is False
    # non-empty arbitrary strings must NOT be truthy (old bug: bool("False")/bool("yes"))
    assert coerce_explicit_bool("yes") is False
    assert coerce_explicit_bool("pin") is False
    assert coerce_explicit_bool("True ") is True  # strip + casefold
    assert coerce_explicit_bool(2) is False
    assert coerce_explicit_bool(0.0) is False
    assert coerce_explicit_bool(1.0) is True


def test_pin_uses_coerce_not_python_bool(monkeypatch):
    calls: list[dict] = []

    def fake_post(path, payload, timeout=60.0):
        calls.append(payload)
        return {"ok": True, "id": payload["id"], "status": "pinned"}

    monkeypatch.setattr("app.micro_apps_stub.obapi._post", fake_post)

    pin_micro_app(
        "u1",
        {"user_intent": "confirm", "id": "app1", "chat_pin": "False"},
    )
    assert calls[-1]["chat_pin"] is False

    pin_micro_app(
        "u1",
        {"user_intent": "confirm", "id": "app1", "chat_pin": "True"},
    )
    assert calls[-1]["chat_pin"] is True

    pin_micro_app(
        "u1",
        {"user_intent": "confirm", "id": "app1"},
    )
    assert calls[-1]["chat_pin"] is False


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


def test_same_id_update_does_not_create(monkeypatch):
    """update_micro_app / upload with existing id must hit update|bundle, never create."""
    calls: list[tuple] = []

    def fake_post(path, payload, timeout=60.0):
        calls.append((path, dict(payload)))
        if path.endswith("/update"):
            return {"id": payload["id"], "title": payload.get("title"), "status": "pinned"}
        if path.endswith("/bundle"):
            return {"ok": True, "id": payload["id"], "bundle_hash": "h"}
        if path.endswith("/list"):
            return {
                "micro_apps": [
                    {"id": "calc-1", "title": "计算器", "status": "pinned", "kind": "ui"}
                ]
            }
        if path.endswith("/runtime"):
            return {
                "micro_app_id": payload["id"],
                "title": "计算器",
                "entrypoint": "index.html",
                "files": {
                    "index.html": {
                        "encoding": "utf8",
                        "mime": "text/html",
                        "content": "<html>v1</html>",
                    }
                },
            }
        if path.endswith("/create"):
            raise AssertionError("modify path must not create")
        return {}

    monkeypatch.setattr("app.micro_apps_stub.obapi._post", fake_post)

    listed = list_micro_apps("u1", {"status": "pinned", "limit": 10})
    assert listed["micro_apps"][0]["id"] == "calc-1"
    assert calls[0][0] == "/internal/micro-apps/list"

    runtime = get_micro_app_runtime("u1", {"id": "calc-1"})
    assert "files" in runtime
    assert calls[1][0] == "/internal/micro-apps/runtime"
    assert calls[1][1]["id"] == "calc-1"

    out = update_micro_app("u1", {"id": "calc-1", "title": "计算器 v2"})
    assert out["id"] == "calc-1"
    assert calls[2][0] == "/internal/micro-apps/update"
    assert calls[2][1]["id"] == "calc-1"
    assert "create" not in calls[2][0]

    upload_micro_app_bundle(
        "u1",
        {"id": "calc-1", "files": {"index.html": "<html>v2</html>"}},
    )
    assert calls[3][0] == "/internal/micro-apps/bundle"
    assert calls[3][1]["id"] == "calc-1"
    assert not any(p.endswith("/create") for p, _ in calls)

    try:
        update_micro_app("u1", {"id": "calc-1"})
        raise AssertionError("expected empty patch fields")
    except ValueError as e:
        assert "at least one" in str(e)


def test_get_micro_app_runtime_requires_id(monkeypatch):
    calls: list[tuple] = []

    def fake_post(path, payload, timeout=60.0):
        calls.append((path, payload, timeout))
        return {
            "micro_app_id": payload["id"],
            "entrypoint": "index.html",
            "files": {"index.html": {"encoding": "utf8", "content": "<p/>"}},
        }

    monkeypatch.setattr("app.micro_apps_stub.obapi._post", fake_post)
    try:
        get_micro_app_runtime("u1", {})
        raise AssertionError("expected missing id")
    except ValueError as e:
        assert "id" in str(e)
    out = get_micro_app_runtime("u1", {"micro_app_id": "app-x"})
    assert out["micro_app_id"] == "app-x"
    assert "index.html" in out["files"]
    assert calls[0][0] == "/internal/micro-apps/runtime"
    assert calls[0][1]["id"] == "app-x"

