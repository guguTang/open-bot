"""Child thread ownership for subagent / background (defer) work."""

from __future__ import annotations

import uuid
from typing import Any

from .config import thread_id_for
from .journal import JournalSession, get_journal


async def spawn_child_thread(
    *,
    conversation_id: str,
    parent_thread_id: str,
    user_id: str = "",
    agent_id: str = "",
    request_id: str | None = None,
    background: bool = False,
    owner_task: str = "",
) -> dict[str, Any]:
    """Create a child harness thread owned by parent_thread_id."""
    rid = (request_id or str(uuid.uuid4())).strip()
    child_tid = thread_id_for(conversation_id=conversation_id, request_id=rid)
    journal = JournalSession(
        thread_id=child_tid,
        conversation_id=conversation_id,
        user_id=user_id,
        agent_id=agent_id,
        request_id=rid,
        owner_thread_id=parent_thread_id,
        background=background,
        client=get_journal(),
    )
    await journal.set_status("pending")
    await journal.put_agent(
        {
            "owner_thread_id": parent_thread_id,
            "owner_task": owner_task,
            "background": background,
            "kind": "child",
        }
    )
    await journal.append(
        "child_spawn",
        {
            "parent_thread_id": parent_thread_id,
            "background": background,
            "owner_task": owner_task,
        },
        project=False,
    )
    return {
        "ok": True,
        "thread_id": child_tid,
        "request_id": rid,
        "owner_thread_id": parent_thread_id,
        "background": background,
    }


async def abort_owned_children(parent_thread_id: str, *, include_background: bool = False) -> dict[str, Any]:
    """Best-effort: mark non-background children aborted when parent aborts.

    Full enumeration requires Go list-by-owner; for now record an abort entry
    on the parent and rely on resume worker skipping aborted status.
    """
    journal = JournalSession(thread_id=parent_thread_id, client=get_journal())
    await journal.append(
        "child_abort",
        {"include_background": include_background},
        project=False,
    )
    await journal.set_status("aborted")
    return {"ok": True, "parent_thread_id": parent_thread_id}
