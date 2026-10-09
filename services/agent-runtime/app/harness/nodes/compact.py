"""Compaction node: write journal compaction entry + summarize messages."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from ... import compact as compact_mod
from ...llm import chat_text, openai_config
from ..state import AgentState


def _cfg(config: dict[str, Any] | RunnableConfig) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


async def compact_node(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Idle / overflow compaction. Sets compacted messages and journal entry via session."""
    cfg = _cfg(config)
    journal = cfg.get("journal")
    api_key = str(cfg.get("api_key") or "")
    override = cfg.get("override")
    msgs = list(state.get("messages") or [])
    dialog = [m for m in msgs if m.get("role") in ("user", "assistant", "summary", "tool")]

    async def _summarize(batch: list[dict[str, Any]]) -> str:
        return await chat_text(batch, api_key=api_key or "", override=override)

    llm_cw = cfg.get("llm_context_window")
    _, _, default_model = openai_config(override)
    llm_model = cfg.get("llm_model") or default_model

    compacted, meta = await compact_mod.compact_messages(
        dialog,
        api_key=api_key or None,
        chat_fn=_summarize if api_key else None,
        context_window=llm_cw,
        model=llm_model,
    )
    # Overflow path: if thresholds did not fire, still keep a short tail.
    if not meta.get("compacted") and len(dialog) > 8:
        keep = dialog[-6:]
        summary = "（上下文已压缩，保留最近对话。）"
        compacted = [{"role": "summary", "content": summary}] + keep
        meta = {
            "compacted": True,
            "compact_reason": "overflow_retry",
            "summary": summary,
            "summary_new": True,
        }
    summary = str(meta.get("summary") or "")
    if journal is not None and (summary or meta.get("compacted")):
        await journal.commit_compaction(summary or "(compacted)", keep_from_seq=0)
        await journal.put_live(
            {"phase": "compaction", "summary_len": len(summary)}, force=True
        )

    # Preserve system message if present at head.
    system = []
    if msgs and msgs[0].get("role") == "system":
        system = [msgs[0]]
    new_msgs = system + list(compacted)
    meta_out = dict(state.get("meta") or {})
    meta_out["compacted"] = True
    meta_out["compact_reason"] = meta.get("compact_reason") or "overflow_or_idle"
    if summary:
        meta_out["summary"] = summary

    return {
        "messages": new_msgs,
        "meta": meta_out,
        "needs_compaction": False,
        "status": "running",
    }
