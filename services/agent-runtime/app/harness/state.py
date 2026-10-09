"""Serializable agent graph state."""

from __future__ import annotations

from typing import Any, Literal, NotRequired, TypedDict


RunStatus = Literal[
    "pending",
    "running",
    "interrupted",
    "done",
    "aborted",
    "failed",
]


class AgentState(TypedDict):
    messages: list[dict[str, Any]]
    pending_tool_calls: list[dict[str, Any]]
    tools_used: list[str]
    final_text: str
    status: RunStatus
    prepared: bool
    recall_payload: dict[str, Any]
    meta: dict[str, Any]
    langfuse_trace_id: str
    steer_queue: list[str]
    follow_up_queue: list[str]
    round: int
    max_rounds: int
    usage: dict[str, Any] | None
    approval_pending: list[dict[str, Any]]
    interrupted_reason: str
    error: str
    # When True, prepare skips mem0/explicit re-recall (resume path).
    skip_recall: bool
    memory_snippets: list[str]
    system_prompt: str
    replay_results: dict[str, str]  # tool_call_id -> prior result (safe replay)
    needs_compaction: bool
    needs_finalize: bool
    needs_continue: bool  # inject CONTINUE_WORK / host nudge then re-llm
    work_continued: bool  # one-shot continue nudge already applied
    reset_seq: int  # model context starts after this journal seq (0 = none)
    compaction_retries: int
    extension_names: list[str]


def initial_state(
    *,
    messages: list[dict[str, Any]] | None = None,
    max_rounds: int = 24,
    langfuse_trace_id: str = "",
    skip_recall: bool = False,
) -> AgentState:
    return {
        "messages": list(messages or []),
        "pending_tool_calls": [],
        "tools_used": [],
        "final_text": "",
        "status": "pending",
        "prepared": False,
        "recall_payload": {},
        "meta": {},
        "langfuse_trace_id": langfuse_trace_id or "",
        "steer_queue": [],
        "follow_up_queue": [],
        "round": 0,
        "max_rounds": max_rounds,
        "usage": None,
        "approval_pending": [],
        "interrupted_reason": "",
        "error": "",
        "skip_recall": skip_recall,
        "memory_snippets": [],
        "system_prompt": "",
        "replay_results": {},
        "needs_compaction": False,
        "needs_finalize": False,
        "needs_continue": False,
        "work_continued": False,
        "reset_seq": 0,
        "compaction_retries": 0,
        "extension_names": [],
    }


class RunnableExtras(TypedDict):
    """Non-checkpointed context passed via config.configurable."""

    api_key: str
    override: NotRequired[Any]
    extra_tools: NotRequired[list[dict[str, Any]]]
    tool_handler: NotRequired[Any]
    root_obs: NotRequired[Any]
    on_status: NotRequired[Any]
    on_token: NotRequired[Any]
    user_id: NotRequired[str]
    agent_id: NotRequired[str]
    conversation_id: NotRequired[str]
    channel_id: NotRequired[str]
    peer_agent_id: NotRequired[str]
    run_id: NotRequired[str]
    mem_store: NotRequired[Any]
    body: NotRequired[Any]
    skill_reg: NotRequired[Any]
    enabled_skills: NotRequired[list[str] | None]
    client: NotRequired[Any]
    host_machines: NotRequired[list[dict[str, Any]] | None]
    available_tool_names: NotRequired[list[str] | None]
    tools_on: NotRequired[bool]
    llm_context_window: NotRequired[int | None]
    llm_model: NotRequired[str | None]
