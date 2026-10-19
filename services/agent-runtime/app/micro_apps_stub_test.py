"""Smoke tests for micro-app runtime tools (no live API)."""

from __future__ import annotations

from .micro_apps_stub import (
    MICRO_APP_TOOL_DEFS,
    MICRO_APP_TOOL_NAMES,
    require_user_intent,
)


def test_tool_defs_registered_names():
    assert MICRO_APP_TOOL_NAMES == {"draft_micro_app", "pin_micro_app"}
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
