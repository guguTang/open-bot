"""tools→at-cap → finalize produces non-empty final_text (no 上限 canned line)."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import AsyncMock

import pytest

os.environ["RUNTIME_CHECKPOINT"] = "memory"
os.environ["RUNTIME_DURABLE"] = "1"
os.environ["RUNTIME_JOURNAL"] = "0"
os.environ["OPENAI_ENABLE_TOOLS"] = "1"


@pytest.mark.asyncio
async def test_tools_at_cap_routes_to_finalize_with_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    from langgraph.checkpoint.memory import MemorySaver

    from app.harness import graph as graph_mod
    from app.harness.graph import reset_compiled_graph
    from app.harness.state import initial_state

    reset_compiled_graph()
    saver = MemorySaver()

    llm_calls: list[dict[str, Any]] = []

    async def fake_prepare(state, config):
        return {
            "prepared": True,
            "skip_recall": True,
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "分析下enigma的代码"},
            ],
            "meta": {"run_id": "r-cap"},
            "status": "running",
        }

    async def fake_llm(state, config):
        rnd = int(state.get("round") or 0) + 1
        # Always request a tool until cap would be hit via tools→finalize.
        return {
            "messages": list(state.get("messages") or [])
            + [
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": f"call_{rnd}",
                            "type": "function",
                            "function": {
                                "name": "host_shell",
                                "arguments": '{"command":"ls"}',
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
                        "name": "host_shell",
                        "arguments": '{"command":"ls"}',
                    },
                }
            ],
            "final_text": "",
            "status": "running",
            "round": rnd,
            "tools_used": list(state.get("tools_used") or []),
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
                    "content": '{"ok": true, "output": "enigma/ main.go README.md"}',
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

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: Any = None,
    ) -> dict[str, Any]:
        llm_calls.append({"tools": tools, "tool_choice": tool_choice, "n": len(messages)})
        assert tools is None, "finalize must disable tools"
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "Enigma 仓库主要是 Go 服务：入口在 main.go，另有 README 说明。",
                    }
                }
            ]
        }

    monkeypatch.setattr(graph_mod, "prepare_node", fake_prepare)
    monkeypatch.setattr(graph_mod, "llm_node", fake_llm)
    monkeypatch.setattr(graph_mod, "tools_node", fake_tools)
    monkeypatch.setattr(graph_mod, "finish_node", fake_finish)
    monkeypatch.setattr("app.harness.nodes.finalize.chat_completion", AsyncMock(side_effect=fake_chat))
    monkeypatch.setattr(
        "app.harness.nodes.finalize.openai_config",
        lambda override=None: ("sk", "http://127.0.0.1:9/v1", "mock"),
    )

    reset_compiled_graph()
    g = graph_mod.build_graph().compile(checkpointer=saver)
    config = {"configurable": {"thread_id": "c:cap1", "api_key": "sk-test"}}
    s0 = initial_state(
        messages=[{"role": "user", "content": "分析下enigma的代码"}],
        max_rounds=2,
    )
    out = await g.ainvoke(s0, config)

    assert out["status"] == "done"
    final = str(out.get("final_text") or "")
    assert final.strip(), "finalize must produce non-empty final_text"
    assert "上限" not in final
    assert "已达工具轮次" not in final
    assert "Enigma" in final or "enigma" in final.lower() or "main.go" in final
    assert llm_calls, "finalize should call the LLM once tools-off"
    assert all(c["tools"] is None for c in llm_calls)


@pytest.mark.asyncio
async def test_llm_past_cap_sets_needs_finalize_not_canned() -> None:
    """llm_node past max_rounds must request finalize, not 上限 canned text."""
    from app.harness.nodes import llm as llm_mod
    from app.harness.state import initial_state

    st = initial_state(messages=[{"role": "user", "content": "hi"}], max_rounds=1)
    st["round"] = 1  # next rnd = 2 > max_rounds
    st["final_text"] = ""
    out = await llm_mod.llm_node(st, {"configurable": {"api_key": "sk"}})
    assert out.get("needs_finalize") is True
    assert not str(out.get("final_text") or "").strip()
    assert "上限" not in str(out.get("final_text") or "")
