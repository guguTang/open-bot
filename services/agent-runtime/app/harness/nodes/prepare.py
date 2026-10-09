"""Prepare node: memory recall, lessons, compact, system prompt (once per run)."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from ... import compact as compact_mod
from ... import lessons as lessons_mod
from ... import mem0_store
from ...llm import (
    assemble_llm_messages,
    build_system_prompt,
    chat_text,
    openai_config,
    tools_enabled,
)
from ...memory import build_recall_payload, scene_kind
from ..state import AgentState


def _cfg(config: dict[str, Any]) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


async def prepare_node(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    """Build llm messages. On resume (skip_recall/prepared), only merge steer queue."""
    cfg = _cfg(config)
    updates: dict[str, Any] = {"status": "running"}

    # Resume / already prepared: apply steer text only.
    if state.get("prepared") or state.get("skip_recall"):
        msgs = list(state.get("messages") or [])
        steers = list(state.get("steer_queue") or [])
        if steers:
            for text in steers:
                t = (text or "").strip()
                if t:
                    msgs.append({"role": "user", "content": t})
            updates["messages"] = msgs
            updates["steer_queue"] = []
        updates["prepared"] = True
        return updates

    body = cfg.get("body")
    mem = cfg.get("mem_store")
    user_id = str(cfg.get("user_id") or "")
    agent_id = str(cfg.get("agent_id") or "open-bot")
    channel_id = str(cfg.get("channel_id") or "")
    peer_agent_id = str(cfg.get("peer_agent_id") or "")
    run_id = str(cfg.get("run_id") or "")
    override = cfg.get("override")
    api_key = str(cfg.get("api_key") or "")
    skill_reg = cfg.get("skill_reg")
    enabled = cfg.get("enabled_skills")
    client = cfg.get("client")
    host_machines = cfg.get("host_machines")
    available_tool_names = cfg.get("available_tool_names")
    tools_on = bool(cfg.get("tools_on", tools_enabled(override)))
    langfuse_trace_id = str(state.get("langfuse_trace_id") or "")

    user_text = ""
    if body is not None:
        user_text = str(getattr(body, "content", "") or "").strip()
    history = list(state.get("messages") or [])
    if not user_text and history:
        for m in reversed(history):
            if m.get("role") == "user":
                user_text = str(m.get("content") or "")
                break

    scene = scene_kind(channel_id, peer_agent_id)
    recall_query = ""
    if body is not None:
        recall_query = str(getattr(body, "reply_context", None) or "").strip()
    recall_query = recall_query or user_text

    recalled_buckets: dict[str, list] = {}
    mem0_by_scope: dict[str, list[str]] = {}
    mem0_hits: list[str] = []
    if mem is not None:
        recalled_buckets = mem.recall_buckets(
            recall_query,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        if user_id and mem0_store.mem0_wanted():
            for scope_name in recalled_buckets:
                aid = agent_id if scope_name in ("bot", "agent_pair") else ""
                cid = channel_id if scope_name == "channel" else ""
                peer = peer_agent_id if scope_name == "agent_pair" else ""
                hits = mem0_store.search_for_scope(
                    user_id,
                    recall_query,
                    scope=scope_name,
                    agent_id=aid,
                    channel_id=cid,
                    peer_agent_id=peer,
                )
                mem0_by_scope[scope_name] = hits
                mem0_hits.extend(hits)

    recalled = [item for items in recalled_buckets.values() for item in items]
    recall_payload = build_recall_payload(
        recalled_buckets,
        mem0_by_scope,
        scene,
        recalled=recalled,
        mem0_hits=mem0_hits,
    )
    recall_payload["run_id"] = run_id
    if langfuse_trace_id:
        recall_payload["langfuse_trace_id"] = langfuse_trace_id
    memory_snippets = [r["snippet"] for r in recall_payload.get("items") or []]

    system = build_system_prompt(
        agent_id=agent_id,
        skills_catalog=skill_reg.catalog_for_prompt(enabled) if skill_reg else "",
        memory_snippets=memory_snippets,
        tools_enabled=tools_on,
        available_tool_names=available_tool_names,
        client=client,
        machines=host_machines,
    )
    injected_lessons: list[dict[str, Any]] = []
    try:
        injected_lessons, lesson_block = lessons_mod.active_lessons_with_block(
            user_id, agent_id
        )
        if lesson_block:
            system = system + "\n\n" + lesson_block
    except Exception:  # noqa: BLE001
        injected_lessons = []

    if body is not None and getattr(body, "system_prompt", None):
        sp = str(body.system_prompt or "").strip()
        if sp:
            system = sp + "\n\n" + system

    dialog = [m for m in history if m.get("role") in ("user", "assistant", "summary")]
    # After a reset entry, only keep messages tagged at/after reset (or trailing turns).
    reset_seq = int(state.get("reset_seq") or 0)
    if reset_seq > 0:
        kept = [m for m in dialog if int(m.get("_journal_seq") or 0) >= reset_seq]
        if kept:
            dialog = kept

    async def _summarize(msgs: list[dict[str, Any]]) -> str:
        return await chat_text(msgs, api_key=api_key or "", override=override)

    llm_cw = cfg.get("llm_context_window")
    _, _, default_model = openai_config(override)
    llm_model = cfg.get("llm_model") or default_model
    compacted, compact_meta = await compact_mod.compact_messages(
        dialog,
        api_key=api_key or None,
        chat_fn=_summarize if api_key else None,
        context_window=llm_cw,
        model=llm_model,
    )
    llm_messages = assemble_llm_messages(system, compacted)

    steers = list(state.get("steer_queue") or [])
    if steers:
        for text in steers:
            t = (text or "").strip()
            if t:
                llm_messages.append({"role": "user", "content": t})

    active_skills = skill_reg.filter_meta(enabled) if skill_reg else []
    meta = {
        "conversation_id": str(cfg.get("conversation_id") or ""),
        "agent_id": agent_id,
        "history_count": len(history),
        "skills_count": len(active_skills),
        "enabled_skills": [s.name for s in active_skills],
        "memory_recalled": len(recalled),
        "mem0_recalled": len(mem0_hits),
        "memory_recall": recall_payload,
        "compacted": compact_meta.get("compacted", False),
        "compact_reason": compact_meta.get("compact_reason") or "",
        "summary_new": bool(compact_meta.get("summary_new")),
        "llm_override": override is not None,
        "compact_thresholds": compact_meta.get("thresholds")
        or compact_mod.compact_config(context_window=llm_cw, model=llm_model),
        "tools_enabled": tools_on,
        "lessons_injected": len(injected_lessons),
        "lesson_ids": [str(x.get("id") or "") for x in injected_lessons],
        "run_id": run_id,
        "durable": True,
    }
    if compact_meta.get("summary_new") and compact_meta.get("summary"):
        meta["summary"] = compact_meta["summary"]

    updates.update(
        {
            "messages": llm_messages,
            "prepared": True,
            "skip_recall": True,  # subsequent resumes skip re-recall
            "recall_payload": recall_payload,
            "memory_snippets": memory_snippets,
            "system_prompt": system,
            "meta": meta,
            "steer_queue": [],
        }
    )
    return updates
