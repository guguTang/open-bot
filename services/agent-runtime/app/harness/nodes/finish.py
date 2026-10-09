"""Finish node: mem0 auto-add / dream only on successful terminal status."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from ... import dream
from ... import mem0_store
from ..state import AgentState


def _cfg(config: dict[str, Any] | RunnableConfig) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


async def finish_node(state: AgentState, config: RunnableConfig) -> dict[str, Any]:
    cfg = _cfg(config)
    journal = cfg.get("journal")
    status = str(state.get("status") or "done")
    if status in ("aborted", "failed", "interrupted"):
        if journal is not None:
            await journal.set_status(status)
            await journal.put_usage(
                state.get("usage") if isinstance(state.get("usage"), dict) else None
            )
        return {"status": status}

    user_id = str(cfg.get("user_id") or "").strip()
    final = str(state.get("final_text") or "").strip()
    body = cfg.get("body")
    user_text = ""
    if body is not None:
        user_text = str(getattr(body, "content", "") or "").strip()

    if user_id and final and mem0_store.mem0_wanted() and mem0_store.mem0_auto_add():
        turns: list[dict[str, str]] = []
        if user_text:
            turns.append({"role": "user", "content": user_text})
        turns.append({"role": "assistant", "content": final})
        mem0_store.add_conversation_bg(user_id, turns)

    if user_id:
        try:
            dream.maybe_consolidate_user_bg(user_id)
        except Exception:  # noqa: BLE001
            pass

    meta = dict(state.get("meta") or {})
    meta["tools_used"] = list(state.get("tools_used") or [])
    meta["durable"] = True
    if journal is not None:
        await journal.set_status("done")
        await journal.put_usage(
            state.get("usage") if isinstance(state.get("usage"), dict) else None
        )
        await journal.append(
            "finish",
            {"status": "done", "tools_used": meta["tools_used"]},
            project=False,
        )
        # Drain follow-ups: signal inbox so next submit can start a new run.
        follow = list(state.get("follow_up_queue") or [])
        if follow:
            await journal.put_inbox(
                [{"text": t, "when_busy": "follow_up", "pending_next_run": True} for t in follow]
            )
    return {"status": "done", "meta": meta}
