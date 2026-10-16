"""Unit tests for assistant-visible chat images (attachment markdown helper)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.present_image import (  # noqa: E402
    append_present_markdown,
    attachment_markdown,
    attachment_url,
    present_image_for_chat,
    present_vision_for_chat,
)


def _ok(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_attachment_markdown_url_shape() -> None:
    md = attachment_markdown("conv-1", "att-2", alt="屏幕截图")
    _ok(
        md == "![屏幕截图](/v1/conversations/conv-1/attachments/att-2)",
        "markdown uses auth-relative attachment path with alt",
    )
    _ok(
        attachment_url("conv-1", "att-2")
        == "/v1/conversations/conv-1/attachments/att-2",
        "url helper",
    )
    _ok(attachment_markdown("", "x") == "", "empty conversation → empty")
    _ok(attachment_markdown("c", "") == "", "empty attachment → empty")


def test_append_present_markdown_dedupes_and_orders() -> None:
    a = attachment_markdown("c", "a1")
    b = attachment_markdown("c", "a2")
    out = append_present_markdown("看这里", [a, b, a])
    _ok(out.startswith("看这里"), "keeps assistant text")
    _ok(out.count(a) == 1 and out.count(b) == 1, "dedupe")
    _ok(out.index(a) < out.index(b), "order preserved")
    again = append_present_markdown(out, [a])
    _ok(again == out.rstrip(), "no duplicate when already present")
    only = append_present_markdown("", [a, b])
    _ok(only == a + "\n\n" + b, "images-only is joined with blank line")


def test_present_image_for_chat_uploads_and_returns_markdown() -> None:
    fake = {
        "id": "att-9",
        "url": "/v1/conversations/c1/attachments/att-9",
        "name": "screenshot.jpg",
        "mime": "image/jpeg",
        "size": 4,
    }
    with mock.patch(
        "app.present_image.openbot_api.upload_conversation_attachment", return_value=fake
    ) as up:
        out = present_image_for_chat(
            user_id="u1",
            conversation_id="c1",
            image_bytes=bytes([0xFF, 0xD8, 0xFF, 0xD9]),
            mime="image/jpeg",
            filename="screenshot.jpg",
            alt="屏幕截图",
        )
    _ok(out is not None, "upload ok")
    assert out is not None
    _ok(out["id"] == "att-9", "id")
    _ok(
        out["markdown"] == "![屏幕截图](/v1/conversations/c1/attachments/att-9)",
        "markdown",
    )
    _ok(up.called, "called internal upload")
    _ok(
        present_image_for_chat(user_id="", conversation_id="c", image_bytes=b"x") is None,
        "no user",
    )
    with mock.patch(
        "app.present_image.openbot_api.upload_conversation_attachment",
        side_effect=RuntimeError("boom"),
    ):
        _ok(
            present_image_for_chat(user_id="u", conversation_id="c", image_bytes=b"x")
            is None,
            "upload error → None",
        )


def test_present_vision_for_chat() -> None:
    with mock.patch(
        "app.present_image.present_image_for_chat",
        return_value={"markdown": "![](/v1/conversations/c/attachments/a)"},
    ):
        md = present_vision_for_chat(
            {"mime": "image/jpeg", "data": "AAAA"},
            user_id="u",
            conversation_id="c",
        )
    _ok(md == "![](/v1/conversations/c/attachments/a)", "vision helper returns markdown")
    _ok(present_vision_for_chat(None, user_id="u", conversation_id="c") is None, "no vision")
    _ok(
        present_vision_for_chat({"mime": "image/jpeg"}, user_id="u", conversation_id="c")
        is None,
        "no data",
    )


if __name__ == "__main__":
    test_attachment_markdown_url_shape()
    test_append_present_markdown_dedupes_and_orders()
    test_present_image_for_chat_uploads_and_returns_markdown()
    test_present_vision_for_chat()
    print("all passed")
