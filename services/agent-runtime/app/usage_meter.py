"""Per-call usage ledger for one runtime turn.

Calls recorded here are the detail rows (usage_calls). The done SSE usage
object is their sum. Callers must not also add a separate accumulator.

Provider numbers win when the gateway returns them. Otherwise this module
uses compact.estimate_tokens. A call that cannot be estimated is
usage_source=unknown with empty cost (the API prices unknown as unpriced).

Langfuse is an optional cross-check. A failure there must not drop the calls.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator
from urllib.parse import urlparse

from .compact import estimate_messages_tokens, estimate_tokens

logger = logging.getLogger("open-bot.usage")

SOURCE_PROVIDER = "provider"
SOURCE_ESTIMATED = "estimated"
SOURCE_UNKNOWN = "unknown"

KIND_CHAT = "chat"
KIND_COMPRESS = "compress"
KIND_DECISION = "decision"
KIND_VISION = "vision"
KIND_EMBEDDING = "embedding"
KIND_DREAM = "dream"
KIND_MEM0 = "mem0"

_ledger: ContextVar[list[dict[str, Any]] | None] = ContextVar("usage_ledger", default=None)
_kind: ContextVar[str] = ContextVar("usage_call_kind", default=KIND_CHAT)
_actor: ContextVar[dict[str, str] | None] = ContextVar("usage_actor", default=None)

DEFAULT_API_URL = "http://127.0.0.1:18080"
DEFAULT_INTERNAL_TOKEN = "open-bot-dev-internal"


def begin_run(actor: dict[str, Any] | None = None) -> tuple[Any, Any]:
    """Start collecting calls for the current task. Returns reset tokens."""
    clean = {k: str(v or "").strip() for k, v in (actor or {}).items()}
    return _actor.set(clean), _ledger.set([])


def end_run(tokens: tuple[Any, Any] | None) -> None:
    if not tokens:
        return
    actor_tok, ledger_tok = tokens
    _ledger.reset(ledger_tok)
    _actor.reset(actor_tok)


def snapshot() -> list[dict[str, Any]]:
    rows = _ledger.get()
    if not rows:
        return []
    return [dict(row) for row in rows]


@contextmanager
def call_kind(kind: str) -> Iterator[None]:
    token = _kind.set((kind or KIND_CHAT).strip() or KIND_CHAT)
    try:
        yield
    finally:
        _kind.reset(token)


def current_kind() -> str:
    return (_kind.get() or KIND_CHAT).strip() or KIND_CHAT


def provider_from_base(base_url: str) -> str:
    host = (urlparse(base_url or "").hostname or "").lower()
    blob = f"{host} {(base_url or '').lower()}"
    for needle, name in (
        ("openrouter", "openrouter"),
        ("anthropic", "anthropic"),
        ("deepseek", "deepseek"),
        ("dashscope", "dashscope"),
        ("aliyuncs", "dashscope"),
        ("bigmodel", "zhipu"),
        ("zhipuai", "zhipu"),
        ("generativelanguage", "google"),
        ("googleapis", "google"),
        ("azure", "azure"),
        ("openai", "openai"),
    ):
        if needle in blob:
            return name
    return host or "openai_compatible"


def messages_have_images(messages: list[dict[str, Any]] | None) -> bool:
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and str(part.get("type") or "") in ("image_url", "image"):
                    return True
    return False


def _as_int(val: Any) -> int | None:
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        if isinstance(val, float) and (val != val or val in (float("inf"), float("-inf"))):
            return None
        return int(val)
    if isinstance(val, str) and val.strip().lstrip("-").isdigit():
        return int(val.strip())
    return None


def _nested_int(raw: dict[str, Any], parent: str, child: str) -> int | None:
    block = raw.get(parent)
    if isinstance(block, dict):
        return _as_int(block.get(child))
    return None


def parse_provider_usage(raw: Any) -> dict[str, int] | None:
    """Official token fields. None when the gateway omitted them."""
    if not isinstance(raw, dict) or not raw:
        return None
    prompt = _as_int(raw.get("prompt_tokens", raw.get("input_tokens")))
    completion = _as_int(raw.get("completion_tokens", raw.get("output_tokens")))
    total = _as_int(raw.get("total_tokens"))
    cached = _as_int(raw.get("cached_tokens"))
    if cached is None:
        cached = _as_int(raw.get("cache_read_input_tokens"))
    if cached is None:
        cached = _nested_int(raw, "prompt_tokens_details", "cached_tokens")
    if cached is None:
        cached = _nested_int(raw, "input_tokens_details", "cached_tokens")
    reasoning = _as_int(raw.get("reasoning_tokens"))
    if reasoning is None:
        reasoning = _nested_int(raw, "completion_tokens_details", "reasoning_tokens")
    if reasoning is None:
        reasoning = _nested_int(raw, "output_tokens_details", "reasoning_tokens")
    if prompt is None and completion is None and total is None:
        return None
    out: dict[str, int] = {}
    if prompt is not None:
        out["prompt_tokens"] = max(0, prompt)
    if completion is not None:
        out["completion_tokens"] = max(0, completion)
    if cached is not None:
        out["cached_tokens"] = max(0, cached)
    if reasoning is not None:
        out["reasoning_tokens"] = max(0, reasoning)
    if total is not None:
        out["total_tokens"] = max(0, total)
    elif "prompt_tokens" in out or "completion_tokens" in out:
        out["total_tokens"] = out.get("prompt_tokens", 0) + out.get("completion_tokens", 0)
    return out or None


def _message_text(messages: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    flat: list[dict[str, Any]] = []
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, list):
            bits: list[str] = []
            for part in content:
                if isinstance(part, dict):
                    if str(part.get("type") or "") in ("image_url", "image"):
                        continue
                    bits.append(str(part.get("text") or ""))
                else:
                    bits.append(str(part))
            text = "\n".join(b for b in bits if b)
        else:
            text = str(content or "")
        for tc in message.get("tool_calls") or []:
            if isinstance(tc, dict):
                fn = tc.get("function") or {}
                text += "\n" + str(fn.get("name") or "") + str(fn.get("arguments") or "")
        flat.append({"role": message.get("role") or "", "content": text})
    return flat


def estimate_chat(messages: list[dict[str, Any]] | None, output_text: str) -> dict[str, int] | None:
    prompt = estimate_messages_tokens(_message_text(messages))
    completion = estimate_tokens(output_text or "")
    if prompt <= 0 and completion <= 0:
        return None
    return {
        "prompt_tokens": max(0, prompt),
        "completion_tokens": max(0, completion),
        "total_tokens": max(0, prompt) + max(0, completion),
    }


def _completion_text(data: dict[str, Any] | None) -> str:
    if not isinstance(data, dict):
        return ""
    choices = data.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return ""
    msg = choices[0].get("message") or {}
    content = msg.get("content") or ""
    if isinstance(content, list):
        bits = []
        for part in content:
            if isinstance(part, dict):
                bits.append(str(part.get("text") or ""))
            else:
                bits.append(str(part))
        text = "\n".join(bits)
    else:
        text = str(content)
    for tc in msg.get("tool_calls") or []:
        if isinstance(tc, dict):
            fn = tc.get("function") or {}
            text += "\n" + str(fn.get("name") or "") + str(fn.get("arguments") or "")
    return text


def build_call(
    *,
    call_kind: str,
    model: str,
    provider: str = "",
    llm_connection_id: str = "",
    messages: list[dict[str, Any]] | None = None,
    output_text: str = "",
    raw_usage: Any = None,
    input_text: str = "",
) -> dict[str, Any]:
    kind = (call_kind or current_kind() or KIND_CHAT).strip() or KIND_CHAT
    if kind == KIND_CHAT and messages_have_images(messages):
        kind = KIND_VISION
    official = parse_provider_usage(raw_usage)
    if official is not None:
        row = {
            "call_kind": kind,
            "model": model or "",
            "provider": provider or "",
            "llm_connection_id": llm_connection_id or "",
            "usage_source": SOURCE_PROVIDER,
            "prompt_tokens": official.get("prompt_tokens", 0),
            "completion_tokens": official.get("completion_tokens", 0),
            "cached_tokens": official.get("cached_tokens", 0),
            "reasoning_tokens": official.get("reasoning_tokens", 0),
            "total_tokens": official.get("total_tokens", 0),
        }
        if row["total_tokens"] <= 0:
            row["total_tokens"] = row["prompt_tokens"] + row["completion_tokens"]
        if row["prompt_tokens"] == 0 and row["completion_tokens"] == 0 and row["total_tokens"] == 0:
            row["usage_source"] = SOURCE_UNKNOWN
        return row
    estimated = estimate_chat(messages, output_text)
    if estimated is None and input_text:
        n = estimate_tokens(input_text)
        if n > 0:
            estimated = {"prompt_tokens": n, "completion_tokens": 0, "total_tokens": n}
    if estimated is None:
        return {
            "call_kind": kind,
            "model": model or "",
            "provider": provider or "",
            "llm_connection_id": llm_connection_id or "",
            "usage_source": SOURCE_UNKNOWN,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cached_tokens": 0,
            "reasoning_tokens": 0,
            "total_tokens": 0,
        }
    return {
        "call_kind": kind,
        "model": model or "",
        "provider": provider or "",
        "llm_connection_id": llm_connection_id or "",
        "usage_source": SOURCE_ESTIMATED,
        "prompt_tokens": estimated.get("prompt_tokens", 0),
        "completion_tokens": estimated.get("completion_tokens", 0),
        "cached_tokens": 0,
        "reasoning_tokens": 0,
        "total_tokens": estimated.get("total_tokens", 0),
    }


def note_call(call: dict[str, Any], *, actor: dict[str, Any] | None = None) -> None:
    """Append to the open run, or post a standalone run. Never raises."""
    try:
        led = _ledger.get()
        if led is not None:
            led.append(dict(call))
            return
        _post_orphan(call, actor)
    except Exception:  # noqa: BLE001
        logger.debug("usage note failed", exc_info=True)


def record_chat_result(
    *,
    data: dict[str, Any] | None,
    messages: list[dict[str, Any]] | None,
    model: str,
    base_url: str,
    llm_connection_id: str = "",
    call_kind_name: str | None = None,
    actor: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raw = None
    if isinstance(data, dict):
        usage = data.get("usage")
        if isinstance(usage, dict) and usage:
            raw = usage
    call = build_call(
        call_kind=call_kind_name or current_kind(),
        model=model,
        provider=provider_from_base(base_url),
        llm_connection_id=llm_connection_id,
        messages=messages,
        output_text=_completion_text(data),
        raw_usage=raw,
    )
    note_call(call, actor=actor)
    return call


def record_text_call(
    *,
    call_kind_name: str,
    model: str,
    base_url: str,
    messages: list[dict[str, Any]] | None = None,
    output_text: str = "",
    input_text: str = "",
    raw_usage: Any = None,
    actor: dict[str, Any] | None = None,
    llm_connection_id: str = "",
) -> dict[str, Any]:
    call = build_call(
        call_kind=call_kind_name,
        model=model,
        provider=provider_from_base(base_url),
        llm_connection_id=llm_connection_id,
        messages=messages,
        output_text=output_text,
        input_text=input_text,
        raw_usage=raw_usage,
    )
    note_call(call, actor=actor)
    return call


def sum_calls(calls: list[dict[str, Any]] | None) -> dict[str, int] | None:
    if not calls:
        return None
    acc = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "cached_tokens": 0,
        "reasoning_tokens": 0,
        "total_tokens": 0,
    }
    for call in calls:
        for key in acc:
            acc[key] += int(call.get(key) or 0)
    return acc


def attach_usage(
    payload: dict[str, Any],
    *,
    legacy: Any = None,
    calls: list[dict[str, Any]] | None = None,
    crosscheck: Any = None,
) -> dict[str, Any]:
    """Put per-call rows on a done payload. The usage field is their sum.

    A legacy aggregate is not added on top of the calls. Langfuse cross-check
    failures are swallowed.
    """
    rows = list(calls if calls is not None else snapshot())
    try:
        if crosscheck is not None:
            crosscheck(rows, legacy)
        elif legacy is not None and rows:
            _default_crosscheck(rows, legacy)
    except Exception:  # noqa: BLE001
        logger.debug("langfuse usage cross-check failed", exc_info=True)
    if rows:
        payload["usage_calls"] = rows
        summed = sum_calls(rows)
        if summed:
            payload["usage"] = summed
        return payload
    official = parse_provider_usage(legacy) if not isinstance(legacy, dict) else None
    if isinstance(legacy, dict):
        # Keep the legacy shape (tests compare it) when there are no call rows.
        kept = {}
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            n = _as_int(legacy.get(key))
            if n is not None:
                kept[key] = n
        if "total_tokens" not in kept and ("prompt_tokens" in kept or "completion_tokens" in kept):
            kept["total_tokens"] = kept.get("prompt_tokens", 0) + kept.get("completion_tokens", 0)
        if kept:
            payload["usage"] = kept
    elif official:
        payload["usage"] = official
    return payload


def _default_crosscheck(calls: list[dict[str, Any]], legacy: Any) -> None:
    official = parse_provider_usage(legacy) if isinstance(legacy, dict) else None
    if not official:
        return
    summed = sum_calls(calls) or {}
    if summed.get("total_tokens") != official.get("total_tokens"):
        logger.info(
            "usage cross-check differs ledger=%s langfuse_or_legacy=%s",
            summed.get("total_tokens"),
            official.get("total_tokens"),
        )


def stream_request_payload(model: str, messages: list[dict[str, Any]], *, include_usage: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {"model": model, "stream": True, "messages": messages}
    if include_usage:
        payload["stream_options"] = {"include_usage": True}
    return payload


def stream_options_rejected(message: str) -> bool:
    m = (message or "").lower()
    return "stream_options" in m or "include_usage" in m


def finalize_stream_call(
    *,
    messages: list[dict[str, Any]] | None,
    output_text: str,
    raw_usage: Any,
    model: str,
    base_url: str,
    llm_connection_id: str = "",
    call_kind_name: str | None = None,
) -> dict[str, Any]:
    return build_call(
        call_kind=call_kind_name or current_kind(),
        model=model,
        provider=provider_from_base(base_url),
        llm_connection_id=llm_connection_id,
        messages=messages,
        output_text=output_text,
        raw_usage=raw_usage,
    )


def _api_base() -> str:
    return (os.getenv("OPENBOT_API_URL") or os.getenv("API_BASE_URL") or DEFAULT_API_URL).rstrip("/")


def _internal_token() -> str:
    return (
        (os.getenv("INTERNAL_TOKEN") or os.getenv("OPENBOT_INTERNAL_TOKEN") or DEFAULT_INTERNAL_TOKEN)
        .strip()
        or DEFAULT_INTERNAL_TOKEN
    )


def _post_orphan(call: dict[str, Any], actor: dict[str, Any] | None) -> None:
    who = actor or _actor.get() or {}
    user_id = str(who.get("user_id") or "").strip()
    if not user_id:
        return
    body = {
        "user_id": user_id,
        "agent_id": str(who.get("agent_id") or ""),
        "conversation_id": str(who.get("conversation_id") or ""),
        "source": str(call.get("call_kind") or "chat"),
        "calls": [call],
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{_api_base()}/internal/usage",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": _internal_token(),
            "Accept": "application/json",
        },
    )

    def _send() -> None:
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                resp.read()
        except Exception:  # noqa: BLE001
            logger.debug("usage post failed", exc_info=True)

    threading.Thread(target=_send, daemon=True, name="usage-post").start()


# urllib.error is imported so tests can raise URLError without a second import.
_ = urllib.error
