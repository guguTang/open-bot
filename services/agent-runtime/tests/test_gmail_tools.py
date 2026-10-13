"""Gmail web tools: disconnected gating + TOOL_DEFS presence."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from app import gmail_api
from app.llm import TOOL_DEFS


def test_gmail_tools_in_tool_defs():
    names = {((t.get("function") or {}).get("name") or "") for t in TOOL_DEFS}
    assert "gmail_status" in names
    assert "gmail_send" in names


def test_gmail_status_disconnected():
    with patch.object(
        gmail_api.sbx,
        "_post",
        return_value={
            "ok": True,
            "connected": False,
            "oauth_configured": True,
            "hint": "尚未连接 Gmail。请用户打开「设置 → 连接应用」",
        },
    ) as post:
        out = gmail_api.gmail_status("user-1")
    post.assert_called_once()
    assert out["connected"] is False
    assert "连接应用" in (out.get("hint") or "")


def test_gmail_send_disconnected_gates():
    with patch.object(
        gmail_api.sbx,
        "_post",
        return_value={
            "ok": False,
            "connected": False,
            "error": "尚未连接 Gmail。请用户打开「设置 → 连接应用」完成授权后再发信。",
        },
    ) as post:
        out = gmail_api.gmail_send(
            "user-1",
            conversation_id="c1",
            to="a@example.com",
            subject="Hi",
            body="Hello",
        )
    assert out["ok"] is False
    assert out.get("connected") is False
    args = post.call_args
    assert args[0][0] == "/internal/gmail/send"
    assert args[0][1]["to"] == "a@example.com"


def test_gmail_send_requires_fields_passed():
    with patch.object(gmail_api.sbx, "_post", return_value={"ok": True}) as post:
        gmail_api.gmail_send(
            "u",
            conversation_id="cid",
            to="t@e.com",
            subject="S",
            body="B",
            cc="c@e.com",
            bcc="b@e.com",
        )
    payload = post.call_args[0][1]
    assert payload["conversation_id"] == "cid"
    assert payload["cc"] == "c@e.com"
    assert payload["bcc"] == "b@e.com"
