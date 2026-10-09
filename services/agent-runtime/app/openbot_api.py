"""Internal HTTP helpers for defer_work / routine tools (same auth as sandbox)."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

DEFAULT_API_URL = "http://127.0.0.1:18080"
DEFAULT_INTERNAL_TOKEN = "open-bot-dev-internal"


def _api_base() -> str:
    return (os.getenv("OPENBOT_API_URL") or os.getenv("API_BASE_URL") or DEFAULT_API_URL).rstrip(
        "/"
    )


def _internal_token() -> str:
    return (
        (os.getenv("INTERNAL_TOKEN") or os.getenv("OPENBOT_INTERNAL_TOKEN") or DEFAULT_INTERNAL_TOKEN)
        .strip()
        or DEFAULT_INTERNAL_TOKEN
    )


def _post(path: str, payload: dict[str, Any], timeout: float = 60.0) -> dict[str, Any]:
    url = f"{_api_base()}{path}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": _internal_token(),
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"openbot api HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"openbot api unreachable: {e}") from e


def defer_work(
    user_id: str,
    conversation_id: str,
    goal: str,
    *,
    agent_id: str | None = None,
) -> dict[str, Any]:
    return _post(
        "/internal/conversation-tasks/enqueue",
        {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "agent_id": agent_id or "",
            "goal": goal,
        },
    )


def list_routines(user_id: str) -> dict[str, Any]:
    return _post("/internal/routines/list", {"user_id": user_id})


def create_routine(user_id: str, **fields: Any) -> dict[str, Any]:
    payload = {"user_id": user_id, **fields}
    return _post("/internal/routines/create", payload)


def update_routine(user_id: str, routine_id: str, **fields: Any) -> dict[str, Any]:
    payload = {"user_id": user_id, "id": routine_id, **fields}
    return _post("/internal/routines/update", payload)


def delete_routine(user_id: str, routine_id: str) -> dict[str, Any]:
    return _post("/internal/routines/delete", {"user_id": user_id, "id": routine_id})


ROUTINE_TOOL_DEFS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "defer_work",
            "description": (
                "耗时工作入后台；调用后一句确认（如「还在做，好了发这里。」）并停本轮重活，"
                "同一会话交付。勿只靠口头「稍后」。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {
                        "type": "string",
                        "description": "后台要完成的目标（完整、可执行）",
                    },
                },
                "required": ["goal"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_routines",
            "description": "列出当前用户的例行任务（cron 与事件触发器）。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_routine",
            "description": (
                "创建例行任务。可设 schedule_cron（5 字段）和/或 triggers（Slack/GitHub 事件）。"
                "默认绑定当前会话 conversation_id，后续触发会复用该会话并注入 [routine] 提示。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "prompt": {"type": "string", "description": "每次触发时交给助手的任务说明"},
                    "schedule_cron": {
                        "type": "string",
                        "description": "5 字段 cron，如 0 9 * * *；纯事件触发可留空",
                    },
                    "timezone": {
                        "type": "string",
                        "description": "IANA 时区，默认 Asia/Shanghai",
                    },
                    "enabled": {"type": "boolean"},
                    "agent_id": {"type": "string"},
                    "triggers": {
                        "type": "array",
                        "description": (
                            "事件监听器，例如 "
                            '[{"source":"slack","type":"app_mention"},'
                            '{"source":"slack","type":"keyword","keywords":["日报"]},'
                            '{"source":"github","type":"pull_request","actions":["opened"],"repo":"org/repo"}]'
                        ),
                        "items": {"type": "object"},
                    },
                    "max_retries": {"type": "integer"},
                    "quiet_unchanged": {
                        "type": "boolean",
                        "description": "结果与上次相同时静默（ok_quiet）",
                    },
                    "pin_current_conversation": {
                        "type": "boolean",
                        "description": "默认 true：绑定当前会话",
                    },
                },
                "required": ["name", "prompt"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_routine",
            "description": "更新例行任务字段（含 enabled 暂停/恢复）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "prompt": {"type": "string"},
                    "schedule_cron": {"type": "string"},
                    "timezone": {"type": "string"},
                    "enabled": {"type": "boolean"},
                    "agent_id": {"type": "string"},
                    "triggers": {"type": "array", "items": {"type": "object"}},
                    "max_retries": {"type": "integer"},
                    "quiet_unchanged": {"type": "boolean"},
                    "conversation_id": {"type": "string"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pause_routine",
            "description": "暂停例行任务（enabled=false）。",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "resume_routine",
            "description": "恢复例行任务（enabled=true）。",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_routine",
            "description": "删除例行任务。",
            "parameters": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
            },
        },
    },
]

ROUTINE_TOOL_NAMES = frozenset(
    str((t.get("function") or {}).get("name") or "") for t in ROUTINE_TOOL_DEFS
)

CLONE_AGENT_FIELDS = (
    "name",
    "description",
    "system_prompt",
    "system_prompt_append",
    "computer_mode",
    "copy_memory",
    "copy_routines",
    "enable_skills",
    "disable_skills",
    "follow_up",
)


def clone_agent(user_id: str, source_agent_id: str, **fields: Any) -> dict[str, Any]:
    """Copy a bot owned by user_id (Go enforces ownership → org/tenant safe)."""
    payload: dict[str, Any] = {"user_id": user_id, "source_agent_id": source_agent_id}
    for k in CLONE_AGENT_FIELDS:
        if k in fields and fields[k] is not None:
            payload[k] = fields[k]
    return _post("/internal/agents/clone", payload)


def clone_agent_args(args: dict[str, Any]) -> dict[str, Any]:
    """Normalize model tool args for clone_agent (drop empties, coerce types).

    Defaults: copy_memory=True (bot-scoped DB memories). When follow_up / handoff_task
    is set, copy_memory is always forced on so the copy can continue related past work.
    """
    out: dict[str, Any] = {}
    # handoff_task is an alias for follow_up (same handoff / follow-up task).
    follow = str(args.get("follow_up") or args.get("handoff_task") or "").strip()
    for k in ("name", "system_prompt_append"):
        v = str(args.get(k) or "").strip()
        if v:
            out[k] = v
    if follow:
        out["follow_up"] = follow
    for k in ("description", "system_prompt"):
        if k in args and args.get(k) is not None:
            v = str(args.get(k) or "").strip()
            if v:
                out[k] = v
    mode = str(args.get("computer_mode") or "").strip().lower()
    if mode in ("team", "private"):
        out["computer_mode"] = mode
    # copy_memory defaults true; follow-up / handoff always copies agent memory.
    if "copy_memory" in args:
        out["copy_memory"] = bool(args.get("copy_memory"))
    else:
        out["copy_memory"] = True
    if follow:
        out["copy_memory"] = True
    if "copy_routines" in args:
        out["copy_routines"] = bool(args.get("copy_routines"))
    for k in ("enable_skills", "disable_skills"):
        raw = args.get(k)
        if isinstance(raw, str):
            raw = [x for x in raw.replace("，", ",").split(",")]
        if isinstance(raw, list):
            names = [str(x).strip() for x in raw if str(x).strip()]
            if names:
                out[k] = names
    return out


def summarize_clone_result(res: dict[str, Any]) -> dict[str, Any]:
    """Compact tool result for the model (what was copied, new id/name, follow-up state)."""
    agent = res.get("agent") if isinstance(res.get("agent"), dict) else {}
    out: dict[str, Any] = {
        "ok": bool(res.get("ok")),
        "new_agent_id": agent.get("id"),
        "new_agent_name": agent.get("name"),
        "conversation_id": res.get("conversation_id"),
        "copied": {
            "persona": True,
            "skills": "沿用账号启用的全部技能" if res.get("skills_inherit_account") else f"{res.get('skills_copied', 0)} 条 Skills 设置",
            "bot_memories": res.get("memories_copied", 0),
            "routines_paused": res.get("routine_names") or [],
        },
        "enabled_skills": res.get("enabled_skills"),
        "shared": res.get("shared"),
        "not_copied": res.get("not_copied"),
        "hint": "告诉用户新助手名称；它已出现在左侧「助手」列表，点开即可单聊。复制的例行任务处于暂停，需要时再开启。",
    }
    for k in ("follow_up_status", "follow_up_task_id", "follow_up_error", "skill_errors", "warning"):
        if res.get(k):
            out[k] = res[k]
    return out


AGENT_TOOL_DEFS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "clone_agent",
            "description": (
                "复制当前助手（你自己）为一个新的助手。仅在与用户单聊、且用户明确想要复制/克隆/再要一个同样的助手，"
                "或「复制一个然后把副本改成… / 让副本去做…」时调用；意图不明确先问一句，不要用来新建无关的空白助手。"
                "默认复制：名称（加「副本」）、岗位描述、人设、电脑模式、本助手的 Skills 开关、本助手专属记忆（copy_memory 默认 true；"
                "用户明确不要记忆时再设 false）。当新任务与过去工作相关、或设置了 follow_up 交接任务时，一定会复制助手记忆，"
                "即使 copy_memory=false 也会强制开启，以便副本承接旧上下文。"
                "共享不需复制：用户级记忆、账号技能库、模型连接、MCP、已登记电脑。"
                "不复制：聊天记录、群聊成员身份、助手密钥、私有文件。"
                "例行任务只有用户要求时才设 copy_routines（复制后为暂停，避免重复触发）。"
                "要改副本：一次给出 name / description / system_prompt_append / enable_skills / disable_skills。"
                "要副本去做事：写在 follow_up，副本会在它自己的会话里后台完成，你不要自己代做。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "新助手名称；不填为「原名 副本」"},
                    "description": {"type": "string", "description": "替换岗位描述；不填沿用"},
                    "system_prompt": {"type": "string", "description": "整段替换人设；通常用 system_prompt_append"},
                    "system_prompt_append": {
                        "type": "string",
                        "description": "追加到复制来的人设后面，用于把副本专门化",
                    },
                    "computer_mode": {"type": "string", "enum": ["team", "private"]},
                    "copy_memory": {
                        "type": "boolean",
                        "description": (
                            "复制本助手专属记忆（Postgres scope=bot），默认 true。"
                            "新任务与过去工作相关或设置了 follow_up 时始终为 true（不可关掉）。"
                        ),
                    },
                    "copy_routines": {"type": "boolean", "description": "复制本助手的例行任务（暂停状态），默认 false"},
                    "enable_skills": {"type": "array", "items": {"type": "string"}},
                    "disable_skills": {"type": "array", "items": {"type": "string"}},
                    "follow_up": {
                        "type": "string",
                        "description": "复制后交给新助手执行的任务（完整、可执行）；没有就不填",
                    },
                },
            },
        },
    },
]

AGENT_TOOL_NAMES = frozenset(
    str((t.get("function") or {}).get("name") or "") for t in AGENT_TOOL_DEFS
)


def record_memory_recall(payload: dict[str, Any], timeout: float = 10.0) -> dict[str, Any]:
    """Persist one run's recall payload via Go internal API (optional / fallback)."""
    return _post("/internal/memory-recalls", payload, timeout=timeout)

