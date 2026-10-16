"""Present images in the chat bubble via conversation attachments + markdown.

Product: any image the assistant should show the user (screenshots, generated
images, tool-produced images, …) is persisted as a conversation attachment and
linked with ``![](/v1/conversations/{id}/attachments/{aid})`` so MarkdownMessage
renders it. Pixels are never inlined as base64 in chat text.

host_screenshot is one caller: after vision bytes are split for the model, the
same bytes are uploaded here and the markdown is auto-appended to the final
assistant reply (model cannot forget).
"""

from __future__ import annotations

import base64
import logging
import re
from typing import Any

from . import openbot_api

logger = logging.getLogger(__name__)

_ATTACH_MD_RE = re.compile(
    r"!\[[^\]]*\]\(/v1/conversations/[^/]+/attachments/[^)/\s]+\)"
)


def attachment_markdown(
    conversation_id: str,
    attachment_id: str,
    *,
    alt: str = "",
) -> str:
    """Build the auth-relative markdown image the web client already renders."""
    cid = (conversation_id or "").strip()
    aid = (attachment_id or "").strip()
    if not cid or not aid:
        return ""
    safe_alt = (alt or "").replace("]", "").replace("\n", " ").strip()
    return f"![{safe_alt}](/v1/conversations/{cid}/attachments/{aid})"


def attachment_url(conversation_id: str, attachment_id: str) -> str:
    cid = (conversation_id or "").strip()
    aid = (attachment_id or "").strip()
    if not cid or not aid:
        return ""
    return f"/v1/conversations/{cid}/attachments/{aid}"


def append_present_markdown(text: str, markdowns: list[str] | None) -> str:
    """Append unique image markdown blocks to assistant text (order preserved)."""
    body = (text or "").rstrip()
    parts: list[str] = []
    seen: set[str] = set(_ATTACH_MD_RE.findall(body))
    for md in markdowns or []:
        bit = (md or "").strip()
        if not bit:
            continue
        if bit in body or bit in seen:
            continue
        seen.add(bit)
        parts.append(bit)
    if not parts:
        return body
    block = "\n\n".join(parts)
    if not body:
        return block
    return f"{body}\n\n{block}"


def _ext_for_mime(mime: str) -> str:
    mt = (mime or "").strip().lower().split(";")[0]
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(mt, ".jpg")


def present_image_for_chat(
    *,
    user_id: str,
    conversation_id: str,
    image_base64: str | None = None,
    image_bytes: bytes | None = None,
    mime: str = "image/jpeg",
    filename: str = "",
    alt: str = "",
    timeout: float = 30.0,
) -> dict[str, Any] | None:
    """Upload bytes as a conversation attachment and return present metadata.

    Returns ``{"id", "url", "markdown", "mime", "name"}`` on success, or None
    when inputs are missing / upload fails (caller keeps model vision path).
    """
    uid = (user_id or "").strip()
    cid = (conversation_id or "").strip()
    if not uid or not cid:
        return None
    mime_s = (mime or "image/jpeg").strip().lower() or "image/jpeg"
    raw: bytes | None = image_bytes
    if raw is None:
        b64 = "".join((image_base64 or "").split())
        if not b64:
            return None
        try:
            raw = base64.b64decode(b64, validate=False)
        except Exception:  # noqa: BLE001
            logger.warning("present_image: invalid base64")
            return None
    if not raw:
        return None
    name = (filename or "").strip() or f"image{_ext_for_mime(mime_s)}"
    try:
        ref = openbot_api.upload_conversation_attachment(
            uid,
            cid,
            content_base64=base64.b64encode(raw).decode("ascii"),
            filename=name,
            mime=mime_s,
            timeout=timeout,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("present_image upload failed: %s", exc)
        return None
    aid = str(ref.get("id") or "").strip()
    if not aid:
        return None
    url = str(ref.get("url") or "").strip() or attachment_url(cid, aid)
    md = attachment_markdown(cid, aid, alt=alt)
    return {
        "id": aid,
        "url": url,
        "markdown": md,
        "mime": str(ref.get("mime") or mime_s),
        "name": str(ref.get("name") or name),
    }


def present_vision_for_chat(
    vision: dict[str, str] | None,
    *,
    user_id: str,
    conversation_id: str,
    filename: str = "",
    alt: str = "",
) -> str | None:
    """Convenience: upload a host_vision-style ``{mime, data}`` dict; return markdown."""
    if not isinstance(vision, dict):
        return None
    data = str(vision.get("data") or "")
    if not data:
        return None
    mime = str(vision.get("mime") or "image/jpeg")
    out = present_image_for_chat(
        user_id=user_id,
        conversation_id=conversation_id,
        image_base64=data,
        mime=mime,
        filename=filename,
        alt=alt,
    )
    if not out:
        return None
    return str(out.get("markdown") or "") or None
