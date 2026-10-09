"""Multi-model compatibility for OpenAI-compatible /v1/chat/completions gateways.

Detects model family (GPT chat / reasoning, Claude, Qwen, DeepSeek, generic compat)
and adapts payloads (reasoning_effort, tool_choice, temperature) plus light
post-processing (strip <think> tags).
"""

from __future__ import annotations

import os
import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Any


_THINK_BLOCK = re.compile(
    r"<(?:think|thinking|redacted_thinking)\b[^>]*>[\s\S]*?</(?:think|thinking|redacted_thinking)>",
    re.IGNORECASE,
)
# Unclosed reasoning runs through the rest of the reply (common when the close tag is missing).
_THINK_UNCLOSED = re.compile(
    r"<(?:think|thinking|redacted_thinking)\b[^>]*>[\s\S]*$",
    re.IGNORECASE,
)
# Trailing partial open tag while a stream is still arriving ("<thi").
_THINK_PARTIAL = re.compile(
    r"<(?:think|thinking|redacted_thinking)\b[^>]*$",
    re.IGNORECASE,
)


def strip_think_tags(text: str) -> str:
    """Remove reasoning blocks so they are not shown or stored as the reply.

    Covers <think>, <thinking>, and <redacted_thinking>, including an unclosed
    block. A reply that is only reasoning becomes empty — do not fall back to
    the original text (that leaked the tags into chat history).
    """
    if not text:
        return text
    cleaned = _THINK_BLOCK.sub("", text)
    cleaned = _THINK_UNCLOSED.sub("", cleaned)
    cleaned = _THINK_PARTIAL.sub("", cleaned)
    return cleaned.strip()


def detect_family(model: str, base_url: str = "") -> str:
    """Normalize model + base_url to a family key.

    Families: openai_chat | openai_reasoning | anthropic | qwen | deepseek | compat
    """
    m = (model or "").strip().lower()
    u = (base_url or "").strip().lower()

    # URL hints (opaque model ids on known gateways)
    if "anthropic.com" in u:
        return "anthropic"
    if "dashscope" in u or "aliyuncs.com" in u:
        return "qwen"
    if "deepseek.com" in u:
        return "deepseek"
    if "moonshot.cn" in u or "kimi" in u:
        return "openai_chat"
    if "api.openai.com" in u and not m:
        return "openai_chat"

    if not m:
        return "compat"

    # Vendor substrings
    if m.startswith("claude") or "claude" in m:
        return "anthropic"
    if m.startswith("kimi") or "moonshot" in m:
        return "openai_chat"
    if m.startswith("qwen") or m.startswith("qwq") or "qwen" in m or "qwq" in m:
        return "qwen"
    if m.startswith("deepseek") or "deepseek" in m:
        return "deepseek"

    # OpenAI reasoning / thinking (before generic gpt-*)
    if (
        m.startswith(("o1", "o3", "o4"))
        or m.startswith("gpt-5")
        or "luna" in m
        or "-thinking" in m
        or "reasoning" in m
    ):
        return "openai_reasoning"

    # OpenAI chat
    if (
        m.startswith("gpt-4")
        or m.startswith("gpt-3.5")
        or m.startswith("gpt-3")
        or m.startswith("chatgpt")
        or (m.startswith("gpt-") and "luna" not in m and not m.startswith("gpt-5"))
    ):
        return "openai_chat"

    return "compat"


@dataclass
class ModelProfile:
    family: str
    supports_tools: bool = True
    tool_choice_auto: bool = True
    reasoning_effort_with_tools: str | None = None
    reasoning_effort_default: str | None = None
    strip_think_tags: bool = False
    drop_temperature_with_tools: bool = False
    notes: str = ""


def _default_profile(family: str) -> ModelProfile:
    if family == "openai_chat":
        return ModelProfile(
            family=family,
            supports_tools=True,
            tool_choice_auto=True,
            reasoning_effort_with_tools=None,
            reasoning_effort_default=None,
            strip_think_tags=False,
            drop_temperature_with_tools=False,
            notes="OpenAI chat (gpt-4o / gpt-4.1 / chatgpt)",
        )
    if family == "openai_reasoning":
        return ModelProfile(
            family=family,
            supports_tools=True,
            tool_choice_auto=True,
            reasoning_effort_with_tools="none",
            reasoning_effort_default=None,
            strip_think_tags=False,
            drop_temperature_with_tools=True,
            notes="OpenAI reasoning (o1/o3/gpt-5/luna); tools need reasoning_effort=none",
        )
    if family == "anthropic":
        return ModelProfile(
            family=family,
            supports_tools=True,
            tool_choice_auto=True,
            reasoning_effort_with_tools=None,
            reasoning_effort_default=None,
            strip_think_tags=False,
            drop_temperature_with_tools=False,
            notes="Claude via OpenAI-compatible gateway (not native Messages API)",
        )
    if family == "qwen":
        return ModelProfile(
            family=family,
            supports_tools=True,
            tool_choice_auto=False,
            reasoning_effort_with_tools=None,
            reasoning_effort_default=None,
            strip_think_tags=True,
            drop_temperature_with_tools=False,
            notes="Qwen / DashScope / vLLM; omit tool_choice=auto; strip <think>",
        )
    if family == "deepseek":
        return ModelProfile(
            family=family,
            supports_tools=True,
            tool_choice_auto=True,
            reasoning_effort_with_tools=None,
            reasoning_effort_default=None,
            strip_think_tags=True,
            drop_temperature_with_tools=False,
            notes="DeepSeek; strip <think> if present",
        )
    return ModelProfile(
        family="compat",
        supports_tools=True,
        tool_choice_auto=False,
        reasoning_effort_with_tools=None,
        reasoning_effort_default=None,
        strip_think_tags=True,
        drop_temperature_with_tools=False,
        notes="Generic OpenAI-compatible / vLLM; omit tool_choice=auto",
    )


def profile_for(model: str, base_url: str = "") -> ModelProfile:
    """Build a ModelProfile with env overrides applied."""
    forced = (os.getenv("OPENAI_MODEL_FAMILY") or "").strip().lower()
    if forced in (
        "openai_chat",
        "openai_reasoning",
        "anthropic",
        "qwen",
        "deepseek",
        "compat",
    ):
        family = forced
    else:
        family = detect_family(model, base_url)

    profile = _default_profile(family)

    if "OPENAI_REASONING_EFFORT" in os.environ:
        general = (os.getenv("OPENAI_REASONING_EFFORT") or "").strip()
        profile.reasoning_effort_default = general or None
    if "OPENAI_REASONING_EFFORT_WITH_TOOLS" in os.environ:
        with_tools = (os.getenv("OPENAI_REASONING_EFFORT_WITH_TOOLS") or "").strip()
        profile.reasoning_effort_with_tools = with_tools or None

    if "OPENAI_TOOL_CHOICE_AUTO" in os.environ:
        v = (os.getenv("OPENAI_TOOL_CHOICE_AUTO") or "").strip().lower()
        if v in ("0", "false", "no", "off"):
            profile.tool_choice_auto = False
        elif v in ("1", "true", "yes", "on"):
            profile.tool_choice_auto = True

    return profile


def adapt_chat_payload(
    payload: dict[str, Any],
    *,
    has_tools: bool,
    profile: ModelProfile,
) -> dict[str, Any]:
    """Copy and adapt a chat/completions payload for the model profile."""
    out = deepcopy(payload)

    if has_tools and profile.reasoning_effort_with_tools:
        out["reasoning_effort"] = profile.reasoning_effort_with_tools
    elif (not has_tools) and profile.reasoning_effort_default:
        out["reasoning_effort"] = profile.reasoning_effort_default

    # Never send empty reasoning_effort
    if "reasoning_effort" in out and not str(out.get("reasoning_effort") or "").strip():
        out.pop("reasoning_effort", None)

    if has_tools and not profile.tool_choice_auto:
        if out.get("tool_choice") == "auto":
            out.pop("tool_choice", None)

    if has_tools and profile.drop_temperature_with_tools:
        out.pop("temperature", None)
        out.pop("top_p", None)

    return out



# Prompt-cache modes for OpenAI-compatible gateways (Anthropic-style blocks or OpenAI key).
# OPENBOT_PROMPT_CACHE: auto | off | 0 | blocks | key | anthropic | openai
_PROMPT_CACHE_DISABLED = False  # set True after a live 400 rejecting cache fields


def mark_prompt_cache_unsupported() -> None:
    """Disable prompt-cache injection for this process after a gateway rejection."""
    global _PROMPT_CACHE_DISABLED
    _PROMPT_CACHE_DISABLED = True


def prompt_cache_disabled() -> bool:
    return _PROMPT_CACHE_DISABLED


def resolve_prompt_cache_mode(
    model: str = "",
    base_url: str = "",
    *,
    profile: ModelProfile | None = None,
) -> str:
    """Return "blocks", "key", or "off".

    - blocks: system content parts with cache_control (Anthropic / many Claude gateways)
    - key: top-level prompt_cache_key (OpenAI-compatible)
    - off: no-op
    """
    if _PROMPT_CACHE_DISABLED:
        return "off"
    raw = (os.getenv("OPENBOT_PROMPT_CACHE") or "auto").strip().lower()
    if raw in ("0", "false", "no", "off", "none"):
        return "off"
    if raw in ("blocks", "anthropic", "cache_control"):
        return "blocks"
    if raw in ("key", "openai", "prompt_cache_key"):
        return "key"
    if raw not in ("", "auto", "1", "true", "yes", "on"):
        return "off"

    fam = (profile.family if profile is not None else detect_family(model, base_url))
    u = (base_url or "").strip().lower()
    if fam == "anthropic" or "anthropic.com" in u or "claude" in u:
        return "blocks"
    # OpenRouter / LiteLLM often forward Anthropic cache_control for Claude ids.
    m = (model or "").strip().lower()
    if "claude" in m and ("openrouter" in u or "litellm" in u or "anthropic" in u):
        return "blocks"
    if fam in ("openai_chat", "openai_reasoning") or "api.openai.com" in u:
        return "key"
    return "off"


def is_prompt_cache_reject(message: str) -> bool:
    """True when upstream 400 suggests cache_control / prompt_cache_key is unknown."""
    m = (message or "").lower()
    needles = (
        "cache_control",
        "prompt_cache_key",
        "unknown field",
        "unrecognized field",
        "extra inputs are not permitted",
        "additional properties",
    )
    if not any(n in m for n in needles):
        return False
    # Prefer cache-related rejections; avoid treating unrelated schema errors as cache.
    return "cache" in m or "prompt_cache" in m


def postprocess_text(text: str, profile: ModelProfile) -> str:
    """Post-process assistant text according to profile flags."""
    if not text:
        return text
    if profile.strip_think_tags:
        return strip_think_tags(text)
    return text
