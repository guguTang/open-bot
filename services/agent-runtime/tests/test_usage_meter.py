"""Token ledger phase 1: per-call rows, estimates, and no double count."""

from __future__ import annotations

from app.usage_meter import (
    attach_usage,
    build_call,
    call_kind,
    finalize_stream_call,
    note_call,
    stream_options_rejected,
    stream_request_payload,
    sum_calls,
)


def test_stream_without_usage_is_estimated() -> None:
    call = finalize_stream_call(
        messages=[{"role": "user", "content": "请用三句话解释 token 估算"}],
        output_text="第一句。第二句。第三句。",
        raw_usage=None,
        model="gpt-4o-mini",
        base_url="https://example.invalid/v1",
    )
    assert call["usage_source"] == "estimated"
    assert call["prompt_tokens"] > 0
    assert call["completion_tokens"] > 0
    assert call["total_tokens"] == call["prompt_tokens"] + call["completion_tokens"]
    assert call["call_kind"] == "chat"


def test_stream_with_usage_is_provider() -> None:
    call = finalize_stream_call(
        messages=[{"role": "user", "content": "hi"}],
        output_text="yo",
        raw_usage={
            "prompt_tokens": 11,
            "completion_tokens": 4,
            "total_tokens": 15,
            "prompt_tokens_details": {"cached_tokens": 3},
            "completion_tokens_details": {"reasoning_tokens": 1},
        },
        model="gpt-4o-mini",
        base_url="https://api.openai.com/v1",
    )
    assert call["usage_source"] == "provider"
    assert call["provider"] == "openai"
    assert call["prompt_tokens"] == 11
    assert call["cached_tokens"] == 3
    assert call["reasoning_tokens"] == 1
    assert call["total_tokens"] == 15


def test_calls_sum_matches_and_legacy_is_not_added() -> None:
    chat = build_call(
        call_kind="chat",
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "hello"}],
        output_text="world",
        raw_usage={"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
    )
    with call_kind("compress"):
        compress = build_call(
            call_kind="",
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "old turns"}],
            output_text="摘要",
            raw_usage={"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        )
    assert compress["call_kind"] == "compress"
    payload: dict = {}
    # done.usage already holds the tool-loop sum. It must not be added again.
    attach_usage(
        payload,
        calls=[chat, compress],
        legacy={"prompt_tokens": 999, "completion_tokens": 999, "total_tokens": 1998},
    )
    assert sum_calls(payload["usage_calls"]) == payload["usage"]
    assert payload["usage"]["prompt_tokens"] == 13
    assert payload["usage"]["total_tokens"] == 19
    assert len(payload["usage_calls"]) == 2


def test_vision_decision_embedding_are_distinct() -> None:
    vision = build_call(
        call_kind="chat",
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "看这张图"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
                ],
            }
        ],
        output_text="图里是一只猫",
        raw_usage={"prompt_tokens": 80, "completion_tokens": 6, "total_tokens": 86},
    )
    decision = build_call(
        call_kind="decision",
        model="microsoft/microsoft-decision-1",
        input_text="谁来回复这句群消息",
        raw_usage={"input_tokens": 20, "output_tokens": 1},
    )
    embedding = build_call(
        call_kind="embedding",
        model="bge-m3",
        input_text="记忆查询",
        raw_usage=None,
    )
    assert vision["call_kind"] == "vision"
    assert vision["prompt_tokens"] == 80
    assert decision["call_kind"] == "decision"
    assert decision["usage_source"] == "provider"
    assert decision["prompt_tokens"] == 20
    assert embedding["call_kind"] == "embedding"
    assert embedding["usage_source"] == "estimated"
    assert embedding["prompt_tokens"] > 0


def test_unknown_when_nothing_to_estimate() -> None:
    call = build_call(call_kind="chat", model="x", messages=[], output_text="", raw_usage=None)
    assert call["usage_source"] == "unknown"
    assert call["total_tokens"] == 0


def test_langfuse_failure_does_not_drop_calls() -> None:
    call = build_call(
        call_kind="chat",
        model="gpt-4o-mini",
        raw_usage={"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4},
    )

    def boom(_rows, _legacy):  # noqa: ANN001
        raise RuntimeError("langfuse unreachable")

    payload: dict = {}
    attach_usage(payload, calls=[call], legacy={"prompt_tokens": 9}, crosscheck=boom)
    assert payload["usage_calls"] == [call]
    assert payload["usage"]["total_tokens"] == 4


def test_stream_payload_requests_include_usage() -> None:
    payload = stream_request_payload("gpt-4o-mini", [{"role": "user", "content": "hi"}])
    assert payload["stream"] is True
    assert payload["stream_options"]["include_usage"] is True
    assert stream_options_rejected("upstream HTTP 400: unknown field stream_options")
    assert not stream_options_rejected("upstream HTTP 400: invalid json")


def test_note_call_inside_run_does_not_need_langfuse() -> None:
    from app.usage_meter import begin_run, end_run, snapshot

    tokens = begin_run({"user_id": "user-1"})
    try:
        note_call(
            build_call(
                call_kind="dream",
                model="gpt-4o-mini",
                input_text="整理记忆",
                raw_usage=None,
            )
        )
        rows = snapshot()
    finally:
        end_run(tokens)
    assert len(rows) == 1
    assert rows[0]["call_kind"] == "dream"
    assert rows[0]["usage_source"] == "estimated"
