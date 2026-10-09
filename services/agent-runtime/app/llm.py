"""OpenAI-compatible chat + light tool loop."""

from __future__ import annotations

import asyncio
import logging
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import httpx

from .builtin_tools import BUILTIN_TOOL_DEFS
from .openbot_api import AGENT_TOOL_DEFS, ROUTINE_TOOL_DEFS
from .deferral import CONTINUE_WORK, host_followup_prompt, last_real_user_text, turn_unfinished
from .client_env import (
    ClientContext,
    format_environment_block,
    format_tools_routing_block,
    tool_display_label,
)
from .model_compat import (
    adapt_chat_payload,
    postprocess_text,
    profile_for,
    strip_think_tags,
)
from .tool_markup import (
    content_has_tool_markup,
    parse_tool_markup,
    strip_tool_markup,
    to_openai_tool_calls,
)

ToolHandler = Callable[[str, dict[str, Any]], Awaitable[str]]
StatusCallback = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class LLMOverride:
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    enable_tools: bool | None = None


def strip_think(text: str) -> str:
    """Remove reasoning tags (<think>, <thinking>, <redacted_thinking>) from model output."""
    return strip_think_tags(text)


# Truthy placeholder: the model replied with reasoning only. Callers must not
# treat this as "no completion" and start another stream (which would leak tags
# or double-call). Never persist this value.
REASONING_ONLY = "\u2063"


# Cap quoted tool output so a think-only follow-up still shows the data
# without pasting an unbounded host_shell dump into the chat.
_TOOL_QUOTE_LIMIT = 4000

_TOOL_QUOTE_SKIP = {
    "ok",
    "error",
    "req_id",
    "machine_id",
    "type",
    "terminal",
    "usual",
    "retry",
    "command",
    "label",
    "exit_code",
    "denied",
}


def _tool_payloads(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for message in messages or []:
        if not isinstance(message, dict) or message.get("role") != "tool":
            continue
        raw = str(message.get("content") or "")
        if not raw.strip():
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            obj = None
        if isinstance(obj, dict):
            payloads.append(obj)
        else:
            payloads.append({"output": raw.strip()})
    return payloads


def _payload_error(obj: dict[str, Any]) -> str:
    err = str(obj.get("error") or "").strip()
    if not err and obj.get("ok") is False:
        err = "工具失败"
    return err


def _payload_text(obj: dict[str, Any]) -> str:
    """Stdout/stderr (or the rest of a non-shell tool result) the user should see."""
    parts: list[str] = []
    for key in ("output", "stdout", "stderr"):
        val = obj.get(key)
        if isinstance(val, str):
            text = val.strip()
        elif val in (None, "", [], {}):
            continue
        else:
            text = json.dumps(val, ensure_ascii=False)
        if text and text not in parts:
            parts.append(text)
    if parts:
        return "\n".join(parts)
    rest = {
        key: value
        for key, value in obj.items()
        if key not in _TOOL_QUOTE_SKIP and value not in (None, "", [], {})
    }
    if not rest:
        return ""
    return json.dumps(rest, ensure_ascii=False, indent=2)


def _quote_tool_outputs(payloads: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    seen: set[str] = set()
    for obj in payloads:
        text = _payload_text(obj)
        if not text or text in seen:
            continue
        seen.add(text)
        cmd = " ".join(str(obj.get("command") or "").split())
        if len(cmd) > 180:
            cmd = cmd[:180] + "…"
        blocks.append(f"`{cmd}`\n{text}" if cmd else text)
    if not blocks:
        return ""
    body = "\n\n".join(blocks)
    if len(body) > _TOOL_QUOTE_LIMIT:
        body = body[:_TOOL_QUOTE_LIMIT].rstrip() + "\n…（输出过长，已截断）"
    return "结果如下：\n\n" + body


# Spoken to the model inside the tool result (ReAct observation), not a
# second hardcoded shell. The model must choose the next command.
CHEAPER_HOST_RETRY = (
    "这一步没做成。根据上面的错误换一条命令再调用 host_shell，不要重复同一条命令。"
    "find 里不要写字面量 $，也不要对每个文件 -exec stat。输出保持短。"
    "这是给你的观察，不是给用户的答复。"
)

# When the model answers with no new tool call after a failed host tool,
# nudge it to revise and call a tool again. Any reply counts, including a
# short Chinese conclusion — not only think-only/empty. Cap so the turn
# cannot spin. Providers that already accept tool_choice get
# tool_choice=required on that revise round instead of this message;
# providers that lack tool_choice get the message. Same cap either way.
# Never re-run the shell from here.
TOOL_FAIL_NUDGE_CAP = 2
TOOL_FAIL_NUDGE = (
    "还没做完。根据工具返回的错误换一条命令，再次调用工具；不要重复同一条命令。"
    "不要用一段结论结束这一轮。"
)

# Truncate oversized tool observations before they enter model context.
# Keep head + tail so errors at either end remain visible.
_TOOL_CONTEXT_LIMIT = 12_000
_TOOL_CONTEXT_HEAD = 7_000
_TOOL_CONTEXT_TAIL = 3_500
_CONTEXT_OVERFLOW_RETRIES = 2

# Interactive turns need room for multi-step host lookups (list → query → follow-ups).
# Org admin may raise further via llm_max_tool_rounds (clamped by MAX_TOOL_ROUNDS).
DEFAULT_TOOL_ROUNDS = 24
MAX_TOOL_ROUNDS = 48

DEFER_ON_EXHAUST_REPLY = "还在做，好了发这里。"


def truncate_tool_result_for_context(
    text: str,
    *,
    limit: int = _TOOL_CONTEXT_LIMIT,
    head: int = _TOOL_CONTEXT_HEAD,
    tail: int = _TOOL_CONTEXT_TAIL,
) -> str:
    """Keep head and tail of a huge tool result; insert a short omission note."""
    raw = str(text or "")
    if len(raw) <= limit:
        return raw
    head_n = max(0, min(head, limit))
    tail_n = max(0, min(tail, limit - head_n))
    omitted = max(0, len(raw) - head_n - tail_n)
    note = f"\n…[truncated {omitted} chars; kept head+tail]…\n"
    if tail_n <= 0:
        return raw[:head_n] + note.rstrip() + "\n"
    return raw[:head_n] + note + raw[-tail_n:]


def is_context_length_error(message: str) -> bool:
    """Detect upstream failures caused by prompt / context window overflow."""
    m = (message or "").lower()
    needles = (
        "context_length_exceeded",
        "context length",
        "maximum context",
        "prompt is too long",
        "prompt too long",
        "too many tokens",
        "token limit",
        "context window",
        "exceeds the model",
        "exceeded model token",
        "max context",
        "string_above_max_length",
        "tokens exceed",
    )
    return any(n in m for n in needles)


_NO_RETRY_HINT = (
    "没开着",
    "没有已打开",
    "有多台电脑",
    "用户拒绝",
    "不允许",
    "写入已关闭",
    "需要主机名",
    "需要文件路径",
    "端口无效",
)

_ERRORISH_OUTPUT = re.compile(
    r"(?i)("
    r"unknown primary or operator|"
    r"command not found|"
    r"syntax error|"
    r"not a valid|"
    r"illegal option|"
    r"invalid option|"
    r"No such file or directory|"
    r"^find:\s|"
    r"^usage:\s|"
    r"找不到命令|"
    r"没有那个文件|"
    r"语法错误"
    r")"
)


def _strip_retry_note(text: str) -> str:
    raw = str(text or "")
    if not raw:
        return ""
    if CHEAPER_HOST_RETRY in raw:
        raw = raw.replace(CHEAPER_HOST_RETRY, "")
    return raw.strip(" \n;")


def _errorish_line(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return False
    return bool(_ERRORISH_OUTPUT.search(s))


def _useful_shell_output(obj: dict[str, Any]) -> str:
    """Real command output, excluding stderr-style error dumps merged into output."""
    chunks: list[str] = []
    for key in ("stdout", "output"):
        val = obj.get(key)
        if not isinstance(val, str):
            continue
        kept: list[str] = []
        for line in val.splitlines():
            if _errorish_line(line):
                continue
            if line.strip():
                kept.append(line)
        if kept:
            chunks.append("\n".join(kept).strip())
    for chunk in chunks:
        if chunk:
            return chunk
    return ""


def _observation_blob(obj: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("error", "stderr", "stdout", "output"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip() and val.strip() not in parts:
            parts.append(val.strip())
    return "\n".join(parts)


def _error_summary(obj: dict[str, Any]) -> str:
    err = _strip_retry_note(str(obj.get("error") or ""))
    if err and err != CHEAPER_HOST_RETRY:
        return err
    for key in ("stderr", "output", "stdout"):
        val = obj.get(key)
        if not isinstance(val, str):
            continue
        lines = [ln.strip() for ln in val.splitlines() if _errorish_line(ln)]
        if lines:
            return "\n".join(lines)
    return _observation_blob(obj).strip()


def tool_observation_failed(obj: dict[str, Any] | None) -> bool:
    """True when a tool observation is an error or useless (no real stdout).

    Used for ReAct: feed the observation back so the *model* revises the
    next command. Never auto-re-executes the same shell.
    """
    if not isinstance(obj, dict):
        return False
    if obj.get("denied"):
        return False
    err = _strip_retry_note(str(obj.get("error") or ""))
    if any(mark in err for mark in _NO_RETRY_HINT):
        return False
    if obj.get("ok") is False:
        return True
    code = obj.get("exit_code")
    try:
        if code is not None and int(code) != 0:
            return True
    except (TypeError, ValueError):
        pass
    blob = _observation_blob(obj)
    if blob and _ERRORISH_OUTPUT.search(blob) and not _useful_shell_output(obj):
        return True
    return False


def tool_result_fallback(messages: list[dict[str, Any]]) -> str:
    """Visible reply when tools already ran but the model left no user-facing text.

    A timed-out tool keeps the strategy hint. Other failures show a short
    Chinese failure (command + error) — not an apology and not a raw dump
    treated as success. A successful result is quoted (truncated if huge).
    """
    payloads = _tool_payloads(messages)
    last = payloads[-1] if payloads else None
    err = _payload_error(last) if last else ""
    err_clean = _strip_retry_note(err)
    if _timeoutish(err) or _timeoutish(err_clean):
        return (
            "刚才的命令超过时限被停掉了，所以这次没有查完。"
            "我可以改成更快的查法再试，比如只看目录顶层，或用 du 取最大的几条摘要。"
        )
    if last and tool_observation_failed(last):
        detail = err_clean if err_clean and err_clean != "工具失败" else _error_summary(last)
        detail = _strip_retry_note(detail) or "没有有用输出"
        short = " ".join(detail.split())
        if len(short) > 200:
            short = short[:200] + "…"
        cmd = " ".join(str(last.get("command") or "").split())
        if len(cmd) > 120:
            cmd = cmd[:120] + "…"
        if cmd:
            return f"命令执行失败：`{cmd}`\n{short}"
        return f"命令执行失败：{short}"
    # Quote useful successes only — do not mix earlier failed observations
    # into the visible reply after a later retry worked.
    good = [p for p in payloads if not tool_observation_failed(p)]
    quoted = _quote_tool_outputs(good or payloads)
    if quoted:
        return quoted
    return "命令已经执行完，但没有可显示的输出。"


def _timeoutish(err: str) -> bool:
    folded = err.lower()
    return (
        "超时" in err
        or "timed out" in folded
        or "timeout" in folded
        or ("超过" in err and "秒" in err)
        or "没有在时限内" in err
    )


def _last_tool_payload(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    payloads = _tool_payloads(messages)
    return payloads[-1] if payloads else None


def _is_host_tool(name: str) -> bool:
    return name == "host_shell" or name.startswith("host_")


def _last_executed_tool(messages: list[dict[str, Any]]) -> tuple[str, dict[str, Any] | None]:
    """Name and JSON payload of the most recent tool result."""
    id_to_name: dict[str, str] = {}
    name = ""
    payload: dict[str, Any] | None = None
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        role = message.get("role")
        if role == "assistant":
            for tc in message.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") or {}
                id_to_name[str(tc.get("id") or "")] = str(fn.get("name") or "")
        elif role == "tool":
            name = id_to_name.get(str(message.get("tool_call_id") or ""), "")
            raw = str(message.get("content") or "")
            obj = None
            if raw.strip():
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    obj = None
            if isinstance(obj, dict):
                payload = obj
            elif raw.strip():
                payload = {"output": raw.strip()}
            else:
                payload = None
    return name, payload


def guide_tool_result(name: str, result: str) -> str:
    """Annotate a failed/useless host tool observation for a ReAct revise.

    Returns the observation (with a short revise note) to the model. Does not
    re-execute any command — the model must decide the next tool call.
    """
    raw = result if isinstance(result, str) else str(result or "")
    hostish = name == "host_shell" or name.startswith("host_")
    if not hostish:
        return raw
    try:
        obj = json.loads(raw) if raw.strip() else None
    except json.JSONDecodeError:
        obj = None
    if isinstance(obj, dict):
        if obj.get("denied"):
            return raw
        err = str(obj.get("error") or "")
        if any(mark in err for mark in _NO_RETRY_HINT):
            return raw
        failed = tool_observation_failed(obj)
        if not failed:
            return raw
        if name != "host_shell" and not _timeoutish(err) and not _timeoutish(
            _observation_blob(obj)
        ):
            return raw
        if CHEAPER_HOST_RETRY in err or obj.get("retry") == CHEAPER_HOST_RETRY:
            return raw
        out = dict(obj)
        diag = _strip_retry_note(err) or _error_summary(obj)
        out["ok"] = False
        out["retry"] = CHEAPER_HOST_RETRY
        out["error"] = f"{diag}\n{CHEAPER_HOST_RETRY}" if diag else CHEAPER_HOST_RETRY
        return json.dumps(out, ensure_ascii=False)
    if name != "host_shell" and not _timeoutish(raw):
        return raw
    if not raw.strip() or CHEAPER_HOST_RETRY in raw:
        return raw
    return raw.rstrip() + "\n" + CHEAPER_HOST_RETRY


SYSTEM_PERSONA_BASE = (
    "你是自主 agent。用户给出目标后，自己决定下一步：调用工具，看结果，再继续或结束。"
    "工具失败时根据错误换一条再调，不要重复同一条命令；不要编造工具结果或文件名。"
    "需要操作电脑、SSH 或查本机文件时，先 load_skill 加载对应技能，再按说明执行。"
    "结果若在等待则尚未执行；denied 即用户拒绝——不要声称已跑完。"
    "给用户的回复用中文，短，只讲结果；不要提 sandbox/Docker/容器或内部路径，不要假装调用工具。"
)

# Never leak internal mechanism words into user-visible reply text.
USER_FACING_INTERNAL_HIDE = (
    "对用户可见的正文、过程说明、错误提示里："
    "禁止出现 skill、skills、tool、tools、load_skill、function call、mcp__、"
    "「技能」「工具」「加载技能」「调用工具」「技能不可用」「未启用技能」等字样；"
    "需要做事时用自然语言，例如「我画一张图」「我查一下」「我打开这个文件」。"
    "内部仍可通过函数调用与技能目录完成工作，只是不要写进给用户看的文字。"
)

# When tools are off, models often roleplay fake tool calls in plain text — block that.
TOOLS_DISABLED_RULE = (
    "当前会话未启用函数调用；禁止假装调用工具、禁止写「请稍等 / 正在调用 xxx / mcp__…」；"
    "禁止输出 <tool_call> / <function= 等 XML 伪调用；"
    "用已有知识直接完整回答；若缺实时信息请如实说明无法获取。"
)

# Diagram asks: load on-demand skill「画图」; keep prompt thin.
DIAGRAM_SKILL_TRIGGER = (
    "当用户要求画图、流程图、架构图、时序图、关系图、人物关系图、状态图、组织图、对比表或同类示意图时："
    "若可用函数调用且目录含「画图」，先内部加载「画图」全文再按其规则输出；"
    "若无法加载：静默按已知规则直接画，不要向用户解释加载失败；"
    "结构类图默认 ```mermaid ；用户点名 HTML/对比表/卡片墙时用 ```html （禁脚本、内联 CSS、无外联）；"
    "本轮不能生成位图，禁止假装出图片 URL；"
    "边标签 |\"...\"| 引号必须成对；箭头只用 --> / ==> / -.-> ，禁止 === 与 ===| ；"
    "禁止用空格/符号/emoji 拼字符画或伪表格代替图；"
    "对用户只说「我画一张图」之类，不要提内部加载过程。"
)

TOOL_DEFS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "load_skill",
            "description": (
                "Load a skill package. Without path: returns SKILL.md body and the list of "
                "package files (references/, scripts/, …). With path: returns that file's content."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Skill name (directory / frontmatter name)",
                    },
                    "path": {
                        "type": "string",
                        "description": (
                            "Optional package-relative file (e.g. references/examples.md). "
                            "Omit to load SKILL.md + file list."
                        ),
                    },
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_write",
            "description": (
                "Persist a memory item. tier: profile|log|note. "
                "scope defaults to the current bot, or the current group when this run is in a channel. "
                "Use user for facts about the person, agent_pair for a fact shared by two bots "
                "(requires peer_agent_id)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "tier": {
                        "type": "string",
                        "enum": ["profile", "log", "note"],
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["user", "bot", "channel", "agent_pair"],
                    },
                    "peer_agent_id": {
                        "type": "string",
                        "description": "The other bot when scope is agent_pair",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_recall",
            "description": (
                "Recall memories for this conversation. More specific scopes "
                "(this pair, this group, this bot) are filled before the user's shared memories."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "tier": {
                        "type": "string",
                        "enum": ["profile", "log", "note"],
                    },
                    "top_k": {"type": "integer"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_to_agent",
            "description": "Send a message to another agent (or channel) via the agent bus.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to_agent_id": {
                        "type": "string",
                        "description": "Target agent id (optional if channel_id set)",
                    },
                    "channel_id": {
                        "type": "string",
                        "description": "Target channel id (optional if to_agent_id set)",
                    },
                    "body": {"type": "string", "description": "Message body"},
                    "priority": {"type": "boolean"},
                },
                "required": ["body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox_ensure",
            "description": (
                "Ensure the internal execution environment is running (tool name sandbox_*). "
                "Never mention sandbox/Docker/containers//workspace or invent a second PC for the user; speak only about outcomes."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox_shell",
            "description": (
                "Run a shell command in the internal execution environment (paths under /workspace), "
                "NOT the user's personal PC. Call sandbox_ensure first if unsure. "
                "Never claim this is the user's Downloads/Desktop; never mention sandbox//workspace to the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "Shell command to run"},
                    "workdir": {
                        "type": "string",
                        "description": "Working directory inside the execution environment (optional)",
                    },
                    "timeout_sec": {"type": "integer", "description": "Timeout seconds (default 30)"},
                },
                "required": ["cmd"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox_read",
            "description": (
                "Read a text file in the internal execution environment (under /workspace), "
                "not the user's personal PC Downloads/Desktop. Do not expose raw paths to the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path inside the execution environment"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox_write",
            "description": (
                "Write a text file in the internal execution environment. "
                "In team mode bare paths land in bots/{agent_id}/; use shared/ for shared files. "
                "Not the user's personal PC. Tell the user only about the result (preview/download), not paths."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sandbox_ls",
            "description": (
                "List a directory in the internal execution environment. "
                "This is NOT the user's personal PC Downloads/Desktop. "
                "Never say sandbox/Docker//workspace or invent a second PC for the user."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path inside the execution environment",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_secret",
            "description": "Ask the user to provide a secret (API key/token). Never receives plaintext back to the model; Web shows a prompt.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Secret name, e.g. github_token"},
                    "origin": {"type": "string", "description": "HTTPS origin this secret may be used with"},
                    "auth_type": {"type": "string", "description": "bearer|basic|header"},
                    "reason": {"type": "string"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "secret_http",
            "description": "HTTPS request to a saved secret origin with auth injected server-side. Plaintext never returned.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "method": {"type": "string"},
                    "url": {"type": "string", "description": "Must be https and match secret origin host"},
                    "body": {"type": "string"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_machines",
            "description": (
                "List the user's registered computers. Each row has id, label, platform, connected, "
                "and file_op_count. connected means that desktop app can run file operations now. "
                "Call this when the user names a computer or asks which machines they have."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_ls",
            "description": (
                "Shallow directory listing on a connected computer (browse a known small folder). "
                "For a deep or filtered listing, use host_shell "
                "and report compact lines. "
                "Default limit is small; response may set truncated=true with total. "
                "Optional limit (1–200), sort (mtime|size|name), glob (e.g. *.mp4, name only). "
                "Pass machine_id from list_machines; omit it to use the current session computer. "
                "Empty path or ~ lists the home directory."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string", "description": "Machine id from list_machines"},
                    "path": {
                        "type": "string",
                        "description": "Path such as /tmp, ~/Projects, Downloads, or /var/log",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max entries to return (default 50, max 200).",
                    },
                    "sort": {
                        "type": "string",
                        "description": "mtime (default), size, or name",
                    },
                    "glob": {
                        "type": "string",
                        "description": "Optional filename glob such as *.mp4 (not a recursive find).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_read",
            "description": (
                "Read a text file on a connected computer. Absolute paths and ~/... are allowed. "
                "Pass machine_id when the user named a computer; otherwise omit it to use the current session computer."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_write",
            "description": (
                "Write a text file on a connected computer. Absolute paths and ~/... are allowed. "
                "Creating a new file under the home directory runs immediately. "
                "Overwriting an existing file, or any write outside the home directory, waits for confirmation "
                "in the chat. Any logged-in device can allow or deny; the write still happens on the target computer."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_delete",
            "description": (
                "Delete one or more files on a connected computer. Absolute paths and ~/... are allowed. "
                "When deleting multiple files, pass them all in paths (one confirmation card). "
                "Do not call host_delete once per file — that creates multiple cards. "
                "Call immediately when the user asks to delete; the chat shows an allow/deny card "
                "(any logged-in client including the browser can click). Do not ask the user in plain text "
                "to confirm on the computer — wait for the tool result after they click."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "path": {
                        "type": "string",
                        "description": "Single file path when deleting one file.",
                    },
                    "paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "All file paths to delete together (preferred for batch delete).",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_move",
            "description": (
                "Move or rename a file on a connected computer. Absolute paths and ~/... are allowed. "
                "Always waits for confirmation in the chat. Any logged-in device can allow or deny."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "path": {"type": "string"},
                    "dest": {"type": "string"},
                },
                "required": ["path", "dest"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_open",
            "description": (
                "Open an application on a connected computer, such as 微信, Safari, or Visual Studio Code. "
                "Pass the app name the user said. Runs immediately on that computer. "
                "Pass machine_id when the user named a computer; otherwise omit it to use the current session computer."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "name": {"type": "string", "description": "Application name, for example 微信 or Terminal"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_shell",
            "description": (
                "Run one local command on a connected computer. "
                "For how to use it, load_skill host-shell "
                "(file summaries: host-file-query; remote SSH: host-ssh). "
                "If the result is waiting, it has not run; if denied, the user refused. "
                "Do not claim otherwise. Stdout is truncated."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "command": {"type": "string", "description": "Local command only"},
                    "terminal": {
                        "type": "boolean",
                        "description": "Open a visible local terminal",
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_ssh_ls",
            "description": (
                "List a remote directory over SSH from a connected desktop app (headless). "
                "Prefer load_skill host-ssh first. host: IP, domain, or ~/.ssh/config Host."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "host": {"type": "string"},
                    "user": {"type": "string"},
                    "port": {"type": "integer"},
                    "path": {"type": "string"},
                },
                "required": ["host"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_ssh_read",
            "description": "Read a remote text file over SSH/SFTP. Prefer load_skill host-ssh first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "host": {"type": "string"},
                    "user": {"type": "string"},
                    "port": {"type": "integer"},
                    "path": {"type": "string"},
                },
                "required": ["host", "path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_ssh_write",
            "description": (
                "Write a remote text file over SSH/SFTP. Confirms in chat. Prefer load_skill host-ssh first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "host": {"type": "string"},
                    "user": {"type": "string"},
                    "port": {"type": "integer"},
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["host", "path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_ssh_delete",
            "description": (
                "Delete one or more remote files over SSH/SFTP. Confirms in chat. "
                "For multiple files use paths once; do not call repeatedly. Prefer load_skill host-ssh first."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "host": {"type": "string"},
                    "user": {"type": "string"},
                    "port": {"type": "integer"},
                    "path": {"type": "string"},
                    "paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "All remote paths to delete together.",
                    },
                },
                "required": ["host"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "host_ssh_exec",
            "description": (
                "Run one remote command over SSH (headless desktop client). Confirms in chat. "
                "Prefer load_skill host-ssh first. Not for opening a system terminal."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {"type": "string"},
                    "host": {"type": "string"},
                    "user": {"type": "string"},
                    "port": {"type": "integer"},
                    "command": {"type": "string"},
                },
                "required": ["host", "command"],
            },
        },
    },
]
# Append built-in utility tools (time / calculator / http_fetch).
TOOL_DEFS = list(TOOL_DEFS) + list(BUILTIN_TOOL_DEFS) + list(ROUTINE_TOOL_DEFS) + list(AGENT_TOOL_DEFS)


def openai_config(override: LLMOverride | None = None) -> tuple[str, str, str]:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    base = (os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL") or "gpt-4o-mini"
    if override:
        if override.api_key is not None and str(override.api_key).strip() != "":
            api_key = str(override.api_key).strip()
        elif override.api_key is not None:
            # explicit empty api_key still overrides to empty
            api_key = str(override.api_key).strip()
        if override.base_url is not None and str(override.base_url).strip() != "":
            base = str(override.base_url).strip().rstrip("/")
        if override.model is not None and str(override.model).strip() != "":
            model = str(override.model).strip()
    return api_key, base, model


def build_system_prompt(
    *,
    agent_id: str,
    skills_catalog: str,
    memory_snippets: list[str],
    tools_enabled: bool = False,
    available_tool_names: list[str] | None = None,
    client: ClientContext | None = None,
    machines: list[dict[str, Any]] | None = None,
) -> str:
    parts = [
        SYSTEM_PERSONA_BASE,
        USER_FACING_INTERNAL_HIDE,
        DIAGRAM_SKILL_TRIGGER,
        f"当前 agent_id: {agent_id or 'open-bot'}。",
        format_environment_block(client, machines),
    ]
    if tools_enabled:
        names = [n for n in (available_tool_names or []) if n]
        builtin = [n for n in names if not n.startswith("mcp__")]
        mcp_names = [n for n in names if n.startswith("mcp__")]
        tool_bits = [
            "当前会话已启用真实的 OpenAI function-calling 工具；"
            "请**仅**通过 API 的 tool_calls / function calling 调用工具，"
            "禁止在正文里写 <tool_call>、<function= 或任何 XML/Hermes 风格伪调用（那些不会自动执行且会泄漏给用户）。"
        ]
        if builtin:
            tool_bits.append("内置工具：" + "、".join(builtin) + "。")
        if mcp_names:
            tool_bits.append("可用 MCP 工具：" + "、".join(mcp_names) + "。")
        # Long-task hint for host-only and sandbox turns (not sandbox_* alone).
        if (
            "defer_work" in names
            or any(n.startswith(("sandbox_", "host_")) for n in names)
            or "list_machines" in names
        ):
            tool_bits.append(
                "长任务：确认限一句，再 defer_work(goal=…) 后台同一会话交付；"
                "例行用 create/update/pause/resume/delete/list_routines。"
                "工具前若有确认，限一句，勿冗长铺垫。"
            )
        if any(n.startswith("sandbox_") for n in names):
            tool_bits.append(
                "重要：sandbox_* 仅在内部执行环境操作，不是用户本机 Downloads/Desktop。"
                "对用户完全透明：禁止提及 sandbox / Docker / 容器 / /workspace，"
                "禁止把内部环境说成用户的另一台电脑；只谈结果（已生成、可预览、可下载）。"
                "若用户要看「我的电脑 / Downloads / 桌面」，先 list_machines；"
                "没有在线主机时如实说明要打开桌面应用，不要用 sandbox_ls 假装那是用户的 Downloads，"
                "也不要凭记忆编造文件名或大小。"
            )
        parts.append("".join(tool_bits))
        routing = format_tools_routing_block(
            tools_enabled=True, available_tool_names=available_tool_names
        )
        if routing:
            parts.append(routing)
        skills_header = "## 可用技能（仅目录；需要全文时调用 load_skill）"
    else:
        parts.append(TOOLS_DISABLED_RULE)
        skills_header = "## 可用技能（仅目录；当前未启用工具，勿调用 load_skill）"
    parts.append(skills_header)
    parts.append(skills_catalog or "（无）")
    if memory_snippets:
        parts.append("## 相关记忆（自动召回）")
        parts.append(
            "更具体的记忆档优先于更泛的档。"
            "本会话近期消息和压缩摘要优先于长期记忆；冲突时以本会话为准。"
        )
        parts.extend(f"- {s}" for s in memory_snippets)
    return "\n".join(parts)


_FAKE_TOOL_LINE = re.compile(
    r"(?m)^.*(?:"
    r"调用\s*\S*\s*工具|"
    r"mcp__\w+|"
    r"(?:请稍等|稍等|正在调用|正在使用).{0,40}(?:工具|mcp__)"
    r").*$"
)
_FALLBACK_NO_FAKE = (
    "当前会话未启用函数调用，我无法真正调用工具。"
    "请直接说明你的问题，我会用已有知识回答；若需要实时信息，请开启工具或另行提供。"
)


def sanitize_fake_tool_narration(text: str) -> str:
    """Strip obvious fake tool-call stall lines when tools are disabled."""
    if not text or not text.strip():
        return text
    text = strip_tool_markup(text)
    if not text or not text.strip():
        return _FALLBACK_NO_FAKE
    lines = text.splitlines()
    kept: list[str] = []
    removed = 0
    for line in lines:
        if _FAKE_TOOL_LINE.search(line):
            removed += 1
            continue
        kept.append(line)
    if removed == 0:
        return text
    cleaned = "\n".join(kept).strip()
    if not cleaned:
        return _FALLBACK_NO_FAKE
    return cleaned


def normalize_messages(
    messages: list[dict[str, Any]] | None,
    content: str,
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if messages:
        for m in messages:
            role = str(m.get("role") or "").strip()
            text = str(m.get("content") or "")
            if role in ("assistant", "summary"):
                text = strip_think(text)
            if role in ("system", "user", "assistant", "summary") and text.strip() != "":
                out.append({"role": role, "content": text})
    if not out and content.strip():
        out.append({"role": "user", "content": content.strip()})
    elif content.strip():
        last = out[-1] if out else None
        if not (last and last["role"] == "user" and last["content"] == content.strip()):
            if not (last and last["role"] == "user"):
                out.append({"role": "user", "content": content.strip()})
    return out




def assemble_llm_messages(
    system: str,
    compacted: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Final LLM messages with **one** leading system turn.

    ``compact_messages`` may prepend ``role=system`` conversation summaries.
    Merging those into the persona / tools / memory / client_env system prompt
    avoids dual system messages (confusing in Langfuse and some gateways).
    """
    summary_bits: list[str] = []
    dialog: list[dict[str, Any]] = []
    for m in compacted or []:
        role = str(m.get("role") or "")
        if role == "system":
            bit = str(m.get("content") or "").strip()
            if bit:
                summary_bits.append(bit)
            continue
        dialog.append(m)

    sys_text = (system or "").strip()
    if summary_bits:
        block = "\n\n".join(summary_bits)
        if sys_text:
            sys_text = f"{sys_text}\n\n## 对话摘要（更早轮次）\n{block}"
        else:
            sys_text = block

    out: list[dict[str, Any]] = []
    if sys_text:
        out.append({"role": "system", "content": sys_text})
    out.extend(dialog)
    return out


def _raw_usage_from_response(data: dict[str, Any] | None) -> Any | None:
    """Return upstream `usage` object/dict if present; else None."""
    if not isinstance(data, dict):
        return None
    usage = data.get("usage")
    if usage is None:
        return None
    if isinstance(usage, dict) and not usage:
        return None
    return usage


logger = logging.getLogger(__name__)

# Transient LLM failures: limited attempts + exponential backoff (group fan-out safe).
# Override with OPENBOT_LLM_MAX_ATTEMPTS (1–5). Default 3 total tries.
_LLM_RETRY_DEFAULT_ATTEMPTS = 3
_LLM_RETRY_BASE_DELAY_S = 0.4


def _llm_max_attempts() -> int:
    raw = (os.getenv("OPENBOT_LLM_MAX_ATTEMPTS") or "").strip()
    if not raw:
        return _LLM_RETRY_DEFAULT_ATTEMPTS
    try:
        n = int(raw)
    except ValueError:
        return _LLM_RETRY_DEFAULT_ATTEMPTS
    return max(1, min(n, 5))


def _llm_retry_delay_s(attempt: int) -> float:
    """Backoff before the next try; attempt is 1-based index of the failed try."""
    return _LLM_RETRY_BASE_DELAY_S * (2 ** max(0, attempt - 1))


def _upstream_http_status(message: str) -> int | None:
    m = (message or "").strip()
    if not m.startswith("upstream HTTP "):
        return None
    rest = m[len("upstream HTTP ") :]
    digits: list[str] = []
    for ch in rest:
        if ch.isdigit():
            digits.append(ch)
        else:
            break
    if not digits:
        return None
    try:
        return int("".join(digits))
    except ValueError:
        return None


def _is_cancel_flavored_upstream(message: str) -> bool:
    """True when an upstream/gateway body is client-cancel noise, not a transient 5xx.

    Gateways (Caddy/Go reverse proxies in front of model APIs) often answer 502 with
    "downstream request canceled … context canceled" when *their* downstream aborted
    before upstream headers. Retrying that burns another canceled attempt.
    """
    folded = (message or "").lower()
    if "context canceled" in folded or "context cancelled" in folded:
        return True
    if "downstream request canceled" in folded or "downstream request cancelled" in folded:
        return True
    if "request canceled" in folded or "request cancelled" in folded:
        return True
    return False


def is_retryable_llm_error(exc: BaseException) -> bool:
    """True for transient LLM/transport failures worth another attempt.

    Retries: timeout, connection reset/network, 429, 5xx, empty choices.
    Does not retry: CancelledError, cancel-flavored upstream 5xx bodies,
    auth/bad-request 4xx, AutoToolChoiceUnsupported, context-length overflow
    (compaction owns that path).
    """
    if isinstance(exc, asyncio.CancelledError):
        return False
    if isinstance(exc, AutoToolChoiceUnsupported):
        return False
    if isinstance(
        exc,
        (
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError,
        ),
    ):
        return True
    if not isinstance(exc, RuntimeError):
        return False
    msg = str(exc)
    if is_context_length_error(msg):
        return False
    if _is_cancel_flavored_upstream(msg):
        return False
    if "LLM request timed out" in msg or "LLM connection error" in msg:
        return True
    if "empty LLM completion" in msg:
        return True
    status = _upstream_http_status(msg)
    if status is None:
        return False
    if status == 429 or status == 408 or status >= 500:
        return True
    return False


async def _chat_completion_once(
    *,
    tools: list[dict[str, Any]] | None,
    payload: dict[str, Any],
    headers: dict[str, str],
    url: str,
) -> dict[str, Any]:
    """One HTTP POST (plus optional reasoning_effort payload tweak). May mutate payload."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=10.0)) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code >= 300:
                body = resp.text[:2000]
                # Some gateways inject a non-none default; retry once with none + tools.
                if (
                    tools
                    and resp.status_code == 400
                    and "reasoning_effort" in body
                    and payload.get("reasoning_effort") != "none"
                ):
                    payload.update({"reasoning_effort": "none"})
                    resp2 = await client.post(url, headers=headers, json=payload)
                    if resp2.status_code >= 300:
                        body2 = resp2.text[:2000]
                        if (
                            tools
                            and resp2.status_code == 400
                            and is_auto_tool_choice_unsupported(body2)
                        ):
                            raise AutoToolChoiceUnsupported(
                                f"upstream HTTP {resp2.status_code}: {body2}"
                            )
                        raise RuntimeError(
                            f"upstream HTTP {resp2.status_code}: {body2}"
                        )
                    data2 = resp2.json()
                    if not (isinstance(data2, dict) and (data2.get("choices") or [])):
                        raise RuntimeError("empty LLM completion (no choices)")
                    return data2
                if (
                    tools
                    and resp.status_code == 400
                    and is_auto_tool_choice_unsupported(body)
                ):
                    raise AutoToolChoiceUnsupported(
                        f"upstream HTTP {resp.status_code}: {body}"
                    )
                raise RuntimeError(f"upstream HTTP {resp.status_code}: {body}")
            data = resp.json()
            if not (isinstance(data, dict) and (data.get("choices") or [])):
                raise RuntimeError("empty LLM completion (no choices)")
            return data
    except httpx.TimeoutException as exc:
        raise RuntimeError(f"LLM request timed out: {exc}") from exc
    except (httpx.NetworkError, httpx.RemoteProtocolError) as exc:
        raise RuntimeError(f"LLM connection error: {exc}") from exc


async def chat_completion(
    messages: list[dict[str, Any]],
    *,
    api_key: str,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict | None = None,
    override: LLMOverride | None = None,
) -> dict[str, Any]:
    _, base, model = openai_config(override)
    profile = profile_for(model, base)
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "stream": False,
        "messages": messages,
    }
    if tools:
        payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
    payload = adapt_chat_payload(payload, has_tools=bool(tools), profile=profile)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    max_attempts = _llm_max_attempts()
    last_err: BaseException | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            data = await _chat_completion_once(
                tools=tools,
                payload=payload,
                headers=headers,
                url=url,
            )
            if attempt > 1:
                logger.info(
                    "LLM chat_completion succeeded on attempt %d/%d model=%s",
                    attempt,
                    max_attempts,
                    model,
                )
            return data
        except asyncio.CancelledError:
            raise
        except AutoToolChoiceUnsupported:
            raise
        except Exception as exc:
            if not is_retryable_llm_error(exc):
                raise
            last_err = exc
            if attempt >= max_attempts:
                logger.warning(
                    "LLM chat_completion failed after %d attempts model=%s err=%s",
                    max_attempts,
                    model,
                    exc,
                )
                break
            delay = _llm_retry_delay_s(attempt)
            logger.warning(
                "LLM chat_completion attempt %d/%d failed model=%s err=%s; retrying in %.2fs",
                attempt,
                max_attempts,
                model,
                exc,
                delay,
            )
            await asyncio.sleep(delay)
    assert last_err is not None
    raise last_err


async def chat_text(
    messages: list[dict[str, Any]],
    *,
    api_key: str,
    override: LLMOverride | None = None,
) -> str:
    data = await chat_completion(messages, api_key=api_key, override=override)
    choices = data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    return str(msg.get("content") or "")


def tools_enabled(override: LLMOverride | None = None) -> bool:
    """Local vLLM often lacks --enable-auto-tool-choice; default off."""
    if override is not None and override.enable_tools is not None:
        return bool(override.enable_tools)
    v = (os.getenv("OPENAI_ENABLE_TOOLS") or "0").strip().lower()
    return v in ("1", "true", "yes", "on")


class AutoToolChoiceUnsupported(RuntimeError):
    """Upstream rejects tools without --enable-auto-tool-choice / tool-call-parser."""


def is_auto_tool_choice_unsupported(message: str) -> bool:
    """Detect vLLM / gateway 400s that require auto tool choice flags."""
    m = (message or "").lower()
    needles = (
        "enable-auto-tool-choice",
        "enable_auto_tool_choice",
        "tool-call-parser",
        "tool_call_parser",
        '"auto" tool choice requires',
        "auto tool choice requires",
    )
    return any(n in m for n in needles)


async def run_tool_loop(
    messages: list[dict[str, Any]],
    *,
    api_key: str,
    tool_handler: ToolHandler,
    max_rounds: int = DEFAULT_TOOL_ROUNDS,
    override: LLMOverride | None = None,
    extra_tools: list[dict[str, Any]] | None = None,
    on_status: StatusCallback | None = None,
) -> tuple[str, list[str], Any | None]:
    """Non-stream tool loop; returns final text, tool names used, and usage_details.

    The third value is aggregated Langfuse-shaped usage_details
    (prompt_tokens / completion_tokens / total_tokens) across all upstream
    chat completions in this loop, or None if the gateway omitted usage.

    Optional on_status receives dicts like
    {"phase":"tool","label":"正在运行命令"} while tools run (no raw tool id).
    """
    from .langfuse_trace import merge_usage_details, parse_usage_details

    used: list[str] = []
    msgs: list[dict[str, Any]] = list(messages)
    final = ""
    usage_acc: dict[str, int] | None = None
    _, base, model = openai_config(override)
    profile = profile_for(model, base)

    def _accumulate(data: dict[str, Any]) -> None:
        nonlocal usage_acc
        usage_acc = merge_usage_details(
            usage_acc, parse_usage_details(_raw_usage_from_response(data))
        )

    async def _checkpoint() -> None:
        # Let CancelledError surface between LLM/tool awaits.
        await asyncio.sleep(0)

    async def _complete(
        *,
        tools_arg: list[dict[str, Any]] | None,
        tool_choice_arg: str | dict | None,
    ) -> dict[str, Any]:
        """One chat completion; on context overflow compact msgs and retry (no tool round)."""
        from . import compact as compact_mod

        overflow_tries = 0
        while True:
            try:
                data = await chat_completion(
                    msgs,
                    api_key=api_key,
                    tools=tools_arg,
                    tool_choice=tool_choice_arg,
                    override=override,
                )
                _accumulate(data)
                return data
            except AutoToolChoiceUnsupported:
                raise
            except RuntimeError as exc:
                err = str(exc)
                if overflow_tries >= _CONTEXT_OVERFLOW_RETRIES or not is_context_length_error(
                    err
                ):
                    raise
                overflow_tries += 1
                if on_status is not None:
                    await on_status(
                        {
                            "phase": "thinking",
                            "label": "上下文过长，正在压缩后重试",
                        }
                    )
                compacted, meta = await compact_mod.compact_messages(
                    msgs,
                    api_key=api_key,
                    model=model,
                )
                if not meta.get("compacted") and len(compacted) >= len(msgs):
                    raise
                msgs[:] = list(compacted)

    if not tools_enabled(override):
        await _checkpoint()
        data = await chat_completion(msgs, api_key=api_key, tools=None, override=override)
        _accumulate(data)
        choices = data.get("choices") or []
        if choices:
            raw = str((choices[0].get("message") or {}).get("content") or "")
            # Never leak XML/Hermes tool markup when tools are off — strip only.
            final = postprocess_text(strip_think(strip_tool_markup(raw)), profile)
            final = sanitize_fake_tool_narration(final)
            if raw.strip() and not (final or "").strip():
                final = REASONING_ONLY
        return final, used, usage_acc
    tools = list(TOOL_DEFS)
    if extra_tools:
        tools.extend(extra_tools)
    choice: str | None = "auto" if profile.tool_choice_auto else None
    # When upstream rejects tools+auto, keep running via XML/Hermes text tool calls
    # instead of silently chatting with a "tools enabled" system prompt (hallucinates).
    tools_via_markup = False
    markup_hint_added = False
    continued = False
    reasoning_only = False
    fail_nudges = 0
    # One-shot tool_choice for the next revise round. Not a second budget:
    # scheduling it still consumes TOOL_FAIL_NUDGE_CAP.
    revise_required = False
    finished_cleanly = False
    for _ in range(max_rounds):
        await _checkpoint()
        round_choice = choice
        sent_required = False
        if revise_required and profile.tool_choice_auto and not tools_via_markup:
            round_choice = "required"
            sent_required = True
        revise_required = False
        try:
            data = await _complete(
                tools_arg=None if tools_via_markup else tools,
                tool_choice_arg=None if tools_via_markup else round_choice,
            )
        except AutoToolChoiceUnsupported:
            if tools_via_markup:
                raise
            tools_via_markup = True
            # required is not safe on this upstream. Same revise, text nudge.
            if sent_required and not any(
                m.get("role") == "user" and m.get("content") == TOOL_FAIL_NUDGE
                for m in msgs
            ):
                msgs.append({"role": "user", "content": TOOL_FAIL_NUDGE})
            if on_status is not None:
                await on_status(
                    {
                        "phase": "thinking",
                        "label": "正在调整调用方式…",
                        "tools_disabled": False,
                        "reason": "auto_tool_choice_unsupported",
                        "tools_via_markup": True,
                    }
                )
            if not markup_hint_added:
                markup_hint_added = True
                msgs.append(
                    {
                        "role": "system",
                        "content": (
                            "当前上游不支持 OpenAI 原生 tool_calls（缺 enable-auto-tool-choice）。"
                            "需要工具时，在回复里只输出如下 XML（系统会执行），"
                            "不要编造工具结果，尤其不要编造本机文件名、大小或删除成功：\n"
                            "<tool_call>\n"
                            "<function=工具名>\n"
                            "<parameter=参数名>参数值</parameter>\n"
                            "</function>\n"
                            "</tool_call>\n"
                            "本机命令、文件查询或 SSH：先 load_skill 对应技能再调工具；需要选机时先 list_machines。"
                        ),
                    }
                )
            continue
        choices = data.get("choices") or []
        if not choices:
            break
        msg = choices[0].get("message") or {}
        tool_calls = list(msg.get("tool_calls") or [])
        content = msg.get("content")
        content_str = str(content or "")

        # Recover XML/Hermes/YAML-style tool calls leaked as plain text.
        if not tool_calls and content_has_tool_markup(content_str):
            parsed = parse_tool_markup(content_str)
            if parsed:
                tool_calls = to_openai_tool_calls(parsed)
                cleaned = strip_tool_markup(content_str)
                content = cleaned if cleaned else None
                content_str = str(content or "")

        if tool_calls:
            # Persist assistant turn without leaking raw markup into history.
            msgs.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": tool_calls,
                }
            )
            for tc in tool_calls:
                fn = tc.get("function") or {}
                name = str(fn.get("name") or "")
                raw_args = fn.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else dict(raw_args)
                except json.JSONDecodeError:
                    args = {}
                used.append(name)
                if on_status is not None:
                    await on_status(
                        {
                            "phase": "tool",
                            "label": tool_display_label(name),
                        }
                    )
                await _checkpoint()
                try:
                    result = await tool_handler(name, args)
                except Exception as exc:  # noqa: BLE001
                    # A tool failure must come back as a result so this loop can
                    # take another tool round. CancelledError is a BaseException.
                    result = json.dumps(
                        {"ok": False, "error": str(exc)},
                        ensure_ascii=False,
                    )
                result = guide_tool_result(name, result)
                result = truncate_tool_result_for_context(result)
                if on_status is not None:
                    await on_status(
                        {
                            "phase": "tool_done",
                            "label": "正在思考…",
                        }
                    )
                msgs.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.get("id"),
                        "content": result,
                    }
                )
            continue
        # Text with no tool call. If this thread already has a file and this
        # run has not written or executed anything, the agent is not done.
        # Keep the same run going. Do not classify the sentence.
        final = postprocess_text(strip_think(strip_tool_markup(content_str)), profile)
        reasoning_only = bool(content_str.strip()) and not (final or "").strip()
        if not continued and turn_unfinished(used, msgs):
            reasoning_only = False
            continued = True
            if on_status is not None:
                await on_status(
                    {
                        "phase": "thinking",
                        "label": "正在做…",
                    }
                )
            msgs.append({"role": "assistant", "content": final or ""})
            msgs.append({"role": "user", "content": CONTINUE_WORK})
            final = ""
            continue
        host_nudge = host_followup_prompt(used, msgs) if not continued else None
        if host_nudge:
            reasoning_only = False
            continued = True
            if on_status is not None:
                await on_status(
                    {
                        "phase": "thinking",
                        "label": "先访问本机…",
                    }
                )
            msgs.append({"role": "assistant", "content": final or ""})
            msgs.append({"role": "user", "content": host_nudge})
            final = ""
            continue
        # ReAct: failed/useless host tool + any no-tool reply (including a
        # short Chinese conclusion) is unfinished. Ask the model to call a
        # tool again. Same cap as think-only nudges — this does not add a
        # second budget. Never re-run the shell here. Denied commands and
        # _NO_RETRY_HINT observations are not failures, so they are not nudged.
        if used and fail_nudges < TOOL_FAIL_NUDGE_CAP:
            tool_name, last_obs = _last_executed_tool(msgs)
            if last_obs is not None and tool_observation_failed(last_obs):
                hostish = _is_host_tool(tool_name)
                # Host: any reply. Other tools: keep think-only/empty only,
                # so a real answer can still finish the turn.
                needs_revise = hostish or reasoning_only or not (final or "").strip()
                if needs_revise:
                    fail_nudges += 1
                    reasoning_only = False
                    if on_status is not None:
                        await on_status(
                            {
                                "phase": "thinking",
                                "label": "正在根据错误修正命令",
                            }
                        )
                    msgs.append({"role": "assistant", "content": final or ""})
                    # required only where this profile already sends tool_choice.
                    # Qwen/compat/markup reject or ignore it; inject the nudge.
                    if hostish and profile.tool_choice_auto and not tools_via_markup:
                        revise_required = True
                    else:
                        msgs.append({"role": "user", "content": TOOL_FAIL_NUDGE})
                    final = ""
                    continue
        finished_cleanly = True
        break

    async def _defer_if_unfinished() -> str | None:
        """Hand long unfinished work to the existing defer_work queue."""
        if finished_cleanly or not used or "defer_work" in used:
            return None
        # Exhausted interactive rounds (or left mid-work without a clean stop).
        if not turn_unfinished(used, msgs) and not any(
            n.startswith("host_") or n.startswith("sandbox_") or n == "load_skill"
            for n in used
        ):
            # Short chat / non-delivery tools already answered — do not enqueue.
            if (final or "").strip() and not reasoning_only:
                return None
        goal = last_real_user_text(msgs) or last_real_user_text(messages)
        goal = (goal or "").strip()
        if not goal:
            return None
        if on_status is not None:
            await on_status(
                {
                    "phase": "thinking",
                    "label": "后台继续…",
                }
            )
        try:
            raw = await tool_handler("defer_work", {"goal": goal})
        except Exception:  # noqa: BLE001
            return None
        # Prefer a short confirm; fall back if enqueue failed.
        try:
            obj = json.loads(raw) if isinstance(raw, str) else None
        except json.JSONDecodeError:
            obj = None
        if isinstance(obj, dict) and obj.get("error"):
            return None
        used.append("defer_work")
        return DEFER_ON_EXHAUST_REPLY

    deferred_reply = await _defer_if_unfinished()
    if deferred_reply:
        return deferred_reply, used, usage_acc

    if not final and msgs and not reasoning_only:
        data = await _complete(tools_arg=None, tool_choice_arg=None)
        choices = data.get("choices") or []
        if choices:
            raw_final = str((choices[0].get("message") or {}).get("content") or "")
            final = postprocess_text(
                strip_think(strip_tool_markup(raw_final)),
                profile,
            )
            if raw_final.strip() and not (final or "").strip():
                reasoning_only = True
    if reasoning_only and not (final or "").strip():
        # Tools already returned (including a timeout). Do not hide that behind
        # an empty turn just because the follow-up was reasoning tags only.
        final = tool_result_fallback(msgs) if used else REASONING_ONLY
    elif used and not (final or "").strip():
        final = tool_result_fallback(msgs)
    return final, used, usage_acc


async def stream_chat_tokens(
    messages: list[dict[str, Any]],
    *,
    api_key: str,
    override: LLMOverride | None = None,
):
    """Yield text deltas from streaming completions (no tools)."""
    _, base, model = openai_config(override)
    profile = profile_for(model, base)
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {"model": model, "stream": True, "messages": messages}
    payload = adapt_chat_payload(payload, has_tools=False, profile=profile)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=10.0)) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 300:
                err = (await resp.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"upstream HTTP {resp.status_code}: {err[:2000]}")
            async for line in resp.aiter_lines():
                if not line or line.startswith(":") or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                text = delta.get("content")
                if text:
                    yield text
