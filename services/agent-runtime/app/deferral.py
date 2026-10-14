"""Whether this agent turn is still running.

Completion is the run itself, not the wording of the reply. A delivery tool
means the work has been done. A sandbox link from an earlier turn does not
reopen this one. The turn stays open only when this turn's own reply names a
file and no delivery tool has written it.
"""

from __future__ import annotations

import re

# Reading or listing does not count as handing the user a result.
DELIVERY_TOOLS = frozenset({"sandbox_write", "sandbox_shell"})

HOST_DELETE_TOOLS = frozenset({"host_delete", "host_ssh_delete"})
HOST_LIST_TOOLS = frozenset({
    "host_ls",
    "host_ssh_ls",
    "list_machines",
    "host_shell",
    "load_skill",
})

# Fed back into the same run. Not shown to the user and not matched against
# the model's previous sentence.
CONTINUE_WORK = (
    "未完成：立刻调工具做完并给可打开链接；过程勿啰嗦解说；"
    "无需改文件则一句答完，勿说稍后。"
)

CONTINUE_HOST_DELETE = (
    "立刻调用 host_delete/host_ssh_delete（多文件用 paths）。"
    "确认卡由系统弹出；勿用文字假装已删或已批准。"
)

CONTINUE_HOST_LIST = (
    "先 list_machines/load_skill/host_ls 查本机；空结果先改查询，勿编造文件名/大小。"
)

_CONTINUE_MARKERS = frozenset({CONTINUE_WORK, CONTINUE_HOST_DELETE, CONTINUE_HOST_LIST})

_DELETE_INTENT = re.compile(r"(删|删除|\bremove\b|\bdelete\b)", re.IGNORECASE)
_RETRY_INTENT = re.compile(r"再试")
_LIST_INTENT = re.compile(
    r"(最大|最新|排前|前三|下载|Downloads|目录里|文件夹.*(文件|啥|什么))",
    re.IGNORECASE,
)
_DELETE_CONTEXT = re.compile(r"(删|删除|delete|拒绝|允许|确认卡|mp4)", re.IGNORECASE)


def history_has_artifact(messages: list[dict] | None) -> bool:
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, str) or "sandbox:" not in content:
            continue
        # A colleague's earlier reply is already in the thread. Their link is
        # not an open file this bot still has to deliver.
        if message.get("role") == "user" and _colleague_note(content):
            continue
        return True
    return False


def _colleague_note(content: str) -> bool:
    text = content.lstrip()
    if not text.startswith("【"):
        return False
    end = text.find("】")
    return 0 < end <= 40


def _messages_after_last_user(messages: list[dict] | None) -> list[dict]:
    last = -1
    for i, message in enumerate(messages or []):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = str(message.get("content") or "").strip()
        if not content or content in _CONTINUE_MARKERS:
            continue
        last = i
    if last < 0:
        return list(messages or [])
    return list(messages or [])[last + 1 :]


def turn_unfinished(tools_used: list[str] | None, messages: list[dict] | None) -> bool:
    """True when the agent has not finished and should keep running.

    A delivery tool finishes the turn. Only a sandbox link written after the
    latest user message counts; older links are already delivered.
    """
    if any(name in DELIVERY_TOOLS for name in (tools_used or [])):
        return False
    return history_has_artifact(_messages_after_last_user(messages))


def last_real_user_text(messages: list[dict] | None) -> str:
    for message in reversed(messages or []):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = str(message.get("content") or "").strip()
        if not content or content in _CONTINUE_MARKERS:
            continue
        return content
    return ""


def last_assistant_text(messages: list[dict] | None) -> str:
    for message in reversed(messages or []):
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        # Skip tool-call-only assistant turns.
        content = message.get("content")
        if content is None:
            continue
        text = str(content).strip()
        if text:
            return text
    return ""


def host_followup_prompt(tools_used: list[str] | None, messages: list[dict] | None) -> str | None:
    """If the user asked for a host mutation/list but no tool ran, nudge once."""
    used = set(tools_used or [])
    text = last_real_user_text(messages)
    if not text:
        return None
    if _DELETE_INTENT.search(text) or (
        _RETRY_INTENT.search(text) and _DELETE_CONTEXT.search(last_assistant_text(messages))
    ):
        if used.isdisjoint(HOST_DELETE_TOOLS):
            return CONTINUE_HOST_DELETE
    if _LIST_INTENT.search(text) and used.isdisjoint(HOST_LIST_TOOLS):
        return CONTINUE_HOST_LIST
    return None
