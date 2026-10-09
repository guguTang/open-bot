"""Phase 1 agent runtime: history, skills, memory, compaction, OpenAI or echo."""

from __future__ import annotations

import asyncio
import uuid
import contextlib
import json
import sys
from pathlib import Path
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import compact as compact_mod
from .llm import (
    LLMOverride,
    TOOL_DEFS,
    assemble_llm_messages,
    build_system_prompt,
    chat_text,
    normalize_messages,
    openai_config,
    REASONING_ONLY,
    run_tool_loop,
    sanitize_fake_tool_narration,
    stream_chat_tokens,
    strip_think,
    tools_enabled,
)
from .tool_markup import strip_tool_markup
from .memory import (
    MemoryStore,
    get_store,
    build_recall_payload,
    merge_scoped_snippets,
    resolve_write_scope,
    scene_kind,
)
from . import mem0_store
from . import thread_context
from . import dream
from . import mcp_client
from . import builtin_tools
from .decision import DecisionSettings, bind_decision, build_client, reset_decision
from .decision.protocol import DecisionError
from .client_env import ClientContext
from .skills import SkillRegistry, registry_for_user
from . import langfuse_trace as lf
from .presence import PresencePublisher
from .reply_quote import apply_reply_quote
from .tool_dispatch import bind_tool_handler, reset_tool_handler
from .harness import durable_enabled, run_durable_events, start_resume_worker, stop_resume_worker
from .harness.config import thread_id_for
from .harness.checkpointer import get_checkpointer, close_checkpointer

_REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_REPO_ROOT / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="open-bot agent-runtime", version="0.2.0")
skills = SkillRegistry()
# default store resolved per-request via get_store(user_id)

def skills_for(user_id: str | None) -> SkillRegistry:
    """Global + per-user custom skills."""
    if user_id and str(user_id).strip():
        return registry_for_user(str(user_id).strip())
    return skills



class ChatMessage(BaseModel):
    role: str
    content: str


class LLMConfig(BaseModel):
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    enable_tools: bool | None = None
    context_window: int | None = None


class RunRequest(BaseModel):
    conversation_id: str = Field(..., min_length=1)
    content: str = Field(default="", min_length=0)
    messages: list[ChatMessage] = Field(default_factory=list)
    agent_id: str = Field(default="open-bot")
    user_id: str | None = None
    channel_id: str | None = None
    peer_agent_id: str | None = None
    system_prompt: str | None = None
    llm: LLMConfig | None = None
    decision: DecisionSettings | None = None
    enabled_skills: list[str] | None = None
    client: dict[str, Any] | None = None
    preferred_machine_id: str = ""
    max_tool_rounds: int | None = None
    # Slack/Grok-style thread (Go injects reply context into content/messages).
    reply_to_id: str | None = None
    # Explicit user「回复」parent text (API resolves, same-conversation only).
    # Injected into the model turn only; never persisted.
    reply_to_content: str | None = None
    thread_root_id: str | None = None
    # Augmented recall query: replied snippet + recent thread turns + user text.
    reply_context: str | None = None
    # Idempotent durable run key (LangGraph thread suffix). Go may send request_id.
    request_id: str | None = None
    # Background / child-thread flags (defer_work / conversation_tasks).
    background: bool = False
    owner_task: str | None = None
    owner_thread_id: str | None = None


class MemoryCreate(BaseModel):
    content: str = Field(..., min_length=1)
    tier: str = Field(default="note")
    tags: list[str] = Field(default_factory=list)
    user_id: str | None = None
    scope: str = Field(default="user")
    agent_id: str = ""
    channel_id: str = ""
    peer_agent_id: str = ""



class MCPServerBody(BaseModel):
    id: str | None = None
    name: str | None = None
    transport: str = "stdio"
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    url: str | None = None
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True


class MCPTestRequest(BaseModel):
    user_id: str | None = None
    server: MCPServerBody


class MCPListToolsRequest(BaseModel):
    user_id: str | None = None
    server_id: str | None = None
    servers: list[MCPServerBody] | None = None


class MCPCallToolRequest(BaseModel):
    user_id: str | None = None
    server_id: str | None = None
    tool: str = Field(..., min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)
    server: MCPServerBody | None = None


def clamp_tool_rounds(n: int | None) -> int:
    """Interactive default is DEFAULT_TOOL_ROUNDS; background may ask higher (bounded)."""
    from .llm import DEFAULT_TOOL_ROUNDS, MAX_TOOL_ROUNDS

    if n is None:
        return DEFAULT_TOOL_ROUNDS
    if n < 1:
        return 1
    if n > MAX_TOOL_ROUNDS:
        return MAX_TOOL_ROUNDS
    return n


def _host_delete_paths(args: dict[str, Any]) -> str:
    """Normalize path / paths into newline-joined paths for one confirm card."""
    out: list[str] = []
    seen: set[str] = set()
    candidates: list[Any] = []
    single = args.get("path")
    if single is not None and str(single).strip():
        candidates.append(single)
    raw_paths = args.get("paths")
    if isinstance(raw_paths, list):
        candidates.extend(raw_paths)
    for item in candidates:
        for line in str(item or "").split("\n"):
            p = line.strip()
            if not p or p in seen:
                continue
            seen.add(p)
            out.append(p)
    return "\n".join(out)


def _override_from_body(llm: LLMConfig | None) -> LLMOverride | None:
    if llm is None:
        return None
    return LLMOverride(
        base_url=llm.base_url,
        api_key=llm.api_key,
        model=llm.model,
        enable_tools=llm.enable_tools,
    )


@app.on_event("startup")
async def _startup() -> None:
    skills.reload()
    if durable_enabled():
        try:
            await get_checkpointer()
        except Exception:  # noqa: BLE001
            pass
        start_resume_worker()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await stop_resume_worker()
    await close_checkpointer()


@app.get("/healthz")
async def healthz() -> dict:
    api_key, base, model = openai_config()
    # Touch Mem0 lazily so health reflects init success/failure without crashing.
    if mem0_store.mem0_wanted():
        mem0_store.get_mem0()
    mem0_status = mem0_store.status()
    return {
        "ok": True,
        "service": "agent-runtime",
        "has_openai_key": bool(api_key),
        "model": model if api_key else None,
        "base_url": base if api_key else None,
        "skills": len(skills.list_meta()),
        "memories_backend": get_store(None).backend_kind,
        "memories_vector": get_store(None).vector_enabled,
        "mem0_enabled": mem0_status.get("mem0_enabled"),
        "mem0_collection": mem0_status.get("mem0_collection"),
        "mem0_auto_add": mem0_status.get("mem0_auto_add"),
        "mem0_init_error": mem0_status.get("mem0_init_error"),
        "dream_mode": dream.status().get("dream_mode"),
        "dream": dream.status(),
        "compact": compact_mod.compact_config(),
        "mcp_example": "POST /v1/mcp/test | /v1/mcp/list-tools | /v1/mcp/call-tool",
        **lf.status(),
    }


@app.get("/v1/compact-config")
async def compact_config() -> dict:
    return {"compact": compact_mod.compact_config()}


class DecisionTestRequest(DecisionSettings):
    state: Any = "ping"
    questions: dict[str, Any] | None = None


@app.post("/v1/decision/test")
def decision_test(body: DecisionTestRequest) -> dict:
    """Probe the org's decision provider without touching the chat loop."""
    client = build_client(body)
    if not client.enabled:
        return {"enabled": False, "provider": "off", "answers": {}}
    questions = body.questions or {
        "ok": {"type": "noul", "instructions": "Is the state non-empty?"}
    }
    try:
        result = client.decide(body.state, questions)
    except DecisionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result.to_dict()

@app.get("/v1/mcp/example")
async def mcp_example() -> dict:
    cmd, args = mcp_client.example_echo_command()
    return {
        "name": "echo",
        "transport": "stdio",
        "command": cmd,
        "args": args,
        "help": mcp_client.example_help_text(),
    }


@app.post("/v1/mcp/test")
async def mcp_test(body: MCPTestRequest) -> dict:
    cfg = mcp_client.MCPServerConfig.from_dict(body.server.model_dump())
    return await mcp_client.test_server(cfg)


@app.post("/v1/mcp/list-tools")
async def mcp_list_tools(body: MCPListToolsRequest) -> dict:
    servers: list[mcp_client.MCPServerConfig] = []
    if body.servers:
        servers = [mcp_client.MCPServerConfig.from_dict(s.model_dump()) for s in body.servers]
    elif body.user_id:
        servers = mcp_client.load_servers_from_pg(body.user_id, enabled_only=True)
        if body.server_id:
            servers = [s for s in servers if s.id == body.server_id]
    tools = await mcp_client.list_tools_for_servers(servers)
    return {
        "tools": tools,
        "count": len([t for t in tools if not t.get("error")]),
        "servers": [{"id": s.id, "name": s.name, "transport": s.transport} for s in servers],
    }


@app.post("/v1/mcp/call-tool")
async def mcp_call_tool(body: MCPCallToolRequest) -> dict:
    servers: list[mcp_client.MCPServerConfig] = []
    if body.server is not None:
        servers = [mcp_client.MCPServerConfig.from_dict(body.server.model_dump())]
    elif body.user_id:
        servers = mcp_client.load_servers_from_pg(body.user_id, enabled_only=False)
    if body.server_id:
        servers = [s for s in servers if s.id == body.server_id] or servers
    result = await mcp_client.resolve_and_call(
        servers=servers,
        qualified_or_tool=body.tool,
        server_id=body.server_id,
        arguments=body.arguments or {},
    )
    return result




@app.get("/v1/skills")
async def list_skills() -> dict:
    return {
        "skills": [
            {"name": s.name, "description": s.description}
            for s in skills.list_meta()
        ]
    }


@app.get("/v1/skills/{name}")
async def get_skill(name: str) -> dict:
    full = skills.load(name)
    if not full:
        raise HTTPException(status_code=404, detail="skill not found")
    return {
        "name": full.name,
        "description": full.description,
        "body": full.body,
    }


@app.get("/v1/memories")
async def list_memories(
    q: str | None = None,
    tier: str | None = None,
    scope: str | None = None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
    limit: int = Query(default=20, ge=1, le=200),
    user_id: str | None = None,
) -> dict:
    store = get_store(user_id)
    if q:
        items = store.recall(
            q,
            tier=tier,
            top_k=limit,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
    else:
        items = store.list(
            tier=tier,
            limit=limit,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
    return {"memories": [store.to_public(i) for i in items], "backend": store.backend_kind}


@app.get("/v1/memories/auto")
async def list_auto_memories(
    user_id: str | None = None,
    scope: str | None = None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
    limit: int = Query(default=100, ge=1, le=200),
) -> dict:
    return mem0_store.list_for_user(
        user_id or "",
        scope=scope,
        agent_id=agent_id,
        channel_id=channel_id,
        peer_agent_id=peer_agent_id,
        limit=limit,
    )


@app.post("/v1/memories")
async def create_memory(body: MemoryCreate) -> dict:
    store = get_store(body.user_id)
    try:
        item = store.write(
            body.content,
            tier=body.tier,
            tags=body.tags,
            scope=body.scope,
            agent_id=body.agent_id,
            channel_id=body.channel_id,
            peer_agent_id=body.peer_agent_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    out = store.to_public(item)
    out["backend"] = store.backend_kind
    return out



class MemoryPurge(BaseModel):
    user_id: str


@app.post("/v1/memories/purge")
async def purge_memories(body: MemoryPurge) -> dict:
    """Admin/internal: wipe Mem0 auto-memories for a user (account row stays elsewhere)."""
    return mem0_store.delete_all_for_user(body.user_id)


@app.post("/v1/runs")
async def runs(body: RunRequest, request: Request) -> StreamingResponse:
    return StreamingResponse(
        run_events(body, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


async def run_events(body: RunRequest, request: Request | None = None) -> AsyncIterator[str]:
    override = _override_from_body(body.llm)
    api_key, base, model = openai_config(override)
    mem = get_store(body.user_id)
    history = normalize_messages(
        [m.model_dump() for m in body.messages],
        body.content,
    )
    history_count = len(history)
    user_text = body.content.strip()
    if not user_text and history:
        for m in reversed(history):
            if m["role"] == "user":
                user_text = m["content"]
                break
    # Explicit reply: inject quoted parent text into the current user turn
    # (content + last user message) before compaction / prompt build.
    # Memory recall / trace input keep the raw user_text above.
    if body.reply_to_content and body.reply_to_content.strip():
        quoted_content, history = apply_reply_quote(
            body.content, history, body.reply_to_content
        )
        body = body.model_copy(update={"content": quoted_content})

    # Throw-safe enter/exit: helpers yield once, but avoid relying on `with`
    # across async generator yields (GeneratorExit + cleanup raise).
    run_id = str(uuid.uuid4())
    _trace_cm = lf.trace_run(
        body.conversation_id,
        body.agent_id,
        body.user_id,
        user_text or body.content,
        metadata={
            "mode": "openai" if api_key else "echo",
            "model": model if api_key else None,
            "run_id": run_id,
        },
    )
    root_obs = _trace_cm.__enter__()
    langfuse_trace_id = lf.trace_id_of(root_obs)
    if langfuse_trace_id:
        lf.update_obs(root_obs, metadata={"run_id": run_id, "langfuse_trace_id": langfuse_trace_id})
    decision_token = bind_decision(body.decision)
    try:
        # Prefer client request_id for durable idempotency / resume.
        if body.request_id and str(body.request_id).strip():
            run_id = str(body.request_id).strip()

        enabled = body.enabled_skills
        skill_reg = skills_for(body.user_id)
        tools_on = tools_enabled(override)
        mcp_servers: list[mcp_client.MCPServerConfig] = []
        mcp_extra_tools: list[dict[str, Any]] = []
        available_tool_names: list[str] | None = None
        if tools_on:
            available_tool_names = [
                str((t.get("function") or {}).get("name") or "")
                for t in TOOL_DEFS
                if (t.get("function") or {}).get("name")
            ]
            if body.user_id and (override is None or override.enable_tools is not False):
                try:
                    mcp_servers = mcp_client.load_servers_from_pg(
                        str(body.user_id).strip(), enabled_only=True
                    )
                    if mcp_servers:
                        metas = await mcp_client.list_tools_for_servers(mcp_servers)
                        mcp_extra_tools = mcp_client.openai_tools_from_mcp(metas)
                        for t in mcp_extra_tools:
                            n = str((t.get("function") or {}).get("name") or "")
                            if n:
                                available_tool_names.append(n)
                except Exception:  # noqa: BLE001
                    mcp_extra_tools = []

        client_ctx = ClientContext.from_any(body.client)
        host_machines: list[dict[str, Any]] | None = None
        if body.user_id:
            from . import machines as machines_mod

            listed = machines_mod.list_machines(str(body.user_id))
            if isinstance(listed.get("machines"), list):
                host_machines = listed["machines"]

        llm_cw = body.llm.context_window if body.llm else None
        llm_model = (body.llm.model if body.llm else None) or model

        if api_key and durable_enabled():
            lf.update_obs(
                root_obs,
                metadata={
                    "mode": "openai",
                    "model": model,
                    "tools_enabled": tools_on,
                    "history_count": history_count,
                    "durable": True,
                },
            )
            async for chunk in openai_path(
                [],
                api_key,
                override,
                mem,
                enabled_skills=enabled,
                user_id=body.user_id,
                agent_id=body.agent_id,
                channel_id=body.channel_id,
                peer_agent_id=body.peer_agent_id,
                conversation_id=body.conversation_id,
                skill_reg=skill_reg,
                mcp_servers=mcp_servers,
                mcp_extra_tools=mcp_extra_tools,
                root_obs=root_obs,
                request=request,
                max_tool_rounds=clamp_tool_rounds(body.max_tool_rounds),
                client=client_ctx,
                preferred_machine_id=str(body.preferred_machine_id or ""),
                mem_store=mem,
                reply_to_id=body.reply_to_id,
                thread_root_id=body.thread_root_id,
                reply_context=body.reply_context,
                durable=True,
                durable_body=body,
                durable_history=history,
                durable_run_id=run_id,
                durable_langfuse_trace_id=langfuse_trace_id or "",
                durable_host_machines=host_machines,
                durable_available_tool_names=available_tool_names,
                durable_tools_on=tools_on,
                durable_llm_cw=llm_cw,
                durable_llm_model=llm_model,
            ):
                yield chunk
        elif api_key:
            scene = scene_kind(body.channel_id, body.peer_agent_id)
            recall_query = (body.reply_context or "").strip() or (user_text or "")
            recalled_buckets = mem.recall_buckets(
                recall_query,
                agent_id=body.agent_id,
                channel_id=body.channel_id or "",
                peer_agent_id=body.peer_agent_id or "",
            )
            mem0_by_scope: dict[str, list[str]] = {}
            mem0_hits: list[str] = []
            if body.user_id and str(body.user_id).strip() and mem0_store.mem0_wanted():
                uid = str(body.user_id).strip()
                for scope_name in recalled_buckets:
                    aid = body.agent_id if scope_name in ("bot", "agent_pair") else ""
                    cid = (body.channel_id or "") if scope_name == "channel" else ""
                    peer = (body.peer_agent_id or "") if scope_name == "agent_pair" else ""
                    hits = mem0_store.search_for_scope(
                        uid,
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
            memory_snippets = [r["snippet"] for r in recall_payload["items"]]
            active_skills = skill_reg.filter_meta(enabled)
            system = build_system_prompt(
                agent_id=body.agent_id,
                skills_catalog=skill_reg.catalog_for_prompt(enabled),
                memory_snippets=memory_snippets,
                tools_enabled=tools_on,
                available_tool_names=available_tool_names,
                client=client_ctx,
                machines=host_machines,
            )
            injected_lessons: list[dict[str, Any]] = []
            try:
                from . import lessons as lessons_mod

                injected_lessons, lesson_block = lessons_mod.active_lessons_with_block(
                    str(body.user_id or ""),
                    str(body.agent_id or "open-bot"),
                )
                if lesson_block:
                    system = system + "\n\n" + lesson_block
            except Exception:  # noqa: BLE001
                injected_lessons = []
            if body.system_prompt and body.system_prompt.strip():
                system = body.system_prompt.strip() + "\n\n" + system

            dialog = [m for m in history if m["role"] in ("user", "assistant", "summary")]

            async def _summarize(msgs: list[dict[str, Any]]) -> str:
                return await chat_text(msgs, api_key=api_key or "", override=override)

            compacted, compact_meta = await compact_mod.compact_messages(
                dialog,
                api_key=api_key or None,
                chat_fn=_summarize if api_key else None,
                context_window=llm_cw,
                model=llm_model,
            )
            llm_messages: list[dict[str, Any]] = assemble_llm_messages(system, compacted)
            meta = {
                "conversation_id": body.conversation_id,
                "agent_id": body.agent_id,
                "history_count": history_count,
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
            }
            if compact_meta.get("summary_new") and compact_meta.get("summary"):
                meta["summary"] = compact_meta["summary"]
            meta.update({"mode": "openai", "model": model, "base_url": base})
            lf.update_obs(
                root_obs,
                metadata={
                    "mode": "openai",
                    "model": model,
                    "tools_enabled": tools_on,
                    "history_count": history_count,
                },
            )
            yield sse("meta", meta)
            async for chunk in openai_path(
                llm_messages,
                api_key,
                override,
                mem,
                enabled_skills=enabled,
                user_id=body.user_id,
                agent_id=body.agent_id,
                channel_id=body.channel_id,
                peer_agent_id=body.peer_agent_id,
                conversation_id=body.conversation_id,
                skill_reg=skill_reg,
                mcp_servers=mcp_servers,
                mcp_extra_tools=mcp_extra_tools,
                root_obs=root_obs,
                request=request,
                max_tool_rounds=clamp_tool_rounds(body.max_tool_rounds),
                client=client_ctx,
                preferred_machine_id=str(body.preferred_machine_id or ""),
                mem_store=mem,
                reply_to_id=body.reply_to_id,
                thread_root_id=body.thread_root_id,
                reply_context=body.reply_context,
            ):
                yield chunk
        else:
            active_skills = skill_reg.filter_meta(enabled)
            system = build_system_prompt(
                agent_id=body.agent_id,
                skills_catalog=skill_reg.catalog_for_prompt(enabled),
                memory_snippets=[],
                tools_enabled=False,
                client=client_ctx,
                machines=host_machines,
            )
            dialog = [m for m in history if m["role"] in ("user", "assistant", "summary")]
            llm_messages = assemble_llm_messages(system, dialog)
            meta = {
                "conversation_id": body.conversation_id,
                "agent_id": body.agent_id,
                "history_count": history_count,
                "skills_count": len(active_skills),
                "enabled_skills": [s.name for s in active_skills],
                "run_id": run_id,
                "mode": "echo",
            }
            meta["mode"] = "echo"
            lf.update_obs(root_obs, metadata={"mode": "echo"})
            yield sse("meta", meta)
            async for chunk in echo_events(
                body,
                history_count=history_count,
                llm_messages=llm_messages,
                skill_names=[s.name for s in active_skills],
            ):
                yield chunk
            lf.update_obs(root_obs, output=lf.truncate("(echo mode)"))
    except asyncio.CancelledError:
        if root_obs is not None:
            lf.update_obs(root_obs, metadata={"cancelled": True})
        raise
    except Exception as e:  # noqa: BLE001
        lf.update_obs(root_obs, level="ERROR", status_message=str(e)[:500])
        raise
    finally:
        try:
            _trace_cm.__exit__(*sys.exc_info())
        except Exception:  # noqa: BLE001
            # Soft-fail: never convert GeneratorExit / body errors into a second exception
            pass
        lf.flush()
        reset_decision(decision_token)


async def echo_events(
    body: RunRequest,
    *,
    history_count: int,
    llm_messages: list[dict[str, Any]],
    skill_names: list[str] | None = None,
) -> AsyncIterator[str]:
    if skill_names is None:
        skill_names_s = ", ".join(s.name for s in skills.list_meta()) or "（无）"
    else:
        skill_names_s = ", ".join(skill_names) or "（无）"
    preview = []
    for m in llm_messages:
        if m["role"] == "system":
            continue
        preview.append(f"{m['role']}:{str(m['content'])[:40]}")
    preview_s = " → ".join(preview[-6:]) if preview else "(empty)"
    reply = (
        "（echo 模式）当前未配置可用的 API Key，因此不会调用真实模型。\n"
        f"agent_id={body.agent_id} history_count={history_count}\n"
        f"skills=[{skill_names_s}]\n"
        f"LLM 输入侧对话预览：{preview_s}\n"
        f"你刚才说：{body.content or '(见 messages)'}\n"
        "请在设置中配置 LLM 连接，或在根目录 .env 设置 OPENAI_API_KEY。"
    )
    try:
        for ch in reply:
            yield sse("token", {"text": ch})
            await asyncio.sleep(0.004)
        yield sse("done", {"ok": True, "mode": "echo", "history_count": history_count})
    except asyncio.CancelledError:
        yield sse("done", {"ok": False, "mode": "echo", "cancelled": True})
        raise


async def openai_path(
    llm_messages: list[dict[str, Any]],
    api_key: str,
    override: LLMOverride | None,
    mem: MemoryStore,
    enabled_skills: list[str] | None = None,
    user_id: str | None = None,
    agent_id: str | None = None,
    channel_id: str | None = None,
    peer_agent_id: str | None = None,
    conversation_id: str | None = None,
    skill_reg: SkillRegistry | None = None,
    mcp_servers: list[mcp_client.MCPServerConfig] | None = None,
    mcp_extra_tools: list[dict[str, Any]] | None = None,
    root_obs: Any | None = None,
    request: Request | None = None,
    max_tool_rounds: int = 24,
    client: ClientContext | None = None,
    preferred_machine_id: str = "",
    mem_store: MemoryStore | None = None,
    reply_to_id: str | None = None,
    thread_root_id: str | None = None,
    reply_context: str | None = None,
    *,
    durable: bool = False,
    durable_body: RunRequest | None = None,
    durable_history: list[dict[str, Any]] | None = None,
    durable_run_id: str | None = None,
    durable_langfuse_trace_id: str = "",
    durable_host_machines: list[dict[str, Any]] | None = None,
    durable_available_tool_names: list[str] | None = None,
    durable_tools_on: bool | None = None,
    durable_llm_cw: int | None = None,
    durable_llm_model: str | None = None,
) -> AsyncIterator[str]:
    allow = set(enabled_skills) if enabled_skills is not None else None
    skill_reg = skill_reg or skills_for(user_id)
    mcp_servers = list(mcp_servers or [])
    mcp_extra_tools = list(mcp_extra_tools or [])
    tools_on = tools_enabled(override)
    _, _, model_name = openai_config(override)

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        with lf.observation_tool(name, args) as tool_obs:
            try:
                out = await _tool_handler_impl(name, args)
                lf.update_obs(tool_obs, output=lf.truncate(out))
                return out
            except Exception as e:  # noqa: BLE001
                lf.update_obs(tool_obs, level="ERROR", status_message=str(e)[:500], output=str(e)[:500])
                raise

    async def _tool_handler_impl(name: str, args: dict[str, Any]) -> str:
        if name in builtin_tools.BUILTIN_TOOL_NAMES:
            out = await builtin_tools.dispatch(name, args)
            if out is not None:
                return out
        if name == "load_skill":
            skill_name = str(args.get("name") or "")
            # Pack harden: load first, then allow-check by name/dir aliases; hints discourage「技能不可用」.
            full = skill_reg.load(skill_name) if skill_reg is not None else None
            if not full:
                return json.dumps(
                    {
                        "error": "skill not found",
                        "name": skill_name,
                        "hint": "勿向用户解释内部加载失败；若是画图需求，直接输出合法 mermaid"
                        "（边标签 |\"…\"| 成对；箭头用 -->/==>，禁止 ===|）。",
                    },
                    ensure_ascii=False,
                )
            if allow is not None:
                aliases = {skill_name, full.name}
                if full.path is not None:
                    aliases.add(full.path.parent.name)
                if not (aliases & set(allow)):
                    return json.dumps(
                        {
                            "error": "skill disabled",
                            "name": full.name,
                            "hint": "勿向用户解释内部加载失败；若是画图需求，静默直接输出合法 mermaid"
                            "（边标签 |\"…\"| 成对；箭头用 -->/==>，禁止 ===|）。",
                        },
                        ensure_ascii=False,
                    )
            rel = str(args.get("path") or "").strip()
            if rel:
                content = skill_reg.read_file(skill_name, rel)
                if content is None:
                    return json.dumps(
                        {
                            "error": "skill file not found",
                            "name": skill_name,
                            "path": rel,
                            "files": skill_reg.file_paths(skill_name),
                        },
                        ensure_ascii=False,
                    )
                return json.dumps(
                    {"name": skill_name, "path": rel, "content": content},
                    ensure_ascii=False,
                )
            files = sorted(full.files.keys()) if full.files else ["SKILL.md"]
            return json.dumps(
                {
                    "name": full.name,
                    "description": full.description,
                    "body": full.body,
                    "files": files,
                },
                ensure_ascii=False,
            )
        if name == "memory_write":
            try:
                content = str(args.get("content") or "")
                scope_name, aid, cid, peer = resolve_write_scope(
                    str(args.get("scope") or ""),
                    agent_id=str(args.get("agent_id") or agent_id or ""),
                    channel_id=str(args.get("channel_id") or channel_id or ""),
                    peer_agent_id=str(args.get("peer_agent_id") or peer_agent_id or ""),
                )
                item = mem.write(
                    content,
                    tier=str(args.get("tier") or "note"),
                    tags=args.get("tags") or [],
                    scope=scope_name,
                    agent_id=aid,
                    channel_id=cid,
                    peer_agent_id=peer,
                )
                if user_id and content.strip() and mem0_store.mem0_wanted():
                    mem0_store.add_conversation(
                        str(user_id).strip(),
                        content.strip(),
                        metadata=mem0_store.scope_metadata(
                            scope_name,
                            agent_id=aid,
                            channel_id=cid,
                            peer_agent_id=peer,
                        ),
                        infer=False,
                    )
                return json.dumps(mem.to_public(item), ensure_ascii=False)
            except ValueError as e:
                return json.dumps({"error": str(e)})
        if name == "memory_recall":
            query = str(args.get("query") or "")
            buckets = mem.recall_buckets(
                query,
                agent_id=str(agent_id or ""),
                channel_id=str(channel_id or ""),
                peer_agent_id=str(peer_agent_id or ""),
                tier=args.get("tier"),
            )
            mem0_by: dict[str, list[str]] = {}
            if user_id and mem0_store.mem0_wanted():
                for scope_name in buckets:
                    mem0_by[scope_name] = mem0_store.search_for_scope(
                        str(user_id).strip(),
                        query,
                        scope=scope_name,
                        agent_id=str(agent_id or "") if scope_name in ("bot", "agent_pair") else "",
                        channel_id=str(channel_id or "") if scope_name == "channel" else "",
                        peer_agent_id=str(peer_agent_id or "") if scope_name == "agent_pair" else "",
                    )
            snippets = merge_scoped_snippets(buckets, mem0_by, scene_kind(channel_id, peer_agent_id))
            return json.dumps({"memories": snippets}, ensure_ascii=False)
        if name == "send_to_agent":
            from . import agent_bus

            try:
                result = agent_bus.send_agent_message(
                    user_id=str(user_id or ""),
                    from_agent_id=str(agent_id or "open-bot"),
                    body=str(args.get("body") or ""),
                    to_agent_id=(str(args["to_agent_id"]) if args.get("to_agent_id") else None),
                    channel_id=(str(args["channel_id"]) if args.get("channel_id") else None),
                    priority=bool(args.get("priority") or False),
                )
                return json.dumps(result, ensure_ascii=False)
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})

        if name == "sandbox_ensure":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.ensure(
                        str(user_id or ""),
                        agent_id=str(agent_id or "") or None,
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})
        if name == "sandbox_shell":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.shell(
                        str(user_id or ""),
                        str(args.get("cmd") or ""),
                        workdir=(str(args["workdir"]) if args.get("workdir") else None),
                        timeout_sec=(int(args["timeout_sec"]) if args.get("timeout_sec") is not None else None),
                        agent_id=str(agent_id or "") or None,
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})
        if name == "sandbox_read":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.read_file(
                        str(user_id or ""),
                        str(args.get("path") or ""),
                        agent_id=str(agent_id or "") or None,
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})
        if name == "sandbox_write":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.write_file(
                        str(user_id or ""),
                        str(args.get("path") or ""),
                        str(args.get("content") or ""),
                        agent_id=str(agent_id or "") or None,
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})
        if name == "sandbox_ls":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.list_dir(
                        str(user_id or ""),
                        str(args.get("path") or "/workspace"),
                        agent_id=str(agent_id or "") or None,
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})
        if name == "list_machines":
            from . import machines as machines_mod

            try:
                return json.dumps(
                    machines_mod.list_machines(str(user_id or "")),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e), "machines": [], "count": 0})
        if name in (
            "host_ls",
            "host_read",
            "host_write",
            "host_delete",
            "host_move",
            "host_open",
            "host_shell",
            "host_ssh_ls",
            "host_ssh_read",
            "host_ssh_write",
            "host_ssh_delete",
            "host_ssh_exec",
        ):
            from . import machines as machines_mod

            op = name.removeprefix("host_")
            listed = machines_mod.list_machines(str(user_id or ""))
            rows = listed.get("machines") if isinstance(listed, dict) else None
            if not isinstance(rows, list):
                err = listed.get("error") if isinstance(listed, dict) else "machines unavailable"
                return json.dumps({"ok": False, "error": err}, ensure_ascii=False)
            chosen = machines_mod.select_machine(
                rows,
                explicit_id=str(args.get("machine_id") or ""),
                current_id=(client.machine_id if client else ""),
                preferred_id=str(preferred_machine_id or ""),
            )
            if not chosen.get("ok"):
                return json.dumps(chosen, ensure_ascii=False)
            machine = chosen["machine"]
            ssh_host = ""
            ssh_user = ""
            ssh_port = 0
            if name.startswith("host_ssh_"):
                ssh_host = str(args.get("host") or "").strip()
                ssh_user = str(args.get("user") or "").strip()
                try:
                    ssh_port = int(args.get("port") or 0)
                except (TypeError, ValueError):
                    ssh_port = 0
                if not ssh_host:
                    return json.dumps(
                        {"ok": False, "error": "需要主机名、IP，或 ~/.ssh/config 里的 Host"},
                        ensure_ascii=False,
                    )
                if ssh_port < 0 or ssh_port > 65535:
                    return json.dumps({"ok": False, "error": "端口无效"}, ensure_ascii=False)
                if name == "host_ssh_exec":
                    path = str(args.get("command") or "")
                else:
                    path = _host_delete_paths(args) if name == "host_ssh_delete" else str(args.get("path") or "")
                dest = f"{ssh_user}@{ssh_host}" if ssh_user else ssh_host
                if ssh_port and ssh_port != 22:
                    dest = f"{dest}:{ssh_port}"
            else:
                if name == "host_delete":
                    path = _host_delete_paths(args)
                    dest = str(args.get("dest") or "")
                else:
                    path = str(args.get("path") or args.get("name") or args.get("command") or "")
                    dest = str(args.get("dest") or "")
                    if name == "host_shell" and bool(args.get("terminal")):
                        dest = "terminal"
            if name in ("host_delete", "host_ssh_delete") and not path.strip():
                return json.dumps({"ok": False, "error": "需要文件路径"}, ensure_ascii=False)
            ls_limit = None
            ls_sort = ""
            ls_glob = ""
            if name in ("host_ls", "host_ssh_ls"):
                if args.get("limit") is not None:
                    try:
                        ls_limit = int(args.get("limit"))
                    except (TypeError, ValueError):
                        ls_limit = None
                ls_sort = str(args.get("sort") or "").strip()
                ls_glob = str(args.get("glob") or "").strip()
            result = machines_mod.exec_host(
                str(user_id or ""),
                str(machine.get("id") or ""),
                op,
                path=path,
                dest=dest,
                content=str(args.get("content") or ""),
                conversation_id=str(conversation_id or ""),
                ssh_host=ssh_host,
                ssh_user=ssh_user,
                ssh_port=ssh_port,
                limit=ls_limit,
                sort=ls_sort,
                glob=ls_glob,
            )
            if result.get("ok"):
                machines_mod.remember_usual_device(mem_store or mem, result.get("usual"))
            return json.dumps(result, ensure_ascii=False)
        if name == "defer_work":
            from . import openbot_api as obapi
            from .harness.child import spawn_child_thread
            from .harness.config import thread_id_for as _tid_for

            try:
                parent_tid = ""
                if conversation_id and durable_run_id:
                    parent_tid = _tid_for(
                        conversation_id=str(conversation_id),
                        request_id=str(durable_run_id),
                    )
                child = None
                if parent_tid and durable_enabled():
                    child = await spawn_child_thread(
                        conversation_id=str(conversation_id or ""),
                        parent_thread_id=parent_tid,
                        user_id=str(user_id or ""),
                        agent_id=str(agent_id or ""),
                        background=True,
                        owner_task=str(args.get("goal") or "")[:200],
                    )
                out = obapi.defer_work(
                    str(user_id or ""),
                    str(conversation_id or ""),
                    str(args.get("goal") or ""),
                    agent_id=str(agent_id or "") or None,
                )
                if isinstance(out, dict) and child:
                    out["background_thread_id"] = child.get("thread_id")
                    out["background_request_id"] = child.get("request_id")
                return json.dumps(out, ensure_ascii=False)
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)}, ensure_ascii=False)
        if name == "list_routines":
            from . import openbot_api as obapi

            try:
                return json.dumps(obapi.list_routines(str(user_id or "")), ensure_ascii=False)
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)}, ensure_ascii=False)
        if name == "create_routine":
            from . import openbot_api as obapi

            try:
                fields = {
                    "name": str(args.get("name") or ""),
                    "prompt": str(args.get("prompt") or ""),
                    "schedule_cron": str(args.get("schedule_cron") or ""),
                    "timezone": str(args.get("timezone") or "") or None,
                    "agent_id": str(args.get("agent_id") or agent_id or "") or None,
                }
                if "enabled" in args:
                    fields["enabled"] = bool(args.get("enabled"))
                if args.get("triggers") is not None:
                    fields["triggers"] = args.get("triggers")
                if args.get("max_retries") is not None:
                    fields["max_retries"] = int(args.get("max_retries"))
                if "quiet_unchanged" in args:
                    fields["quiet_unchanged"] = bool(args.get("quiet_unchanged"))
                pin = args.get("pin_current_conversation")
                if pin is None or pin is True:
                    fields["conversation_id"] = str(conversation_id or "")
                # drop Nones
                fields = {k: v for k, v in fields.items() if v is not None}
                return json.dumps(obapi.create_routine(str(user_id or ""), **fields), ensure_ascii=False)
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)}, ensure_ascii=False)
        if name in ("update_routine", "pause_routine", "resume_routine"):
            from . import openbot_api as obapi

            try:
                rid = str(args.get("id") or "")
                fields = {}
                if name == "pause_routine":
                    fields["enabled"] = False
                elif name == "resume_routine":
                    fields["enabled"] = True
                else:
                    for key in (
                        "name",
                        "prompt",
                        "schedule_cron",
                        "timezone",
                        "agent_id",
                        "conversation_id",
                    ):
                        if key in args and args.get(key) is not None:
                            fields[key] = args.get(key)
                    if "enabled" in args:
                        fields["enabled"] = bool(args.get("enabled"))
                    if args.get("triggers") is not None:
                        fields["triggers"] = args.get("triggers")
                    if args.get("max_retries") is not None:
                        fields["max_retries"] = int(args.get("max_retries"))
                    if "quiet_unchanged" in args:
                        fields["quiet_unchanged"] = bool(args.get("quiet_unchanged"))
                return json.dumps(
                    obapi.update_routine(str(user_id or ""), rid, **fields),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)}, ensure_ascii=False)
        if name == "delete_routine":
            from . import openbot_api as obapi

            try:
                return json.dumps(
                    obapi.delete_routine(str(user_id or ""), str(args.get("id") or "")),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)}, ensure_ascii=False)
        if name == "clone_agent":
            from . import openbot_api as obapi

            if (channel_id or "").strip() or (peer_agent_id or "").strip():
                return json.dumps(
                    {"ok": False, "error": "只能在与用户的单聊里复制助手；群聊或助手间对话中不可用"},
                    ensure_ascii=False,
                )
            if not (user_id or "").strip() or not (agent_id or "").strip():
                return json.dumps({"ok": False, "error": "缺少用户或助手身份，无法复制"}, ensure_ascii=False)
            try:
                res = obapi.clone_agent(
                    str(user_id),
                    str(agent_id),
                    **obapi.clone_agent_args(args),
                )
                return json.dumps(obapi.summarize_clone_result(res), ensure_ascii=False)
            except Exception as e:  # noqa: BLE001
                return json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)
        if name == "request_secret":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.request_secret(
                        str(user_id or ""),
                        agent_id=str(agent_id or "") or None,
                        conversation_id=str(conversation_id or "") or None,
                        name=str(args.get("name") or ""),
                        origin=str(args.get("origin") or ""),
                        auth_type=str(args.get("auth_type") or "bearer"),
                        reason=str(args.get("reason") or ""),
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})
        if name == "secret_http":
            from . import sandbox as sbx

            try:
                return json.dumps(
                    sbx.secret_http(
                        str(user_id or ""),
                        str(args.get("name") or ""),
                        agent_id=str(agent_id or "") or None,
                        method=str(args.get("method") or "GET"),
                        url=str(args.get("url") or ""),
                        body=str(args.get("body") or ""),
                    ),
                    ensure_ascii=False,
                )
            except Exception as e:  # noqa: BLE001
                return json.dumps({"error": str(e)})

        if name.startswith("mcp__") or mcp_client.parse_qualified_tool(name):
            result = await mcp_client.resolve_and_call(
                servers=mcp_servers,
                qualified_or_tool=name,
                arguments=args,
            )
            return json.dumps(result, ensure_ascii=False)
        return json.dumps({"error": f"unknown tool {name}"})

    if durable:
        token = bind_tool_handler(tool_handler)
        try:
            async for chunk in run_durable_events(
                body=durable_body or RunRequest(conversation_id=str(conversation_id or "x")),
                history=list(durable_history or llm_messages),
                api_key=api_key,
                override=override,
                run_id=durable_run_id,
                request_id=getattr(durable_body, "request_id", None) if durable_body else None,
                langfuse_trace_id=durable_langfuse_trace_id,
                root_obs=root_obs,
                max_tool_rounds=max_tool_rounds,
                configurable_extra={
                    "extra_tools": mcp_extra_tools,
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "conversation_id": conversation_id,
                    "channel_id": channel_id,
                    "peer_agent_id": peer_agent_id,
                    "mem_store": mem_store or mem,
                    "skill_reg": skill_reg,
                    "enabled_skills": enabled_skills,
                    "client": client,
                    "host_machines": durable_host_machines,
                    "available_tool_names": durable_available_tool_names,
                    "tools_on": tools_on if durable_tools_on is None else durable_tools_on,
                    "llm_context_window": durable_llm_cw,
                    "llm_model": durable_llm_model or model_name,
                    "background": bool(
                        getattr(durable_body, "background", False) if durable_body else False
                    ),
                    "owner_task": str(
                        getattr(durable_body, "owner_task", "") or ""
                    )
                    if durable_body
                    else "",
                    "owner_thread_id": str(
                        getattr(durable_body, "owner_thread_id", "") or ""
                    )
                    if durable_body
                    else "",
                },
            ):
                if request is not None and await request.is_disconnected():
                    raise asyncio.CancelledError()
                yield chunk
        finally:
            reset_tool_handler(token)
        return

    # DEPRECATED: RUNTIME_DURABLE=0 fallback. Prefer LangGraph harness + journal.
    presence = PresencePublisher(
        conversation_id,
        agent_id,
        user_id=user_id,
    )
    try:
        await presence.set("thinking")
        yield sse("status", {"phase": "thinking", "label": "正在思考…"})
        lf.event_status("thinking", "正在思考…")

        status_q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def on_status(payload: dict[str, Any]) -> None:
            phase = str(payload.get("phase") or "")
            label = str(payload.get("label") or "")
            if phase:
                lf.event_status(phase, label)
            if phase == "tool":
                await presence.set("working")
            elif phase in ("tool_done", "thinking") or "正在思考" in label:
                await presence.set("thinking")
            await status_q.put(payload)

        with lf.observation_generation(
            name="open-bot.llm",
            model=model_name,
            input_messages=llm_messages,
            metadata={"tools_enabled": tools_on},
        ) as gen_obs:
            loop_task = asyncio.create_task(
                run_tool_loop(
                    llm_messages,
                    api_key=api_key,
                    tool_handler=tool_handler,
                    max_rounds=max_tool_rounds,
                    override=override,
                    extra_tools=mcp_extra_tools or None,
                    on_status=on_status,
                )
            )
            try:
                while not loop_task.done():
                    if request is not None and await request.is_disconnected():
                        loop_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError):
                            await loop_task
                        raise asyncio.CancelledError()
                    try:
                        payload = await asyncio.wait_for(status_q.get(), timeout=0.08)
                        yield sse("status", payload)
                    except asyncio.TimeoutError:
                        await asyncio.sleep(0)
                while not status_q.empty():
                    yield sse("status", status_q.get_nowait())
                final, used_tools, usage_details = await loop_task
            except asyncio.CancelledError:
                if not loop_task.done():
                    loop_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await loop_task
                if root_obs is not None:
                    lf.update_obs(root_obs, metadata={"cancelled": True})
                with contextlib.suppress(Exception):
                    yield sse("done", {"ok": False, "mode": "openai", "cancelled": True})
                raise
            if used_tools:
                yield sse("meta", {"tools_used": used_tools})
            assistant_parts: list[str] = []
            if final == REASONING_ONLY:
                # Reasoning tags only — do not start a second completion, do not emit them.
                final = ""
            elif not final:
                # Streaming fallback: most OpenAI-compatible gateways omit usage
                # on SSE chunks unless stream_options.include_usage is set; we
                # leave usage_details as returned from the (empty) tool loop.
                async for text in stream_chat_tokens(
                    llm_messages, api_key=api_key, override=override
                ):
                    if request is not None and await request.is_disconnected():
                        raise asyncio.CancelledError()
                    assistant_parts.append(text)
                streamed = "".join(assistant_parts)
                streamed = strip_think(strip_tool_markup(streamed))
                if not tools_on:
                    streamed = sanitize_fake_tool_narration(streamed)
                assistant_parts = [streamed] if streamed else []
                for i in range(0, len(streamed), 24):
                    yield sse("token", {"text": streamed[i : i + 24]})
                    await asyncio.sleep(0.002)
            else:
                final = strip_think(strip_tool_markup(final))
                if not tools_on:
                    final = sanitize_fake_tool_narration(final)
                assistant_parts.append(final)
                for i in range(0, len(final), 24):
                    yield sse("token", {"text": final[i : i + 24]})
                    await asyncio.sleep(0.002)
            assistant_reply = "".join(assistant_parts)
            # usage_details already Langfuse-shaped (or None) from run_tool_loop
            gen_update: dict[str, Any] = {
                "output": lf.truncate(assistant_reply),
                "model": model_name,
            }
            if usage_details:
                gen_update["usage_details"] = usage_details
            lf.update_obs(gen_obs, **gen_update)
            if root_obs is not None:
                root_meta: dict[str, Any] = {
                    "tools_used": used_tools or [],
                }
                if usage_details:
                    root_meta["usage_tokens"] = usage_details
                lf.update_obs(
                    root_obs,
                    output=lf.truncate(assistant_reply),
                    metadata=root_meta,
                )
            if user_id and assistant_reply.strip() and mem0_store.mem0_auto_add():
                history_for_mem0 = [m for m in llm_messages if m.get("role") in ("user", "assistant")]
                turn = mem0_store.last_turn_messages(history_for_mem0, assistant_reply, window=4)
                turn = thread_context.augment_mem0_turn(turn, reply_context)
                try:
                    scope_name, aid, cid, peer = resolve_write_scope(
                        "",
                        agent_id=str(agent_id or ""),
                        channel_id=str(channel_id or ""),
                        peer_agent_id=str(peer_agent_id or ""),
                    )
                    meta = mem0_store.scope_metadata(
                        scope_name, agent_id=aid, channel_id=cid, peer_agent_id=peer
                    )
                except ValueError:
                    meta = mem0_store.scope_metadata("user")
                if reply_to_id:
                    meta["reply_to_id"] = str(reply_to_id)
                if thread_root_id:
                    meta["thread_root_id"] = str(thread_root_id)
                mem0_store.add_conversation_bg(str(user_id).strip(), turn, metadata=meta)
            if user_id and assistant_reply.strip():
                dream.maybe_consolidate_user_bg(str(user_id).strip())
            done_payload: dict[str, Any] = {
                "ok": True,
                "mode": "openai",
                "tools_used": used_tools,
            }
            if usage_details:
                done_payload["usage"] = usage_details
            yield sse("done", done_payload)
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001
        if root_obs is not None:
            lf.update_obs(root_obs, level="ERROR", status_message=str(e)[:500])
        await presence.set("error")
        yield sse("error", {"message": str(e)})
        yield sse("done", {"ok": False, "mode": "openai"})



class SteerRequest(BaseModel):
    conversation_id: str = Field(..., min_length=1)
    request_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    mode: str = Field(default="follow_up")  # follow_up | steer | reject
    when_busy: str | None = None


class AbortRequest(BaseModel):
    conversation_id: str = Field(..., min_length=1)
    request_id: str = Field(..., min_length=1)


class ApproveRequest(BaseModel):
    conversation_id: str = Field(..., min_length=1)
    request_id: str = Field(..., min_length=1)
    approve: bool = True
    reason: str = ""


@app.post("/v1/runs/steer")
async def runs_steer(body: SteerRequest) -> dict:
    from .harness import steer as steer_mod

    tid = thread_id_for(conversation_id=body.conversation_id, request_id=body.request_id)
    mode = (body.when_busy or body.mode or "follow_up").strip()
    return await steer_mod.steer_thread(
        tid,
        text=body.text,
        mode=mode,
        conversation_id=body.conversation_id,
        request_id=body.request_id,
    )


@app.post("/v1/runs/abort")
async def runs_abort(body: AbortRequest) -> dict:
    from .harness import steer as steer_mod

    tid = thread_id_for(conversation_id=body.conversation_id, request_id=body.request_id)
    return await steer_mod.abort_thread(tid)


@app.post("/v1/runs/approve")
async def runs_approve(body: ApproveRequest) -> dict:
    from .harness import steer as steer_mod

    tid = thread_id_for(conversation_id=body.conversation_id, request_id=body.request_id)
    return await steer_mod.approve_thread(
        tid, approve=body.approve, reason=body.reason
    )


@app.get("/v1/runs/state")
async def runs_state(
    conversation_id: str = Query(..., min_length=1),
    request_id: str = Query(..., min_length=1),
) -> dict:
    from .harness import steer as steer_mod

    tid = thread_id_for(conversation_id=conversation_id, request_id=request_id)
    return await steer_mod.get_thread_state(tid)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
