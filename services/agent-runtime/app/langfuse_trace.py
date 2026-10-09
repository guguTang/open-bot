"""Langfuse v4 soft-fail tracing helpers for agent-runtime.

Enabled when LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY are set, or when
LANGFUSE_ENABLED=1 (still needs keys to actually send). Soft-fails on
import/init errors so chat never breaks.
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger(__name__)

_TRUNCATE = 12_000  # ~12KB; general IO (tool args, outputs)
_GEN_INPUT_TRUNCATE = 48_000  # generation prompts incl. system; still capped


_client: Any | None = None
_init_attempted = False
_disabled_reason: str | None = None


class _Noop:
    """Stand-in observation when tracing is off."""

    def update(self, *args: Any, **kwargs: Any) -> None:
        return None

    def end(self, *args: Any, **kwargs: Any) -> None:
        return None

    def event(self, *args: Any, **kwargs: Any) -> None:
        return None

    def start_as_current_observation(self, *args: Any, **kwargs: Any) -> Any:
        return _noop_cm()

    def __enter__(self) -> "_Noop":
        return self

    def __exit__(self, *args: Any) -> None:
        return None


@contextmanager
def _noop_cm() -> Iterator[_Noop]:
    yield _Noop()


def _env_truthy(name: str, default: str = "0") -> bool:
    raw = os.getenv(name)
    if raw is None:
        raw = default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def truncate(value: Any, limit: int = _TRUNCATE) -> Any:
    """Truncate strings / JSON-ish payloads for Langfuse IO fields."""
    if value is None:
        return None
    if isinstance(value, str):
        if len(value) <= limit:
            return value
        return value[:limit] + f"…[truncated {len(value) - limit} chars]"
    if isinstance(value, (bytes, bytearray)):
        return truncate(value.decode("utf-8", errors="replace"), limit)
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        used = 2
        for k, v in value.items():
            chunk = truncate(v, max(256, limit // 4))
            out[str(k)] = chunk
            used += len(str(k)) + len(str(chunk))
            if used >= limit:
                out["…"] = "truncated"
                break
        return out
    if isinstance(value, list):
        out_list: list[Any] = []
        used = 2
        for item in value:
            chunk = truncate(item, max(256, limit // 4))
            out_list.append(chunk)
            used += len(str(chunk))
            if used >= limit:
                out_list.append("…[truncated]")
                break
        return out_list
    text = str(value)
    return truncate(text, limit)


def _keys() -> tuple[str, str]:
    pub = (os.getenv("LANGFUSE_PUBLIC_KEY") or "").strip()
    sec = (os.getenv("LANGFUSE_SECRET_KEY") or "").strip()
    return pub, sec


def enabled() -> bool:
    """True when we should attempt tracing (keys present, or explicit enable)."""
    pub, sec = _keys()
    if pub and sec:
        return True
    if _env_truthy("LANGFUSE_ENABLED", "0"):
        return True
    return False


def status() -> dict[str, Any]:
    pub, sec = _keys()
    return {
        "langfuse_wanted": enabled(),
        "langfuse_has_keys": bool(pub and sec),
        "langfuse_base_url": (
            os.getenv("LANGFUSE_BASE_URL") or "http://127.0.0.1:3100"
        ).strip(),
        "langfuse_ready": _client is not None,
        "langfuse_disabled_reason": _disabled_reason,
    }


def get_langfuse() -> Any | None:
    """Lazy-init Langfuse client (SDK v4 get_client / Langfuse())."""
    global _client, _init_attempted, _disabled_reason
    if _client is not None:
        return _client
    if _init_attempted:
        return None
    _init_attempted = True

    if not enabled():
        _disabled_reason = "disabled (set LANGFUSE_PUBLIC_KEY+SECRET_KEY or LANGFUSE_ENABLED=1)"
        return None

    pub, sec = _keys()
    if not pub or not sec:
        _disabled_reason = "LANGFUSE_ENABLED=1 but keys missing"
        logger.warning("langfuse: %s", _disabled_reason)
        return None

    try:
        from langfuse import Langfuse  # SDK v4
    except Exception as e:  # noqa: BLE001
        _disabled_reason = f"import error: {e}"
        logger.warning("langfuse: import failed: %s", e)
        return None

    base = (os.getenv("LANGFUSE_BASE_URL") or "http://127.0.0.1:3100").strip()
    # Ensure env vars are set for get_client() callers elsewhere
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", pub)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", sec)
    os.environ.setdefault("LANGFUSE_BASE_URL", base)

    try:
        _client = Langfuse(
            public_key=pub,
            secret_key=sec,
            base_url=base,
        )
        _disabled_reason = None
        logger.info("langfuse: client ready base_url=%s", base)
        return _client
    except Exception as e:  # noqa: BLE001
        _disabled_reason = f"init error: {e}"
        logger.warning("langfuse: init failed: %s", e)
        return None


def _safe_update(obs: Any, **kwargs: Any) -> None:
    if obs is None or isinstance(obs, _Noop):
        return
    try:
        obs.update(**{k: v for k, v in kwargs.items() if v is not None})
    except Exception as e:  # noqa: BLE001
        logger.debug("langfuse update skipped: %s", e)


@contextmanager
def trace_run(
    conversation_id: str,
    agent_id: str,
    user_id: str | None,
    content: str,
    *,
    metadata: dict[str, Any] | None = None,
) -> Iterator[Any]:
    """Root observation for one /v1/runs request (name open-bot.run).

    Yields exactly once. Enter/exit are explicit so async SSE generators that
    span this CM never hit "generator didn't stop after throw()" from a
    second yield in except, or from cleanup raising during GeneratorExit.
    """
    client = get_langfuse()
    if client is None:
        yield _Noop()
        return

    meta = {
        "conversation_id": conversation_id,
        "agent_id": agent_id,
        "user_id": user_id or "",
        **(metadata or {}),
    }
    for bad in ("api_key", "system_prompt", "OPENAI_API_KEY"):
        meta.pop(bad, None)

    obs_cm: Any | None = None
    prop_cm: Any | None = None
    span: Any = _Noop()
    obs_entered = False
    prop_entered = False
    try:
        try:
            obs_cm = client.start_as_current_observation(
                as_type="span",
                name="open-bot.run",
                input={"content": truncate(content or ""), "conversation_id": conversation_id},
                metadata=meta,
            )
            span = obs_cm.__enter__()
            obs_entered = True
        except Exception as e:  # noqa: BLE001
            logger.debug("langfuse trace_run open failed: %s", e)
            obs_cm = None
            span = _Noop()
            obs_entered = False

        if obs_entered:
            try:
                from langfuse import propagate_attributes

                prop_cm = propagate_attributes(
                    user_id=(str(user_id).strip() or None) if user_id else None,
                    session_id=str(conversation_id) or None,
                    metadata={"agent_id": agent_id},
                )
                prop_cm.__enter__()
                prop_entered = True
            except Exception:  # noqa: BLE001
                prop_cm = None
                prop_entered = False

        try:
            yield span  # exactly once — never yield again in except
        except Exception:
            if obs_entered:
                _safe_update(span, level="ERROR")
            raise
    finally:
        exc_info = sys.exc_info()
        if prop_entered and prop_cm is not None:
            try:
                prop_cm.__exit__(*exc_info)
            except Exception as e:  # noqa: BLE001
                logger.debug("langfuse propagate exit skipped: %s", e)
        if obs_entered and obs_cm is not None:
            try:
                obs_cm.__exit__(*exc_info)
            except Exception as e:  # noqa: BLE001
                logger.debug("langfuse trace_run exit skipped: %s", e)


def _gen_input_limit() -> int:
    """Max chars for generation input payloads (env LANGFUSE_IO_TRUNCATE)."""
    raw = (os.getenv("LANGFUSE_IO_TRUNCATE") or "").strip()
    if raw.isdigit():
        return max(1024, int(raw))
    return _GEN_INPUT_TRUNCATE


def _redact_system_enabled() -> bool:
    """When true, replace system message bodies with an omit placeholder.

    Default **off** so local Langfuse debug shows full system text (persona /
    tools routing / memory / client_env). Set LANGFUSE_REDACT_SYSTEM=1 in
    shared/prod environments if prompts must stay out of traces.
    """
    return _env_truthy("LANGFUSE_REDACT_SYSTEM", "0")



def _flatten_message_content(content: Any) -> str:
    """Stringify chat content that may be a plain str or content-part list."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        bits: list[str] = []
        for part in content:
            if isinstance(part, dict):
                bits.append(str(part.get("text") or ""))
            else:
                bits.append(str(part))
        return "\n".join(b for b in bits if b)
    return str(content)


def _prepare_generation_input(input_messages: Any) -> Any:
    """Truncate generation input; optionally redact system role content.

    Never drops system messages entirely: either full (truncated) text or an
    explicit ``[omitted system prompt, N chars]`` placeholder when redacting.
    """
    if input_messages is None:
        return None
    limit = _gen_input_limit()
    redact = _redact_system_enabled()
    if isinstance(input_messages, list):
        safe_in: list[Any] = []
        for m in input_messages:
            if not isinstance(m, dict):
                safe_in.append(truncate(m, max(256, limit // 4)))
                continue
            role = str(m.get("role") or "")
            content = m.get("content")
            # Preserve extra keys (tool_calls etc.) lightly via role/content focus
            if role == "system" and redact:
                safe_in.append(
                    {
                        "role": "system",
                        "content": f"[omitted system prompt, {len(_flatten_message_content(content))} chars]",
                    }
                )
            elif role == "system":
                # Prefer keeping system text: half the budget (min 8KB when limit allows)
                sys_limit = max(256, min(limit, max(8_000, limit // 2)))
                entry = {k: v for k, v in m.items() if k != "content"}
                entry["role"] = "system"
                entry["content"] = truncate(_flatten_message_content(content), sys_limit)
                safe_in.append(entry)
            else:
                entry = {k: v for k, v in m.items() if k != "content"}
                entry["role"] = role
                entry["content"] = truncate(content, max(256, limit // 4))
                safe_in.append(entry)
        return truncate(safe_in, limit)
    return truncate(input_messages, limit)


# Back-compat alias (older tests / callers).
_redact_generation_input = _prepare_generation_input


@contextmanager
def observation_generation(
    *,
    name: str = "open-bot.llm",
    model: str | None = None,
    input_messages: Any = None,
    metadata: dict[str, Any] | None = None,
) -> Iterator[Any]:
    """Nested generation observation for the main LLM path.

    Yields exactly once; soft-fails to _Noop on open errors; swallows exit errors.
    """
    client = get_langfuse()
    if client is None:
        yield _Noop()
        return

    safe_in = _prepare_generation_input(input_messages)
    obs_cm: Any | None = None
    gen: Any = _Noop()
    entered = False
    try:
        try:
            obs_cm = client.start_as_current_observation(
                as_type="generation",
                name=name,
                model=model,
                input=safe_in,
                metadata=metadata or {},
            )
            gen = obs_cm.__enter__()
            entered = True
        except Exception as e:  # noqa: BLE001
            logger.debug("langfuse generation failed: %s", e)
            obs_cm = None
            gen = _Noop()
            entered = False
        yield gen  # exactly once
    finally:
        if entered and obs_cm is not None:
            try:
                obs_cm.__exit__(*sys.exc_info())
            except Exception as e:  # noqa: BLE001
                logger.debug("langfuse generation exit skipped: %s", e)


@contextmanager
def observation_tool(name: str, args: dict[str, Any] | None = None) -> Iterator[Any]:
    """Nested tool observation around a single tool_handler call.

    Yields exactly once; soft-fails to _Noop on open errors; swallows exit errors.
    """
    client = get_langfuse()
    if client is None:
        yield _Noop()
        return
    safe_args = truncate(args or {})
    obs_cm: Any | None = None
    tool_obs: Any = _Noop()
    entered = False
    try:
        try:
            obs_cm = client.start_as_current_observation(
                as_type="tool",
                name=f"tool:{name}",
                input={"name": name, "arguments": safe_args},
                metadata={"tool_name": name},
            )
            tool_obs = obs_cm.__enter__()
            entered = True
        except Exception as e:  # noqa: BLE001
            logger.debug("langfuse tool obs failed: %s", e)
            obs_cm = None
            tool_obs = _Noop()
            entered = False
        yield tool_obs  # exactly once
    finally:
        if entered and obs_cm is not None:
            try:
                obs_cm.__exit__(*sys.exc_info())
            except Exception as e:  # noqa: BLE001
                logger.debug("langfuse tool exit skipped: %s", e)



def event_status(phase: str, label: str | None = None) -> None:
    """Optional light-weight event for SSE status phases."""
    client = get_langfuse()
    if client is None:
        return
    try:
        client.create_event(
            name=f"status.{phase}",
            metadata={"phase": phase, "label": label or ""},
        )
    except Exception:  # noqa: BLE001
        try:
            # Fallback: update current span metadata
            client.update_current_span(metadata={"last_status": phase, "label": label or ""})
        except Exception:  # noqa: BLE001
            pass



def parse_usage_details(usage: Any) -> dict[str, int] | None:
    """Map OpenAI-compatible `usage` to Langfuse v4 generation usage_details.

    Accepts a dict or object with common fields:
      prompt_tokens / completion_tokens / total_tokens
      aliases: input_tokens, output_tokens, promptTokens, completionTokens,
               totalTokens, input, output, total

    Returns None when nothing usable is present (never invents fake zeros).
    Shape matches Langfuse Python SDK v4: Dict[str, int] with prompt_tokens /
    completion_tokens / total_tokens when available.
    """
    if usage is None:
        return None

    raw: dict[str, Any]
    if isinstance(usage, dict):
        raw = usage
    else:
        # Pydantic / SimpleNamespace / OpenAI SDK objects
        raw = {}
        for key in (
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "input_tokens",
            "output_tokens",
            "promptTokens",
            "completionTokens",
            "totalTokens",
            "input",
            "output",
            "total",
        ):
            if hasattr(usage, key):
                raw[key] = getattr(usage, key)
        # fallback: __dict__ without private attrs
        if not raw and hasattr(usage, "__dict__"):
            raw = {
                k: v
                for k, v in vars(usage).items()
                if not str(k).startswith("_")
            }

    if not isinstance(raw, dict) or not raw:
        return None

    def _as_int(val: Any) -> int | None:
        if val is None or isinstance(val, bool):
            return None
        if isinstance(val, (int, float)):
            # reject NaN / inf
            if isinstance(val, float) and (val != val or val in (float("inf"), float("-inf"))):
                return None
            return int(val)
        if isinstance(val, str) and val.strip().lstrip("-").isdigit():
            return int(val.strip())
        return None

    # alias groups → Langfuse/OpenAI canonical keys used by SDK examples
    prompt = _as_int(
        raw.get("prompt_tokens", raw.get("input_tokens", raw.get("promptTokens", raw.get("input"))))
    )
    completion = _as_int(
        raw.get(
            "completion_tokens",
            raw.get("output_tokens", raw.get("completionTokens", raw.get("output"))),
        )
    )
    total = _as_int(raw.get("total_tokens", raw.get("totalTokens", raw.get("total"))))

    out: dict[str, int] = {}
    if prompt is not None:
        out["prompt_tokens"] = prompt
    if completion is not None:
        out["completion_tokens"] = completion
    if total is not None:
        out["total_tokens"] = total
    elif prompt is not None and completion is not None:
        out["total_tokens"] = prompt + completion

    return out or None


def merge_usage_details(
    *parts: dict[str, int] | None,
) -> dict[str, int] | None:
    """Sum usage_details dicts (e.g. across tool-loop LLM rounds). None if empty."""
    acc: dict[str, int] = {}
    for part in parts:
        if not part:
            continue
        for k, v in part.items():
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                continue
            acc[k] = acc.get(k, 0) + int(v)
    return acc or None


def trace_id_of(obs: Any) -> str:
    """Best-effort Langfuse/OTEL trace id from a root observation (empty if noop/off)."""
    if obs is None or isinstance(obs, _Noop):
        return ""
    tid = getattr(obs, "trace_id", None)
    if isinstance(tid, str) and tid.strip():
        return tid.strip()
    return ""


def update_obs(obs: Any, **kwargs: Any) -> None:
    _safe_update(obs, **kwargs)


def flush() -> None:
    client = _client
    if client is None:
        return
    try:
        client.flush()
    except Exception as e:  # noqa: BLE001
        logger.debug("langfuse flush skipped: %s", e)
