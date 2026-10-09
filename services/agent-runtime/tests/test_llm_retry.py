"""Unit tests for transient LLM chat_completion retries (no pytest — runnable as script)."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.llm import (  # noqa: E402
    AutoToolChoiceUnsupported,
    LLMOverride,
    _llm_max_attempts,
    _llm_retry_delay_s,
    chat_completion,
    is_retryable_llm_error,
)


def _ok(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  OK  {msg}")


def test_retryable_classifier() -> None:
    _ok(is_retryable_llm_error(RuntimeError("upstream HTTP 429: slow down")), "429 retryable")
    _ok(is_retryable_llm_error(RuntimeError("upstream HTTP 503: unavailable")), "503 retryable")
    _ok(
        not is_retryable_llm_error(
            RuntimeError(
                "upstream HTTP 502: downstream request canceled before upstream response headers: context canceled"
            )
        ),
        "cancel-flavored 502 not retryable",
    )
    _ok(
        not is_retryable_llm_error(RuntimeError("upstream HTTP 502: context canceled")),
        "502 context canceled not retryable",
    )
    _ok(is_retryable_llm_error(RuntimeError("upstream HTTP 408: timeout")), "408 retryable")
    _ok(is_retryable_llm_error(RuntimeError("empty LLM completion (no choices)")), "empty choices retryable")
    _ok(is_retryable_llm_error(RuntimeError("LLM request timed out: ReadTimeout")), "timeout msg retryable")
    _ok(is_retryable_llm_error(RuntimeError("LLM connection error: reset")), "conn msg retryable")
    _ok(is_retryable_llm_error(httpx.ReadTimeout("x")), "ReadTimeout retryable")
    _ok(is_retryable_llm_error(httpx.ConnectError("x")), "ConnectError retryable")
    _ok(not is_retryable_llm_error(RuntimeError("upstream HTTP 401: unauthorized")), "401 not retryable")
    _ok(not is_retryable_llm_error(RuntimeError("upstream HTTP 400: bad request")), "400 not retryable")
    _ok(
        not is_retryable_llm_error(RuntimeError("upstream HTTP 400: context_length_exceeded")),
        "context length not retryable",
    )
    _ok(
        not is_retryable_llm_error(AutoToolChoiceUnsupported("upstream HTTP 400: enable-auto-tool-choice")),
        "AutoToolChoice not retryable",
    )
    _ok(_llm_retry_delay_s(1) == 0.4, "backoff attempt 1")
    _ok(_llm_retry_delay_s(2) == 0.8, "backoff attempt 2")


def _patch_client(handler):
    real = httpx.AsyncClient

    def factory(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    return patch("app.llm.httpx.AsyncClient", side_effect=factory)


async def _call() -> dict[str, Any]:
    return await chat_completion(
        [{"role": "user", "content": "hi"}],
        api_key="test-key",
        override=LLMOverride(
            base_url="http://llm.test/v1",
            api_key="test-key",
            model="test-model",
        ),
    )


async def test_retries_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503, text="unavailable")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]},
        )

    with _patch_client(handler), patch("app.llm.asyncio.sleep", new=AsyncSleep()):
        os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "3"
        try:
            data = await _call()
        finally:
            os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)
    _ok(calls["n"] == 3, f"three HTTP attempts (got {calls['n']})")
    _ok(data["choices"][0]["message"]["content"] == "ok", "final content after retries")


async def test_empty_choices_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json={"choices": []})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "recovered"}}]},
        )

    with _patch_client(handler), patch("app.llm.asyncio.sleep", new=AsyncSleep()):
        os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "3"
        try:
            data = await _call()
        finally:
            os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)
    _ok(calls["n"] == 2, f"empty then success (got {calls['n']})")
    _ok(data["choices"][0]["message"]["content"] == "recovered", "recovered content")


async def test_timeout_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "late"}}]},
        )

    with _patch_client(handler), patch("app.llm.asyncio.sleep", new=AsyncSleep()):
        os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "3"
        try:
            data = await _call()
        finally:
            os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)
    _ok(calls["n"] == 2, f"timeout then success (got {calls['n']})")
    _ok(data["choices"][0]["message"]["content"] == "late", "content after timeout retry")


async def test_auth_error_not_retried() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, text="unauthorized")

    with _patch_client(handler), patch("app.llm.asyncio.sleep", new=AsyncSleep()) as sleeper:
        os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "3"
        try:
            try:
                await _call()
            except RuntimeError as exc:
                _ok("401" in str(exc), f"surfaces 401 ({exc})")
            else:
                raise AssertionError("expected RuntimeError")
        finally:
            os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)
    _ok(calls["n"] == 1, f"auth fails once (got {calls['n']})")
    _ok(sleeper.calls == 0, "no backoff sleep on non-retryable")


async def test_exhausted_retries_raise() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(500, text="boom")

    with _patch_client(handler), patch("app.llm.asyncio.sleep", new=AsyncSleep()):
        os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "2"
        try:
            try:
                await _call()
            except RuntimeError as exc:
                _ok("500" in str(exc), f"surfaces final 500 ({exc})")
            else:
                raise AssertionError("expected RuntimeError")
        finally:
            os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)
    _ok(calls["n"] == 2, f"exhausted at max attempts (got {calls['n']})")


def test_max_attempts_env_clamp() -> None:
    os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "99"
    try:
        _ok(_llm_max_attempts() == 5, "clamp high to 5")
    finally:
        os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)
    os.environ["OPENBOT_LLM_MAX_ATTEMPTS"] = "0"
    try:
        _ok(_llm_max_attempts() == 1, "clamp low to 1")
    finally:
        os.environ.pop("OPENBOT_LLM_MAX_ATTEMPTS", None)


class AsyncSleep:
    def __init__(self) -> None:
        self.calls = 0
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.calls += 1
        self.delays.append(delay)


def main() -> None:
    print("test_llm_retry")
    test_retryable_classifier()
    test_max_attempts_env_clamp()
    asyncio.run(test_retries_then_succeeds())
    asyncio.run(test_empty_choices_then_succeeds())
    asyncio.run(test_timeout_then_succeeds())
    asyncio.run(test_auth_error_not_retried())
    asyncio.run(test_exhausted_retries_raise())
    print("all passed")


if __name__ == "__main__":
    main()
