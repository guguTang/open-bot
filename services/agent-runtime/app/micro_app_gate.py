"""Phase 6: model-side dual gate for micro-app context.

Gate A (Bot tool policy): host_* requires client.host_tools; tool must map to a
capability declared on the MicroApp (declared ∩ host capability).
Gate B (MicroApp Grant): entry × device grant must allow (allow_once / always_allow).

When micro_app_id is absent, this module is a no-op (normal chat tool policy).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import openbot_api as obapi
from .client_env import ClientContext

logger = logging.getLogger("openbot.micro_app_gate")

# Keep in sync with services/api/.../micro_apps_tool_gate.go
TOOL_TO_CAPABILITY: dict[str, str] = {
    "host_shell": "host.shell.run",
    "host_screenshot": "host.screenshot",
    "host_find_app": "host.app.find",
    "host_open": "host.app.open",
    "host_ls": "host.fs.read",
    "host_read": "host.fs.read",
    "host_write": "host.fs.write",
    "host_delete": "host.fs.write",
    "host_move": "host.fs.write",
}

FS_ALTERNATES: dict[str, frozenset[str]] = {
    "host.fs.read": frozenset({"host.fs.workspace"}),
    "host.fs.write": frozenset({"host.fs.workspace"}),
}

# Tools that fall under dual-gate when micro_app_id is set.
HOSTISH_PREFIXES = ("host_",)


def is_hostish_tool(name: str) -> bool:
    n = (name or "").strip()
    return n.startswith(HOSTISH_PREFIXES)


def capability_for_tool(name: str) -> str | None:
    """Return mapped capability, or None if unmapped (blocked in micro-app context)."""
    return TOOL_TO_CAPABILITY.get((name or "").strip())


def capability_declared(capabilities: list[str] | None, capability: str) -> bool:
    caps = set(capabilities or [])
    if capability in caps:
        return True
    for alt in FS_ALTERNATES.get(capability, ()):
        if alt in caps:
            return True
    return False


def filter_tools_for_micro_app(
    tool_names: list[str] | None,
    *,
    capabilities: list[str] | None,
    host_tools: bool,
) -> list[str]:
    """Offer-time filter: drop hostish tools that fail Gate A (policy + declared)."""
    if tool_names is None:
        return []
    out: list[str] = []
    for name in tool_names:
        if not is_hostish_tool(name):
            out.append(name)
            continue
        if not host_tools:
            continue
        cap = capability_for_tool(name)
        if not cap or not capability_declared(capabilities, cap):
            continue
        out.append(name)
    return out


def reject_payload(
    *,
    error_code: str,
    tool: str,
    micro_app_id: str,
    capability: str = "",
    error: str = "",
    extra: dict[str, Any] | None = None,
) -> str:
    body: dict[str, Any] = {
        "ok": False,
        "error_code": error_code,
        "error": error or error_code,
        "tool": tool,
        "micro_app_id": micro_app_id,
    }
    if capability:
        body["capability"] = capability
    if extra:
        body.update(extra)
    return json.dumps(body, ensure_ascii=False)


def fetch_micro_app_context(user_id: str, micro_app_id: str) -> dict[str, Any]:
    """Load capabilities for offer-time filtering (tool empty)."""
    return obapi._post(
        "/internal/micro-apps/tool-gate",
        {
            "user_id": user_id,
            "micro_app_id": micro_app_id,
            "tool": "",
        },
        timeout=15.0,
    )


def check_tool_gate(
    *,
    user_id: str,
    micro_app_id: str,
    tool: str,
    machine_id: str = "",
    command: str = "",
    host_tools: bool | None = None,
    conversation_id: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "user_id": user_id,
        "micro_app_id": micro_app_id,
        "tool": tool,
        "machine_id": machine_id or "",
        "command": command or "",
        "conversation_id": conversation_id or "",
    }
    if host_tools is not None:
        payload["host_tools"] = bool(host_tools)
    return obapi._post("/internal/micro-apps/tool-gate", payload, timeout=15.0)


def surface_grant_prompt(
    *,
    user_id: str,
    conversation_id: str,
    micro_app_id: str,
    capability: str,
    tool: str = "",
    command: str = "",
    machine_id: str = "",
    reason: str = "",
    suggested_decision: str = "",
    high_sensitivity: bool = False,
) -> None:
    """Best-effort: insert a micro_app_grant chat card for the client approval UX."""
    conv = (conversation_id or "").strip()
    if not conv or not (user_id or "").strip() or not (micro_app_id or "").strip():
        return
    if not (capability or "").strip():
        return
    try:
        obapi._post(
            "/internal/micro-apps/grant-prompt",
            {
                "user_id": user_id,
                "conversation_id": conv,
                "micro_app_id": micro_app_id,
                "capability": capability,
                "tool": tool or "",
                "command": command or "",
                "machine_id": machine_id or "",
                "reason": reason
                or "模型路径需要微应用授权。授权后请再说一次以继续（本回合不自动重试）。",
                "suggested_decision": suggested_decision or "",
                "high_sensitivity": bool(high_sensitivity),
            },
            timeout=10.0,
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "micro_app grant-prompt failed user=%s app=%s cap=%s",
            user_id,
            micro_app_id,
            capability,
        )


def consume_grant(user_id: str, grant_id: str) -> None:
    if not grant_id:
        return
    try:
        obapi._post(
            "/internal/micro-apps/grant-consume",
            {"user_id": user_id, "grant_id": grant_id},
            timeout=10.0,
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "micro_app grant-consume failed user=%s grant=%s", user_id, grant_id
        )


def audit_log(
    *,
    micro_app_id: str,
    tool: str,
    capability: str,
    allowed: bool,
    error_code: str = "",
    decision: str = "",
) -> None:
    logger.info(
        "micro_app_dual_gate micro_app_id=%s tool=%s capability=%s allowed=%s "
        "error_code=%s decision=%s",
        micro_app_id,
        tool,
        capability,
        allowed,
        error_code or "-",
        decision or "-",
    )


def enforce_dual_gate(
    *,
    user_id: str,
    micro_app_id: str,
    tool: str,
    args: dict[str, Any] | None,
    client: ClientContext | None,
) -> str | None:
    """Return a JSON reject string if blocked; None if allowed.

    Also returns (via audit log) the gate outcome. Caller should call
    note_grant_for_consume / consume after successful execution when allow_once.
    """
    mid = (micro_app_id or "").strip()
    if not mid:
        return None
    if not is_hostish_tool(tool):
        return None

    host_tools = True
    machine_id = ""
    if client is not None:
        host_tools = bool(client.capabilities.host_tools)
        machine_id = str(client.machine_id or "").strip()

    command = ""
    if tool == "host_shell" and isinstance(args, dict):
        command = str(args.get("command") or args.get("cmd") or "").strip()

    try:
        result = check_tool_gate(
            user_id=str(user_id or ""),
            micro_app_id=mid,
            tool=tool,
            machine_id=machine_id,
            command=command,
            host_tools=host_tools,
        )
    except Exception as e:  # noqa: BLE001
        audit_log(
            micro_app_id=mid,
            tool=tool,
            capability=capability_for_tool(tool) or "",
            allowed=False,
            error_code="gate_check_failed",
        )
        return reject_payload(
            error_code="gate_check_failed",
            tool=tool,
            micro_app_id=mid,
            capability=capability_for_tool(tool) or "",
            error=f"gate_check_failed: {e}",
        )

    allowed = bool(result.get("allowed"))
    error_code = str(result.get("error_code") or "")
    capability = str(result.get("capability") or capability_for_tool(tool) or "")
    decision = str(result.get("decision") or "")
    audit_log(
        micro_app_id=mid,
        tool=tool,
        capability=capability,
        allowed=allowed,
        error_code=error_code,
        decision=decision,
    )
    if allowed:
        # Stash grant_id on result for caller via thread-local-ish return... 
        # Caller reads from check again is wasteful; return None and store on args? 
        # Use module-level last_grant for this call site via return tuple instead.
        return None

    return reject_payload(
        error_code=error_code or "grant_denied",
        tool=tool,
        micro_app_id=mid,
        capability=capability,
        error=str(result.get("error") or error_code or "grant_denied"),
        extra={
            "decision": decision,
            "needs_prompt": bool(result.get("needs_prompt")),
            "high_sensitivity": bool(result.get("high_sensitivity")),
            "suggested_decision": str(result.get("suggested_decision") or ""),
            "grant_id": str(result.get("grant_id") or ""),
        },
    )


# Last successful gate grant_id for allow_once consume (same tool_handler turn).
_last_allow_grant: dict[str, str] = {}


def enforce_dual_gate_with_grant(
    *,
    user_id: str,
    micro_app_id: str,
    tool: str,
    args: dict[str, Any] | None,
    client: ClientContext | None,
    conversation_id: str = "",
) -> tuple[str | None, str]:
    """Like enforce_dual_gate but also returns grant_id when allowed (for allow_once)."""
    mid = (micro_app_id or "").strip()
    if not mid or not is_hostish_tool(tool):
        return None, ""

    host_tools = True
    machine_id = ""
    if client is not None:
        host_tools = bool(client.capabilities.host_tools)
        machine_id = str(client.machine_id or "").strip()

    command = ""
    if tool == "host_shell" and isinstance(args, dict):
        command = str(args.get("command") or args.get("cmd") or "").strip()

    conv = (conversation_id or "").strip()

    try:
        result = check_tool_gate(
            user_id=str(user_id or ""),
            micro_app_id=mid,
            tool=tool,
            machine_id=machine_id,
            command=command,
            host_tools=host_tools,
            conversation_id=conv,
        )
    except Exception as e:  # noqa: BLE001
        audit_log(
            micro_app_id=mid,
            tool=tool,
            capability=capability_for_tool(tool) or "",
            allowed=False,
            error_code="gate_check_failed",
        )
        return (
            reject_payload(
                error_code="gate_check_failed",
                tool=tool,
                micro_app_id=mid,
                capability=capability_for_tool(tool) or "",
                error=f"gate_check_failed: {e}",
            ),
            "",
        )

    allowed = bool(result.get("allowed"))
    error_code = str(result.get("error_code") or "")
    capability = str(result.get("capability") or capability_for_tool(tool) or "")
    decision = str(result.get("decision") or "")
    grant_id = str(result.get("grant_id") or "")
    audit_log(
        micro_app_id=mid,
        tool=tool,
        capability=capability,
        allowed=allowed,
        error_code=error_code,
        decision=decision,
    )
    if allowed:
        # Only consume allow_once after success.
        if decision == "allow_once":
            return None, grant_id
        return None, ""

    if error_code == "grant_required" or bool(result.get("needs_prompt")):
        reason = str(result.get("error") or result.get("reason") or "")
        if reason == "command_not_in_allowlist":
            reason = "该命令不在此微应用的命令白名单内"
        surface_grant_prompt(
            user_id=str(user_id or ""),
            conversation_id=conv,
            micro_app_id=mid,
            capability=capability,
            tool=tool,
            command=command,
            machine_id=machine_id,
            reason=reason,
            suggested_decision=str(result.get("suggested_decision") or ""),
            high_sensitivity=bool(result.get("high_sensitivity")),
        )

    return (
        reject_payload(
            error_code=error_code or "grant_denied",
            tool=tool,
            micro_app_id=mid,
            capability=capability,
            error=str(result.get("error") or error_code or "grant_denied"),
            extra={
                "decision": decision,
                "needs_prompt": bool(result.get("needs_prompt")),
                "high_sensitivity": bool(result.get("high_sensitivity")),
                "suggested_decision": str(result.get("suggested_decision") or ""),
            },
        ),
        "",
    )


def apply_offer_filter(
    available_tool_names: list[str] | None,
    *,
    user_id: str,
    micro_app_id: str,
    client: ClientContext | None,
) -> list[str] | None:
    """Filter tool names when micro_app_id is set. Returns original list if no id."""
    mid = (micro_app_id or "").strip()
    if not mid or available_tool_names is None:
        return available_tool_names
    host_tools = True
    if client is not None:
        host_tools = bool(client.capabilities.host_tools)
    try:
        ctx = fetch_micro_app_context(str(user_id or ""), mid)
        caps = ctx.get("capabilities") if isinstance(ctx.get("capabilities"), list) else []
        caps_s = [str(c) for c in caps]
    except Exception as e:  # noqa: BLE001
        logger.warning("micro_app context fetch failed id=%s err=%s", mid, e)
        # Fail closed for hostish tools when context unavailable.
        return [n for n in available_tool_names if not is_hostish_tool(n)]
    filtered = filter_tools_for_micro_app(
        available_tool_names, capabilities=caps_s, host_tools=host_tools
    )
    dropped = set(available_tool_names) - set(filtered)
    if dropped:
        logger.info(
            "micro_app_dual_gate offer_filter micro_app_id=%s dropped=%s",
            mid,
            sorted(dropped),
        )
    return filtered
