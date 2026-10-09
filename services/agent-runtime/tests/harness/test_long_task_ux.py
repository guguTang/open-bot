"""Long-task UX on durable harness: early projected ack, continue nudges, auto-defer."""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ["RUNTIME_CHECKPOINT"] = "memory"
os.environ["RUNTIME_DURABLE"] = "1"
os.environ["RUNTIME_JOURNAL"] = "0"
os.environ["OPENAI_ENABLE_TOOLS"] = "1"


@pytest.mark.asyncio
async def test_early_ack_projects_with_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.harness.nodes import llm as llm_mod
    from app.harness.state import initial_state
    from app.llm import LLMOverride

    journal = MagicMock()
    journal.commit_tool_intent = AsyncMock()
    journal.append = AsyncMock(return_value={"ok": True})
    journal.put_live = AsyncMock()
    journal.put_usage = AsyncMock()

    async def fake_chat(*_a, **_k):
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "好的，我先查一下本机目录。",
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {
                                    "name": "host_shell",
                                    "arguments": '{"command":"ls"}',
                                },
                            }
                        ],
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_mod, "chat_completion", AsyncMock(side_effect=fake_chat))
    monkeypatch.setattr(
        llm_mod, "openai_config", lambda override=None: ("sk", "http://127.0.0.1:9/v1", "gpt-4o")
    )

    st = initial_state(messages=[{"role": "user", "content": "看看下载"}])
    out = await llm_mod.llm_node(
        st,
        {
            "configurable": {
                "api_key": "sk",
                "override": LLMOverride(enable_tools=True, model="gpt-4o"),
                "journal": journal,
            }
        },
    )
    assert out.get("pending_tool_calls")
    journal.append.assert_awaited()
    kwargs = journal.append.await_args
    assert kwargs.args[0] == "assistant_partial"
    assert kwargs.kwargs.get("project") is True
    assert "好的" in (kwargs.kwargs.get("content") or "")


@pytest.mark.asyncio
async def test_continue_work_nudge_sets_needs_continue(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.deferral import CONTINUE_WORK
    from app.harness.nodes import llm as llm_mod
    from app.harness.state import initial_state
    from app.llm import LLMOverride

    async def fake_chat(*_a, **_k):
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "还没做完，稍后发给你。",
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_mod, "chat_completion", AsyncMock(side_effect=fake_chat))
    monkeypatch.setattr(
        llm_mod, "openai_config", lambda override=None: ("sk", "http://127.0.0.1:9/v1", "gpt-4o")
    )

    st = initial_state(
        messages=[
            {"role": "assistant", "content": "打开 [文件](sandbox:/workspace/bots/x/a.html)"},
            {"role": "user", "content": "做完了么"},
        ]
    )
    st["tools_used"] = []  # no delivery this turn
    out = await llm_mod.llm_node(
        st,
        {
            "configurable": {
                "api_key": "sk",
                "override": LLMOverride(enable_tools=True, model="gpt-4o"),
            }
        },
    )
    assert out.get("needs_continue") is True
    assert out.get("work_continued") is True
    assert out.get("status") == "running"
    assert not str(out.get("final_text") or "").strip()
    msgs = out.get("messages") or []
    assert any(m.get("content") == CONTINUE_WORK for m in msgs)


@pytest.mark.asyncio
async def test_host_followup_nudge(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.deferral import CONTINUE_HOST_DELETE
    from app.harness.nodes import llm as llm_mod
    from app.harness.state import initial_state
    from app.llm import LLMOverride

    async def fake_chat(*_a, **_k):
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "已发起删除，请在电脑上确认。",
                    }
                }
            ]
        }

    monkeypatch.setattr(llm_mod, "chat_completion", AsyncMock(side_effect=fake_chat))
    monkeypatch.setattr(
        llm_mod, "openai_config", lambda override=None: ("sk", "http://127.0.0.1:9/v1", "gpt-4o")
    )

    st = initial_state(messages=[{"role": "user", "content": "这两个mp4删了"}])
    out = await llm_mod.llm_node(
        st,
        {
            "configurable": {
                "api_key": "sk",
                "override": LLMOverride(enable_tools=True, model="gpt-4o"),
            }
        },
    )
    assert out.get("needs_continue") is True
    msgs = out.get("messages") or []
    assert any(m.get("content") == CONTINUE_HOST_DELETE for m in msgs)


@pytest.mark.asyncio
async def test_finalize_prefers_auto_defer(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.harness.long_task import DEFER_CONFIRM
    from app.harness.nodes import finalize as fin_mod
    from app.harness.state import initial_state

    async def fake_defer(name: str, args: dict[str, Any]) -> str:
        assert name == "defer_work"
        assert "分析" in str(args.get("goal") or "")
        return json.dumps({"ok": True, "task_id": "t1"})

    chat = AsyncMock()
    monkeypatch.setattr(fin_mod, "chat_completion", chat)

    st = initial_state(
        messages=[{"role": "user", "content": "分析下enigma的代码"}],
        max_rounds=2,
    )
    st["tools_used"] = ["host_shell", "host_shell"]
    st["final_text"] = ""
    out = await fin_mod.finalize_node(
        st,
        {"configurable": {"api_key": "sk", "tool_handler": fake_defer}},
    )
    assert out.get("final_text") == DEFER_CONFIRM
    assert "defer_work" in (out.get("tools_used") or [])
    assert out.get("status") == "done"
    chat.assert_not_awaited()


@pytest.mark.asyncio
async def test_finalize_falls_back_when_defer_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.harness.nodes import finalize as fin_mod
    from app.harness.state import initial_state

    async def fail_defer(name: str, args: dict[str, Any]) -> str:
        return json.dumps({"error": "enqueue failed"})

    async def fake_chat(*_a, **_k):
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "根据已有结果：入口在 main.go。",
                    }
                }
            ]
        }

    monkeypatch.setattr(fin_mod, "chat_completion", AsyncMock(side_effect=fake_chat))
    monkeypatch.setattr(
        fin_mod, "openai_config", lambda override=None: ("sk", "http://127.0.0.1:9/v1", "mock")
    )

    st = initial_state(
        messages=[
            {"role": "user", "content": "分析代码"},
            {"role": "tool", "content": '{"ok":true,"output":"main.go"}'},
        ],
        max_rounds=2,
    )
    st["tools_used"] = ["host_shell"]
    out = await fin_mod.finalize_node(
        st,
        {"configurable": {"api_key": "sk", "tool_handler": fail_defer}},
    )
    assert "main.go" in str(out.get("final_text") or "")
    assert "上限" not in str(out.get("final_text") or "")
    assert "defer_work" not in (out.get("tools_used") or [])


@pytest.mark.asyncio
async def test_cap_with_defer_skips_finalize_synthesis(monkeypatch: pytest.MonkeyPatch) -> None:
    """tools→at-cap → finalize auto-defers instead of tools-off LLM when possible."""
    from langgraph.checkpoint.memory import MemorySaver

    from app.harness import graph as graph_mod
    from app.harness.graph import reset_compiled_graph
    from app.harness.long_task import DEFER_CONFIRM
    from app.harness.state import initial_state

    reset_compiled_graph()
    saver = MemorySaver()
    deferred_calls: list[dict[str, Any]] = []

    async def fake_prepare(state, config):
        return {
            "prepared": True,
            "skip_recall": True,
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "把这个大文件改完"},
            ],
            "meta": {"run_id": "r-defer"},
            "status": "running",
        }

    async def fake_llm(state, config):
        rnd = int(state.get("round") or 0) + 1
        return {
            "messages": list(state.get("messages") or [])
            + [
                {
                    "role": "assistant",
                    "content": "先改一版",
                    "tool_calls": [
                        {
                            "id": f"call_{rnd}",
                            "type": "function",
                            "function": {
                                "name": "sandbox_write",
                                "arguments": '{"path":"a.html","content":"x"}',
                            },
                        }
                    ],
                }
            ],
            "pending_tool_calls": [
                {
                    "id": f"call_{rnd}",
                    "type": "function",
                    "function": {
                        "name": "sandbox_write",
                        "arguments": '{"path":"a.html","content":"x"}',
                    },
                }
            ],
            "final_text": "",
            "status": "running",
            "round": rnd,
            "tools_used": list(state.get("tools_used") or []),
            "needs_continue": False,
        }

    async def fake_tools(state, config):
        msgs = list(state.get("messages") or [])
        used = list(state.get("tools_used") or [])
        for tc in state.get("pending_tool_calls") or []:
            tc_id = str(tc.get("id") or "")
            name = str((tc.get("function") or {}).get("name") or "")
            msgs.append(
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "name": name,
                    "content": '{"ok": true}',
                }
            )
            used.append(name)
        return {
            "messages": msgs,
            "pending_tool_calls": [],
            "tools_used": used,
            "status": "running",
            "final_text": "",
        }

    async def fake_finish(state, config):
        return {"status": "done", "meta": dict(state.get("meta") or {})}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        deferred_calls.append({"name": name, "args": args})
        return json.dumps({"ok": True, "task_id": "bg1"})

    chat = AsyncMock()
    monkeypatch.setattr(graph_mod, "prepare_node", fake_prepare)
    monkeypatch.setattr(graph_mod, "llm_node", fake_llm)
    monkeypatch.setattr(graph_mod, "tools_node", fake_tools)
    monkeypatch.setattr(graph_mod, "finish_node", fake_finish)
    monkeypatch.setattr("app.harness.nodes.finalize.chat_completion", chat)

    reset_compiled_graph()
    g = graph_mod.build_graph().compile(checkpointer=saver)
    config = {
        "configurable": {
            "thread_id": "c:defer1",
            "api_key": "sk-test",
            "tool_handler": tool_handler,
        }
    }
    s0 = initial_state(
        messages=[{"role": "user", "content": "把这个大文件改完"}],
        max_rounds=2,
    )
    # Seed artifact so turn_unfinished stays true if write not counted as delivery mid-way;
    # sandbox_write IS a delivery tool — so turn_unfinished is False. looks_like_delivery_work
    # still triggers defer because sandbox_ was used and final is empty.
    out = await g.ainvoke(s0, config)
    assert out["status"] == "done"
    assert out.get("final_text") == DEFER_CONFIRM
    assert deferred_calls and deferred_calls[0]["name"] == "defer_work"
    chat.assert_not_awaited()
    assert "上限" not in str(out.get("final_text") or "")


def test_system_prompt_long_task_for_host_only() -> None:
    from app.llm import build_system_prompt

    prompt = build_system_prompt(
        agent_id="bot",
        skills_catalog="（无）",
        memory_snippets=[],
        tools_enabled=True,
        available_tool_names=["host_shell", "list_machines", "defer_work", "load_skill"],
    )
    assert "defer_work" in prompt
    assert "长任务" in prompt
    assert "sandbox_* 仅在内部" not in prompt  # host-only: no sandbox opacity block


def test_route_needs_continue_returns_llm() -> None:
    from app.harness.graph import _route_after_llm
    from app.harness.state import initial_state

    st = initial_state(messages=[])
    st["needs_continue"] = True
    st["status"] = "running"
    assert _route_after_llm(st) == "llm"

def test_early_ack_visible_keeps_short():
    from app.harness.long_task import early_ack_visible

    assert early_ack_visible("好的，我先查一下本机目录。") == "好的，我先查一下本机目录。"
    assert early_ack_visible("") == ""
    assert early_ack_visible("   ") == ""


def test_early_ack_visible_truncates_long_preamble():
    from app.harness.long_task import early_ack_visible

    long = (
        "好的，我先看一下。"
        + ("接下来我会详细说明每一个步骤和背景。" * 8)
    )
    out = early_ack_visible(long)
    assert out == "好的，我先看一下。"
    assert len(out) < len(long)

    no_stop = "x" * 120
    out2 = early_ack_visible(no_stop)
    assert out2.endswith("…")
    assert len(out2) == 80

