"""Compile the durable agent StateGraph."""

from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from .nodes.compact import compact_node
from .nodes.finalize import finalize_node
from .nodes.finish import finish_node
from .nodes.llm import llm_node
from .nodes.prepare import prepare_node
from .nodes.tools import tools_node
from .state import AgentState

_compiled: Any | None = None


def _route_after_llm(state: AgentState) -> Literal["tools", "compact", "finalize", "finish"]:
    if state.get("needs_compaction"):
        return "compact"
    if state.get("pending_tool_calls"):
        return "tools"
    if state.get("needs_finalize"):
        return "finalize"
    # Cap with empty answer (should be rare; tools path usually hits finalize first).
    if (
        not str(state.get("final_text") or "").strip()
        and int(state.get("round") or 0) >= int(state.get("max_rounds") or 24)
        and list(state.get("tools_used") or [])
    ):
        return "finalize"
    return "finish"


def _route_after_tools(state: AgentState) -> Literal["llm", "compact", "finalize", "finish"]:
    if str(state.get("status") or "") in ("aborted", "failed"):
        return "finish"
    if state.get("needs_compaction"):
        return "compact"
    if int(state.get("round") or 0) >= int(state.get("max_rounds") or 24):
        # At tool-round cap: synthesize an answer instead of bare finish / 上限 notice.
        if not str(state.get("final_text") or "").strip():
            return "finalize"
        return "finish"
    return "llm"


def _route_after_compact(state: AgentState) -> Literal["llm", "finish"]:
    if str(state.get("status") or "") in ("aborted", "failed"):
        return "finish"
    return "llm"


def _route_after_finalize(state: AgentState) -> Literal["finish"]:
    return "finish"


def build_graph() -> Any:
    g: StateGraph = StateGraph(AgentState)
    g.add_node("prepare", prepare_node)
    g.add_node("llm", llm_node)
    g.add_node("tools", tools_node)
    g.add_node("compact", compact_node)
    g.add_node("finalize", finalize_node)
    g.add_node("finish", finish_node)
    g.add_edge(START, "prepare")
    g.add_edge("prepare", "llm")
    g.add_conditional_edges(
        "llm",
        _route_after_llm,
        {"tools": "tools", "compact": "compact", "finalize": "finalize", "finish": "finish"},
    )
    g.add_conditional_edges(
        "tools",
        _route_after_tools,
        {"llm": "llm", "compact": "compact", "finalize": "finalize", "finish": "finish"},
    )
    g.add_conditional_edges(
        "compact",
        _route_after_compact,
        {"llm": "llm", "finish": "finish"},
    )
    g.add_conditional_edges(
        "finalize",
        _route_after_finalize,
        {"finish": "finish"},
    )
    g.add_edge("finish", END)
    return g


async def get_compiled_graph(checkpointer: Any | None = None) -> Any:
    """Compile with checkpointer. Cached per checkpointer identity."""
    global _compiled
    if checkpointer is None:
        from .checkpointer import get_checkpointer

        checkpointer = await get_checkpointer()
    # Recompile when checkpointer instance changes (tests swap MemorySaver).
    key = id(checkpointer)
    if _compiled is not None and getattr(_compiled, "_ob_ckpt_id", None) == key:
        return _compiled
    compiled = build_graph().compile(checkpointer=checkpointer)
    setattr(compiled, "_ob_ckpt_id", key)
    _compiled = compiled
    return compiled


def reset_compiled_graph() -> None:
    global _compiled
    _compiled = None
