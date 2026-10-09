"""Per-run journal session: commit-before-show helpers."""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

from .client import JournalClient, get_journal


class JournalSession:
    """Tracks thread status, entries, live/usage/inbox docs for one durable run."""

    def __init__(
        self,
        *,
        thread_id: str,
        conversation_id: str = "",
        user_id: str = "",
        org_id: str = "",
        agent_id: str = "",
        request_id: str = "",
        langfuse_trace_id: str = "",
        owner_thread_id: str = "",
        background: bool = False,
        client: JournalClient | None = None,
        live_throttle_ms: int = 150,
    ) -> None:
        self.thread_id = thread_id
        self.conversation_id = conversation_id
        self.user_id = user_id
        self.org_id = org_id
        self.agent_id = agent_id
        self.request_id = request_id
        self.langfuse_trace_id = langfuse_trace_id
        self.owner_thread_id = owner_thread_id
        self.background = background
        self.client = client or get_journal()
        self.live_throttle_ms = max(50, int(live_throttle_ms))
        self._last_live_at = 0.0
        self._usage: dict[str, Any] = {}
        self._inbox: list[dict[str, Any]] = []

    async def _run(self, fn, *args, **kwargs) -> dict[str, Any]:
        return await asyncio.to_thread(fn, *args, **kwargs)

    async def set_status(self, status: str) -> dict[str, Any]:
        return await self._run(
            self.client.upsert_thread,
            {
                "thread_id": self.thread_id,
                "conversation_id": self.conversation_id,
                "user_id": self.user_id,
                "org_id": self.org_id,
                "agent_id": self.agent_id,
                "request_id": self.request_id,
                "status": status,
                "langfuse_trace_id": self.langfuse_trace_id,
                "owner_thread_id": self.owner_thread_id,
                "background": self.background,
            },
        )

    async def append(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        project: bool = False,
        role: str = "",
        content: str = "",
        entry_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "entry_id": entry_id or str(uuid.uuid4()),
            "org_id": self.org_id,
            "user_id": self.user_id,
            "conversation_id": self.conversation_id,
            "thread_id": self.thread_id,
            "request_id": self.request_id,
            "agent_id": self.agent_id,
            "kind": kind,
            "payload": payload,
            "project": project,
            "role": role,
            "content": content,
        }
        return await self._run(self.client.append_entry, body)

    async def commit_assistant(self, text: str, *, project: bool = True) -> dict[str, Any]:
        return await self.append(
            "assistant",
            {"role": "assistant", "content": text},
            project=project,
            role="assistant",
            content=text,
        )

    async def commit_tool_intent(self, tool_calls: list[dict[str, Any]]) -> dict[str, Any]:
        return await self.append(
            "tool_intent",
            {"tool_calls": tool_calls},
            project=False,
        )

    async def commit_tool_result(
        self, tool_call_id: str, name: str, content: str
    ) -> dict[str, Any]:
        return await self.append(
            "tool_result",
            {"tool_call_id": tool_call_id, "name": name, "content": content},
            project=False,
        )

    async def commit_compaction(
        self, summary: str, keep_from_seq: int = 0
    ) -> dict[str, Any]:
        return await self.append(
            "compaction",
            {"summary": summary, "keep_from_seq": keep_from_seq},
            project=False,
        )

    async def commit_reset(self, reason: str = "") -> dict[str, Any]:
        return await self.append("reset", {"reason": reason}, project=False)

    async def put_live(self, data: dict[str, Any], *, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if not force and (now - self._last_live_at) * 1000 < self.live_throttle_ms:
            return {"ok": True, "throttled": True}
        self._last_live_at = now
        return await self._run(self.client.put_doc, self.thread_id, "live", data)

    async def put_usage(self, usage: dict[str, Any] | None) -> dict[str, Any]:
        if not usage:
            return {"ok": True, "skipped": True}
        self._usage = dict(usage)
        return await self._run(self.client.put_doc, self.thread_id, "usage", self._usage)

    async def put_inbox(self, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        if items is not None:
            self._inbox = list(items)
        return await self._run(
            self.client.put_doc, self.thread_id, "inbox", {"items": self._inbox}
        )

    async def put_agent(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._run(self.client.put_doc, self.thread_id, "agent", data)

    def enqueue_inbox(self, item: dict[str, Any]) -> None:
        self._inbox.append(item)
