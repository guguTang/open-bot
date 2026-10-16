"""ListMachines helper: call Go internal API (same auth as sandbox/agent_bus)."""

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


def list_machines(user_id: str, timeout: float = 15.0) -> dict[str, Any]:
    """Return {"machines": [...], "count": N} for the user."""
    uid = (user_id or "").strip()
    if not uid:
        return {"error": "user_id required", "machines": [], "count": 0}
    url = f"{_api_base()}/internal/machines/list"
    data = json.dumps({"user_id": uid}).encode("utf-8")
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
            return json.loads(raw) if raw else {"machines": [], "count": 0}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        return {"error": f"machines api HTTP {e.code}: {detail}", "machines": [], "count": 0}
    except urllib.error.URLError as e:
        return {"error": f"machines api unreachable: {e}", "machines": [], "count": 0}


def _connected(machine: dict[str, Any]) -> bool:
    if "connected" in machine:
        return bool(machine.get("connected"))
    return bool(machine.get("online"))


def _host_eligible(machine: dict[str, Any]) -> bool:
    """Phones are login-only; only desktop may host (API host_eligible / device_type)."""
    if "host_eligible" in machine:
        return bool(machine.get("host_eligible"))
    dt = str(machine.get("device_type") or "").strip().lower()
    if dt == "mobile":
        return False
    if dt in ("desktop", "browser"):
        return True
    plat = str(machine.get("platform") or "").strip().lower()
    if plat in ("ios", "android", "iphone", "ipad"):
        return False
    app = str(machine.get("app") or "").strip().lower()
    if app == "capacitor":
        return False
    return True


def usual_work_machine(machines: list[dict[str, Any]]) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_count = 0
    for m in machines:
        try:
            count = int(m.get("file_op_count") or 0)
        except (TypeError, ValueError):
            count = 0
        if count > best_count:
            best = m
            best_count = count
    return best


def select_machine(
    machines: list[dict[str, Any]],
    *,
    explicit_id: str = "",
    current_id: str = "",
    preferred_id: str = "",
) -> dict[str, Any]:
    """Pick the host for a local/file op.

    Order (product 2026-10-07):
      1. Tool-named machine_id (explicit)
      2. Current session machine (client_env.machine_id) — if set, use it or
         fail; never silently switch to another host mid-rules
      3. Optional preferred (agents.machine_id / 「优先电脑」) when connected
      4. Sole connected machine
      5. Else ask / refuse (no「最常用工作设备」override)
    """
    rows = [m for m in machines if isinstance(m, dict) and str(m.get("id") or "").strip()]
    by_id = {str(m["id"]): m for m in rows}
    explicit = (explicit_id or "").strip()
    current = (current_id or "").strip()
    preferred = (preferred_id or "").strip()

    offline_current = "当前电脑未连接，本地文件和命令暂时不可用。请在客户端连上后再试。"
    browser_need_host = "本地能力需要在已连接的桌面客户端里操作。请换到已连接的电脑再试。"
    mobile_not_host = "手机只用来登录，不能作为本机执行通道。请换到已连接的电脑再试。"

    if explicit:
        chosen = by_id.get(explicit)
        if chosen is None:
            return {"ok": False, "error": "没有这台已登记的电脑", "machines": rows}
        if not _host_eligible(chosen):
            label = str(chosen.get("label") or "那台设备")
            return {
                "ok": False,
                "error": mobile_not_host,
                "machine_id": explicit,
                "label": label,
                "machines": rows,
            }
        if not _connected(chosen):
            label = str(chosen.get("label") or "那台电脑")
            return {
                "ok": False,
                "error": f"「{label}」未连接，本地文件和命令暂时不可用。请在客户端连上后再试。",
                "machine_id": explicit,
                "label": label,
                "machines": rows,
            }
        return {"ok": True, "machine": chosen}

    # Session host pinned for this message/run: present ⇒ use or fail (no fallback).
    if current:
        chosen = by_id.get(current)
        if chosen is not None and not _host_eligible(chosen):
            label = str(chosen.get("label") or "")
            out: dict[str, Any] = {
                "ok": False,
                "error": mobile_not_host,
                "machine_id": current,
                "machines": rows,
            }
            if label:
                out["label"] = label
            return out
        if chosen is None or not _connected(chosen):
            label = ""
            if chosen is not None:
                label = str(chosen.get("label") or "")
            out = {
                "ok": False,
                "error": offline_current,
                "machine_id": current,
                "machines": rows,
            }
            if label:
                out["label"] = label
            return out
        return {"ok": True, "machine": chosen}

    # Browser / no session machine: preferred → sole → prompt (desktop hosts only).
    if preferred:
        chosen = by_id.get(preferred)
        if chosen is not None and _host_eligible(chosen) and _connected(chosen):
            return {"ok": True, "machine": chosen}

    connected = [m for m in rows if _connected(m) and _host_eligible(m)]
    if len(connected) == 1:
        return {"ok": True, "machine": connected[0]}
    if not connected:
        return {"ok": False, "error": browser_need_host, "machines": rows}
    labels = "、".join(str(m.get("label") or m.get("id")) for m in connected)
    return {
        "ok": False,
        "error": f"有多台电脑已连接（{labels}），请说明要操作哪一台，或在设置里选一台优先电脑。",
        "machines": rows,
    }


# Desktop host_shell is 120s; API hostExecTimeout is 150s. This HTTP wait must
# stay strictly above the API so urllib does not cut the tool off first.
HOST_EXEC_TIMEOUT_SEC = 180.0


def exec_host(
    user_id: str,
    machine_id: str,
    op: str,
    *,
    path: str = "",
    dest: str = "",
    content: str = "",
    conversation_id: str = "",
    ssh_host: str = "",
    ssh_user: str = "",
    ssh_port: int = 0,
    limit: int | None = None,
    sort: str = "",
    glob: str = "",
    args: dict[str, Any] | None = None,
    timeout: float = HOST_EXEC_TIMEOUT_SEC,
) -> dict[str, Any]:
    uid = (user_id or "").strip()
    mid = (machine_id or "").strip()
    if not uid or not mid:
        return {"ok": False, "error": "user_id and machine_id required"}
    url = f"{_api_base()}/internal/machines/exec"
    payload: dict[str, Any] = {
        "user_id": uid,
        "machine_id": mid,
        "op": op,
        "path": path,
        "dest": dest,
        "content": content,
        "conversation_id": conversation_id,
    }
    if ssh_host:
        payload["ssh_host"] = ssh_host
        payload["ssh_user"] = ssh_user
        payload["ssh_port"] = ssh_port
    if limit is not None:
        try:
            payload["limit"] = int(limit)
        except (TypeError, ValueError):
            pass
    if sort:
        payload["sort"] = str(sort).strip()
    if glob:
        payload["glob"] = str(glob).strip()
    if args:
        payload["args"] = args
    data = json.dumps(payload).encode("utf-8")
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
            return json.loads(raw) if raw else {"ok": False, "error": "empty response"}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"host exec HTTP {e.code}: {detail}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"host exec unreachable: {e}"}


WORK_DEVICE_TAG = "host-work-device"


def remember_usual_device(mem: Any, usual: dict[str, Any] | None) -> None:
    if mem is None or not isinstance(usual, dict):
        return
    label = str(usual.get("label") or "").strip()
    mid = str(usual.get("id") or "").strip()
    if not label or not mid:
        return
    platform = str(usual.get("platform") or "").strip()
    text = (
        f"最常用的工作设备是{label}（machine_id={mid}"
        + (f"，platform={platform}" if platform else "")
        + "）。用户没点名电脑、只说打开某个路径时用这台；"
        "它没连接就告诉用户打开这台电脑，不要改用当前手机。"
    )
    try:
        mem.upsert_tagged(text, WORK_DEVICE_TAG, tier="profile", scope="user")
    except Exception:  # noqa: BLE001
        return

