"""Attach a host_screenshot so the model can see the pixels.

Tool observations stay JSON strings. Review, truncation, and the journal
must not store the image. The bytes ride on ``_host_image`` and become an
OpenAI ``image_url`` content part inside ``chat_completion``.
"""

from __future__ import annotations

import json
from typing import Any

HOST_IMAGE_KEY = "_host_image"
USER_IMAGE_KEY = "_user_images"

_VISION_REJECT_ZH = (
    "不支持图像",
    "不支持图片",
    "不支持视觉",
    "不支持多模态",
    "无法处理图像",
    "无法处理图片",
    "不接受图像",
    "不接受图片",
    "不支持看图",
)

# ~1.5MB of base64. The desktop bridge caps the JPEG lower than this.
_MAX_B64_CHARS = 2_000_000

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}

SCREENSHOT_NOTE = (
    "屏幕截图已作为图像附在这条工具结果上，并且会自动显示在对话里给用户看。"
    "请直接根据画面回答。不要说自己看不到图，也不要再用 screencapture 另存一份。"
    "后续点击、滚动、移动鼠标的坐标用本结果的 width×height 像素（左上角为 0,0），并带上 frame_id。"
    "不要乘 scale，不要加 origin。frame_id 过期或 scope=all 时先重新截一张单屏或单窗口图。"
)

TEXT_MODEL_IMAGE_NOTE = (
    "上游模型不接受图像输入，这次没有看到画面，不要假装看过屏幕。"
)

USER_IMAGE_REJECT_NOTE = (
    "上游模型不接受图像输入，这次没有看到用户附图，不要假装看过图片。"
)


def split_host_image(result: str) -> tuple[str, dict[str, str] | None]:
    """Pull image_base64 out of a tool JSON string.

    Returns ``(text_json, vision)``. ``vision`` is ``{"mime", "data"}`` when
    the payload carried a usable image; otherwise None. The text JSON never
    contains the pixels.
    """
    raw = result if isinstance(result, str) else str(result or "")
    try:
        obj = json.loads(raw) if raw.strip() else None
    except json.JSONDecodeError:
        return raw, None
    if not isinstance(obj, dict) or "image_base64" not in obj:
        return raw, None
    b64 = obj.pop("image_base64")
    if not isinstance(b64, str):
        b64 = ""
    b64 = "".join(b64.split())
    mime = str(obj.get("mime") or "image/jpeg").strip().lower()
    if mime not in _ALLOWED_MIME:
        mime = "image/jpeg"
    if len(b64) < 16 or len(b64) > _MAX_B64_CHARS:
        obj["ok"] = False
        obj["image_attached"] = False
        obj["code"] = obj.get("code") or "screenshot_too_large"
        obj["error"] = "截图太大或为空，没有把图像交给模型"
        return json.dumps(obj, ensure_ascii=False), None
    obj["image_attached"] = True
    if not str(obj.get("note") or "").strip():
        obj["note"] = SCREENSHOT_NOTE
    return json.dumps(obj, ensure_ascii=False), {"mime": mime, "data": b64}


def tool_result_message(
    tool_call_id: str,
    content: str,
    *,
    name: str = "",
    vision: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Tool message. Pixels stay on ``_host_image``, not in ``content``."""
    msg: dict[str, Any] = {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content,
    }
    if name:
        msg["name"] = name
    if vision and vision.get("data"):
        msg[HOST_IMAGE_KEY] = {"mime": vision.get("mime") or "image/jpeg", "data": vision["data"]}
    return msg


def clean_user_images(raw: Any) -> list[dict[str, str]] | None:
    """Keep jpeg/png/webp data URLs that fit the host screenshot budget."""
    if not isinstance(raw, list):
        return None
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        data = "".join(str(item.get("data") or "").split())
        mime = str(item.get("mime") or "").strip().lower()
        if mime not in _ALLOWED_MIME:
            continue
        if len(data) < 16 or len(data) > _MAX_B64_CHARS:
            continue
        out.append({"mime": mime, "data": data})
    return out or None


def _promote_user_images(message: dict[str, Any], images: list[Any]) -> dict[str, Any]:
    """User chat images: text stays, pixels become image_url parts."""
    text = message.get("content")
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    parts: list[dict[str, Any]] = [{"type": "text", "text": text or "（见附图）"}]
    for img in images:
        if not isinstance(img, dict):
            continue
        data = "".join(str(img.get("data") or "").split())
        mime = str(img.get("mime") or "").strip().lower()
        if mime not in _ALLOWED_MIME or len(data) < 16 or len(data) > _MAX_B64_CHARS:
            continue
        parts.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{data}"},
            }
        )
    promoted = {k: v for k, v in message.items() if k not in (HOST_IMAGE_KEY, USER_IMAGE_KEY)}
    if len(parts) == 1:
        cleaned = text
        if "请直接看图" in cleaned:
            cleaned = cleaned.replace(
                "图片已随消息交给模型，请直接看图",
                "图片未能交给模型，不要假装看过图片",
            )
        promoted["content"] = cleaned
        return promoted
    promoted["content"] = parts
    return promoted


def promote_host_images_for_model(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copy messages, turning ``_host_image`` into an image_url content part.

    The copy is what goes upstream. In-loop messages keep a string ``content``
    so truncation and failure checks stay JSON.
    """
    out: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            out.append(message)
            continue
        user_imgs = message.get(USER_IMAGE_KEY)
        if message.get("role") == "user" and isinstance(user_imgs, list) and user_imgs:
            out.append(_promote_user_images(message, user_imgs))
            continue
        vision = message.get(HOST_IMAGE_KEY)
        if message.get("role") != "tool" or not isinstance(vision, dict):
            if HOST_IMAGE_KEY in message or USER_IMAGE_KEY in message:
                out.append(
                    {k: v for k, v in message.items() if k not in (HOST_IMAGE_KEY, USER_IMAGE_KEY)}
                )
            else:
                out.append(message)
            continue
        data = str(vision.get("data") or "")
        mime = str(vision.get("mime") or "image/jpeg").strip().lower()
        if mime not in _ALLOWED_MIME:
            mime = "image/jpeg"
        text = message.get("content")
        if not isinstance(text, str):
            text = "" if text is None else str(text)
        promoted = {k: v for k, v in message.items() if k != HOST_IMAGE_KEY}
        if not data:
            promoted["content"] = text
            out.append(promoted)
            continue
        promoted["content"] = [
            {"type": "text", "text": text},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{data}"},
            },
        ]
        out.append(promoted)
    return out


def messages_include_images(messages: list[Any]) -> bool:
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        if isinstance(message.get(HOST_IMAGE_KEY), dict):
            return True
        user_imgs = message.get(USER_IMAGE_KEY)
        if isinstance(user_imgs, list) and user_imgs:
            return True
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                return True
    return False


def is_vision_input_reject(message: str) -> bool:
    """True when an upstream 400 is about image input, not a generic schema error."""
    raw = message or ""
    folded = raw.lower()
    if "image_url" in folded or "image url" in folded:
        return True
    if "does not support image" in folded or "doesn't support image" in folded:
        return True
    if "do not support image" in folded or "don't support image" in folded:
        return True
    if "not support image" in folded or "unsupported image" in folded:
        return True
    vision_unsupported = "vision" in folded and (
        "not support" in folded or "unsupported" in folded or "does not support" in folded
    )
    if vision_unsupported:
        return True
    if "multimodal" in folded and ("not support" in folded or "unsupported" in folded):
        return True
    return any(phrase in raw for phrase in _VISION_REJECT_ZH)


def drop_host_images_for_text_model(messages: list[Any]) -> list[Any]:
    """Remove image parts and say so in text. Used when the endpoint rejects vision."""
    out: list[Any] = []
    for message in messages or []:
        if not isinstance(message, dict):
            out.append(message)
            continue
        content = message.get("content")
        had_user_images = isinstance(message.get(USER_IMAGE_KEY), list) and bool(
            message.get(USER_IMAGE_KEY)
        )
        cleaned = {
            k: v
            for k, v in message.items()
            if k not in (HOST_IMAGE_KEY, USER_IMAGE_KEY)
        }
        if not isinstance(content, list):
            if had_user_images and message.get("role") == "user":
                text = content if isinstance(content, str) else ""
                cleaned["content"] = (text + "\n" + USER_IMAGE_REJECT_NOTE).strip()
            out.append(cleaned)
            continue
        texts: list[str] = []
        had_image = False
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                had_image = True
                continue
            if isinstance(part, dict):
                bit = str(part.get("text") or "")
                if bit:
                    texts.append(bit)
            elif part:
                texts.append(str(part))
        if had_image:
            if message.get("role") == "user":
                texts.append(USER_IMAGE_REJECT_NOTE)
            else:
                texts.append(TEXT_MODEL_IMAGE_NOTE)
        cleaned["content"] = "\n".join(texts)
        out.append(cleaned)
    return out
