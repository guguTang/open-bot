"""Unit tests: static/dynamic system split + tool-result fold/truncation."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.llm import (  # noqa: E402
    SYSTEM_PERSONA_BASE,
    assemble_llm_messages,
    build_system_prompt,
    build_system_prompt_parts,
    fold_tool_results_in_messages,
    message_payload_chars,
    truncate_tool_result_for_context,
)
from app.model_compat import (  # noqa: E402
    is_prompt_cache_reject,
    resolve_prompt_cache_mode,
)


def test_split_static_before_dynamic() -> None:
    static, dynamic = build_system_prompt_parts(
        agent_id="bot-a",
        skills_catalog="- skill-x: do x",
        memory_snippets=["记得用户喜欢简短回复"],
        tools_enabled=True,
        available_tool_names=["load_skill", "host_shell", "list_machines", "defer_work"],
        persona_override="你是代号 Alpha 的助手。",
        lessons_block="## 已确认教训\n- 先 list_machines",
    )
    assert static.startswith(SYSTEM_PERSONA_BASE[:20]) or SYSTEM_PERSONA_BASE in static
    assert "你是代号 Alpha 的助手。" in static
    assert "长任务" in static
    assert "defer_work" in static
    # Dynamic holds per-session bits
    assert "agent_id: bot-a" in dynamic
    assert "skill-x" in dynamic
    assert "记得用户喜欢简短回复" in dynamic
    assert "已确认教训" in dynamic
    # Joined prompt keeps static prefix first (cache-friendly)
    joined = build_system_prompt(
        agent_id="bot-a",
        skills_catalog="- skill-x: do x",
        memory_snippets=["记得用户喜欢简短回复"],
        tools_enabled=True,
        available_tool_names=["load_skill", "host_shell", "list_machines", "defer_work"],
        persona_override="你是代号 Alpha 的助手。",
        lessons_block="## 已确认教训\n- 先 list_machines",
    )
    assert joined.index(SYSTEM_PERSONA_BASE[:12]) < joined.index("agent_id: bot-a")
    assert joined.index("你是代号 Alpha") < joined.index("记得用户喜欢")


def test_drop_redundant_tool_name_prose() -> None:
    prompt = build_system_prompt(
        agent_id="bot",
        skills_catalog="（无）",
        memory_snippets=[],
        tools_enabled=True,
        available_tool_names=[
            "get_current_time",
            "calculator",
            "load_skill",
            "mcp__echo__ping",
        ],
    )
    assert "内置工具：" not in prompt
    assert "可用 MCP 工具：" not in prompt
    assert "以 tools 列表为准" in prompt


def test_assemble_split_with_cache_blocks() -> None:
    msgs = assemble_llm_messages(
        "ignored-when-split",
        [
            {"role": "system", "content": "[对话摘要] older"},
            {"role": "user", "content": "hi"},
        ],
        static_system="STATIC_RULES",
        dynamic_system="DYNAMIC_MEM",
        prompt_cache_mode="blocks",
    )
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    content = msgs[0]["content"]
    assert isinstance(content, list)
    assert content[0]["text"] == "STATIC_RULES"
    assert content[0].get("cache_control") == {"type": "ephemeral"}
    assert "DYNAMIC_MEM" in content[1]["text"]
    assert "对话摘要" in content[1]["text"]
    assert sum(1 for m in msgs if m["role"] == "system") == 1


def test_assemble_split_plain_string_default() -> None:
    msgs = assemble_llm_messages(
        "",
        [{"role": "user", "content": "x"}],
        static_system="S",
        dynamic_system="D",
        prompt_cache_mode="off",
    )
    assert msgs[0]["content"] == "S\n\nD"


def test_truncate_and_fold_reduces_size() -> None:
    huge = "H" * 100 + "M" * 20_000 + "T" * 100
    truncated = truncate_tool_result_for_context(huge, limit=400, head=100, tail=100)
    assert len(truncated) < len(huge)
    assert truncated.startswith("H" * 100)
    assert truncated.endswith("T" * 100)
    assert "truncated" in truncated

    msgs = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "go"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "1"}]},
        {"role": "tool", "tool_call_id": "1", "name": "host_shell", "content": "OLD" + "X" * 15_000},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "2"}]},
        {"role": "tool", "tool_call_id": "2", "name": "host_shell", "content": "NEW" + "Y" * 15_000},
    ]
    before = message_payload_chars(msgs)
    folded = fold_tool_results_in_messages(msgs, keep_recent_full=1)
    after = message_payload_chars(folded)
    assert after < before
    # Older tool result folded tighter than the newest
    old_c = str(folded[3]["content"])
    new_c = str(folded[5]["content"])
    assert len(old_c) < len(new_c)
    assert "truncated" in old_c
    assert "truncated" in new_c
    # Idempotent
    again = fold_tool_results_in_messages(folded, keep_recent_full=1)
    assert message_payload_chars(again) == after


def test_prompt_cache_mode_probe_graceful() -> None:
    os.environ["OPENBOT_PROMPT_CACHE"] = "off"
    try:
        assert resolve_prompt_cache_mode("claude-3", "https://api.anthropic.com") == "off"
    finally:
        os.environ.pop("OPENBOT_PROMPT_CACHE", None)

    os.environ["OPENBOT_PROMPT_CACHE"] = "auto"
    try:
        assert resolve_prompt_cache_mode("claude-3-5", "https://api.anthropic.com") == "blocks"
        assert resolve_prompt_cache_mode("gpt-4o", "https://api.openai.com/v1") == "key"
        assert resolve_prompt_cache_mode("qwen2.5", "http://127.0.0.1:8000/v1") == "off"
    finally:
        os.environ.pop("OPENBOT_PROMPT_CACHE", None)

    assert is_prompt_cache_reject('unknown field "cache_control"')
    assert is_prompt_cache_reject("Extra inputs are not permitted: prompt_cache_key")
    assert not is_prompt_cache_reject("model not found")


def test_size_report_static_vs_full() -> None:
    """Document before/after style sizes for the split (informational asserts)."""
    names = [
        "load_skill",
        "host_shell",
        "host_ls",
        "list_machines",
        "defer_work",
        "get_current_time",
        "calculator",
        "http_fetch",
        "sandbox_shell",
        "sandbox_ls",
    ]
    static, dynamic = build_system_prompt_parts(
        agent_id="open-bot",
        skills_catalog="\n".join(f"- skill-{i}: desc {i}" for i in range(12)),
        memory_snippets=[f"mem-{i}: " + ("fact " * 20) for i in range(8)],
        tools_enabled=True,
        available_tool_names=names,
    )
    full = "\n\n".join(p for p in (static, dynamic) if p)
    # Without drop, old prose listed every tool name twice-ish; static should stay
    # smaller than full and not grow with memory.
    assert len(static) < len(full)
    assert "mem-0" not in static
    assert "mem-0" in dynamic
    print(
        f"  size static={len(static)} dynamic={len(dynamic)} full={len(full)} "
        f"static_share={len(static)/max(len(full),1):.2%}"
    )


if __name__ == "__main__":
    test_split_static_before_dynamic()
    print("  OK  split")
    test_drop_redundant_tool_name_prose()
    print("  OK  drop tool-name prose")
    test_assemble_split_with_cache_blocks()
    print("  OK  assemble blocks")
    test_assemble_split_plain_string_default()
    print("  OK  assemble plain")
    test_truncate_and_fold_reduces_size()
    print("  OK  truncate+fold")
    test_prompt_cache_mode_probe_graceful()
    print("  OK  cache probe")
    test_size_report_static_vs_full()
    print("  OK  size report")
    print("all passed")
