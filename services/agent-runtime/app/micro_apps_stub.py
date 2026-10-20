"""Micro App runtime tools: draft / upload / pin / list / get_runtime / update.

Calls Go internal endpoints that share create/pin/bundle/list/runtime/patch
semantics with /v1/micro-apps (including the user_intent gate on draft/pin).
Never create draft/pin from model narration alone. Bundle upload does not pin
and does not require user_intent.

Modify path (existing id): list_micro_apps (or known id) → get_micro_app_runtime
(read HTML/JS) → upload_micro_app_bundle and/or update_micro_app. Forbid
draft_micro_app for an existing tool. If already pinned, do not pin again and
do not open chat_pin unless the user explicitly asks.
"""

from __future__ import annotations

from typing import Any

from . import openbot_api as obapi

DRAFT_MICRO_APP_TOOL = "draft_micro_app"
UPLOAD_MICRO_APP_BUNDLE_TOOL = "upload_micro_app_bundle"
PIN_MICRO_APP_TOOL = "pin_micro_app"
LIST_MICRO_APPS_TOOL = "list_micro_apps"
GET_MICRO_APP_RUNTIME_TOOL = "get_micro_app_runtime"
UPDATE_MICRO_APP_TOOL = "update_micro_app"

_VALID_INTENTS = frozenset({"save", "pin_agree", "user_save", "user_pin", "confirm"})

_MODIFY_RULE = (
    "【修改已有 → 先 list_micro_apps / 用上下文 id → get_micro_app_runtime 读取 files "
    "→ 改完用同一 id 调 upload_micro_app_bundle 和/或 update_micro_app；"
    "禁止再 draft_micro_app 新建。勿向用户索要 index.html（服务端已有 bundle）。】"
)


def require_user_intent(raw: Any) -> str:
    intent = str(raw or "").strip().lower()
    if intent not in _VALID_INTENTS:
        raise ValueError(
            "user_intent required (save|pin_agree|user_save|user_pin|confirm); "
            "draft/pin must not be silent"
        )
    return intent


def coerce_explicit_bool(raw: Any, *, default: bool = False) -> bool:
    """Strict bool coerce for tool args (esp. chat_pin / shortcut flags).

    True only for JSON boolean True, or string ``true`` / ``1`` (case-insensitive).
    False for missing/None (uses default), False, ``"false"``, ``"0"``, ``""``,
    and any other value (e.g. ``"yes"``) — never Python truthiness of non-empty strings.
    """
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        # JSON numbers: only exact 1 is true; 0 is false; others false
        return raw == 1
    if isinstance(raw, str):
        s = raw.strip().casefold()
        if s in ("true", "1"):
            return True
        if s in ("false", "0", ""):
            return False
        return False
    return default


def draft_micro_app(user_id: str, args: dict[str, Any]) -> dict[str, Any]:
    """POST /internal/micro-apps/create → same as POST /v1/micro-apps."""
    intent = require_user_intent(args.get("user_intent"))
    payload: dict[str, Any] = {
        "user_id": user_id,
        "user_intent": intent,
        "title": str(args.get("title") or "").strip(),
        "description": str(args.get("description") or "").strip(),
        "icon": str(args.get("icon") or "").strip(),
        "kind": str(args.get("kind") or "ui").strip() or "ui",
        "agent_id": str(args.get("agent_id") or "").strip(),
        "entrypoint": str(args.get("entrypoint") or "").strip(),
        "skill_slug": str(args.get("skill_slug") or "").strip(),
        "routine_id": str(args.get("routine_id") or "").strip(),
        "source_conversation_id": str(args.get("source_conversation_id") or "").strip(),
        "source_message_id": str(args.get("source_message_id") or "").strip(),
    }
    if args.get("capabilities") is not None:
        payload["capabilities"] = args.get("capabilities")
    if args.get("routine_config") is not None:
        payload["routine_config"] = args.get("routine_config")
    payload = {k: v for k, v in payload.items() if v is not None and v != ""}
    # user_intent + title + kind must survive filtering
    payload["user_id"] = user_id
    payload["user_intent"] = intent
    if "title" not in payload:
        payload["title"] = str(args.get("title") or "").strip()
    if "kind" not in payload:
        payload["kind"] = str(args.get("kind") or "ui").strip() or "ui"
    return obapi._post("/internal/micro-apps/create", payload)


def upload_micro_app_bundle(user_id: str, args: dict[str, Any]) -> dict[str, Any]:
    """POST /internal/micro-apps/bundle — same unpack/store as PUT /v1/micro-apps/{id}/bundle.

    Prefer files map (path → utf-8 string or {encoding, content}) after generating HTML.
    Optional zip_base64 for a prebuilt archive. Does not pin; overwrites bundle for
    an existing id (modify path). Does not create a new micro-app.
    """
    app_id = str(args.get("id") or args.get("micro_app_id") or "").strip()
    if not app_id:
        raise ValueError("id (micro_app_id) required")
    payload: dict[str, Any] = {
        "user_id": user_id,
        "id": app_id,
    }
    entry = str(args.get("entrypoint") or "").strip()
    if entry:
        payload["entrypoint"] = entry
    zip_b64 = str(args.get("zip_base64") or "").strip()
    files = args.get("files")
    if zip_b64:
        # normalize whitespace from model dumps
        payload["zip_base64"] = "".join(zip_b64.split())
    elif files is not None:
        if not isinstance(files, dict) or not files:
            raise ValueError("files must be a non-empty object of path → content")
        payload["files"] = files
    else:
        # Convenience: single html / manifest fields → files map
        html = args.get("index_html") or args.get("html")
        built: dict[str, Any] = {}
        if html is not None:
            built["index.html"] = str(html)
        if args.get("manifest") is not None:
            man = args.get("manifest")
            built["manifest.json"] = (
                man if isinstance(man, str) else __import__("json").dumps(man, ensure_ascii=False)
            )
        if args.get("extra_files") and isinstance(args.get("extra_files"), dict):
            built.update(args["extra_files"])
        if not built:
            raise ValueError("zip_base64 or files (or index_html) required")
        payload["files"] = built
    # Large payloads: allow longer timeout
    return obapi._post("/internal/micro-apps/bundle", payload, timeout=120.0)


def pin_micro_app(user_id: str, args: dict[str, Any]) -> dict[str, Any]:
    """POST /internal/micro-apps/pin → same as POST /v1/micro-apps/{id}/pin."""
    intent = require_user_intent(args.get("user_intent"))
    app_id = str(args.get("id") or args.get("micro_app_id") or "").strip()
    if not app_id:
        raise ValueError("id (micro_app_id) required")
    payload: dict[str, Any] = {
        "user_id": user_id,
        "id": app_id,
        "user_intent": intent,
        "chat_pin": coerce_explicit_bool(args.get("chat_pin"), default=False),
        "context_id": str(args.get("context_id") or "").strip(),
    }
    if args.get("surfaces") is not None:
        payload["surfaces"] = args.get("surfaces")
    return obapi._post("/internal/micro-apps/pin", payload)


def list_micro_apps(user_id: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """POST /internal/micro-apps/list → light inventory for modify-path id discovery."""
    args = dict(args or {})
    payload: dict[str, Any] = {"user_id": user_id}
    status = str(args.get("status") or "").strip()
    surface = str(args.get("surface") or "").strip()
    limit_raw = args.get("limit")
    if status:
        payload["status"] = status
    if surface:
        payload["surface"] = surface
    if limit_raw is not None and str(limit_raw).strip() != "":
        try:
            payload["limit"] = int(limit_raw)
        except (TypeError, ValueError) as e:
            raise ValueError("limit must be an integer") from e
    return obapi._post("/internal/micro-apps/list", payload)



def get_micro_app_runtime(user_id: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    """POST /internal/micro-apps/runtime → same files pack as GET /v1/micro-apps/{id}/runtime.

    Use on the modify path to read existing UI source (index.html / CSS / JS) before
    overwrite via upload_micro_app_bundle. Does not create, pin, or mutate.
    """
    args = dict(args or {})
    app_id = str(args.get("id") or args.get("micro_app_id") or "").strip()
    if not app_id:
        raise ValueError("id (micro_app_id) required")
    return obapi._post(
        "/internal/micro-apps/runtime",
        {"user_id": user_id, "id": app_id},
        timeout=60.0,
    )


def update_micro_app(user_id: str, args: dict[str, Any]) -> dict[str, Any]:
    """POST /internal/micro-apps/update → same as PATCH /v1/micro-apps/{id}.

    Metadata-only update for an existing id. Does not create, does not pin,
    does not change chat_pin placements. Pair with upload_micro_app_bundle to
    overwrite UI files.
    """
    app_id = str(args.get("id") or args.get("micro_app_id") or "").strip()
    if not app_id:
        raise ValueError("id (micro_app_id) required")
    payload: dict[str, Any] = {
        "user_id": user_id,
        "id": app_id,
    }
    for key in ("title", "description", "icon", "entrypoint", "skill_slug", "routine_id"):
        if key in args and args.get(key) is not None:
            val = args.get(key)
            payload[key] = str(val).strip() if not isinstance(val, (dict, list)) else val
    if "capabilities" in args and args.get("capabilities") is not None:
        payload["capabilities"] = args.get("capabilities")
    if "routine_config" in args and args.get("routine_config") is not None:
        payload["routine_config"] = args.get("routine_config")
    # At least one patch field beyond id/user_id
    if len(payload) <= 2:
        raise ValueError(
            "update_micro_app requires at least one of: title, description, icon, "
            "entrypoint, skill_slug, routine_id, capabilities, routine_config"
        )
    return obapi._post("/internal/micro-apps/update", payload)


MICRO_APP_TOOL_DEFS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": LIST_MICRO_APPS_TOOL,
            "description": (
                "列出当前用户的微应用（轻量：id/title/status/kind/placements；不含源码）。"
                + _MODIFY_RULE
                + "用户要修改/改进已有工具时必须先调本工具（或使用会话上下文中已有 id），"
                "再 get_micro_app_runtime 读源码，最后同一 id 调 upload_micro_app_bundle / "
                "update_micro_app。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["draft", "pinned"],
                        "description": "可选过滤；默认排除 archived",
                    },
                    "surface": {
                        "type": "string",
                        "description": "可选：hub / chat_pin / desktop_shortcut / mobile_shortcut",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "最多返回条数，默认 20，最大 50",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": GET_MICRO_APP_RUNTIME_TOOL,
            "description": (
                "读取已有微应用的 UI bundle 源码（entrypoint + files：index.html / "
                "CSS / JS 等），对齐 GET /v1/micro-apps/{id}/runtime。"
                "修改已有工具前必须先调本工具拿到现有代码，再改并 "
                "upload_micro_app_bundle 同 id 覆盖；不要向用户索要文件，"
                "也不要用 host/sandbox 去猜路径。"
                + _MODIFY_RULE
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "已有微应用 id"},
                    "micro_app_id": {"type": "string", "description": "同 id"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": DRAFT_MICRO_APP_TOOL,
            "description": (
                "将用户确认要【新建】保存的微应用成果写成 draft（status=draft）。"
                + _MODIFY_RULE
                + "仅当用户明确表达保存/固定意图，或你已询问「要不要固定」且用户同意后调用；"
                + "必须传 user_intent（save|pin_agree|user_save|user_pin|confirm）。"
                "禁止仅凭模型口头「已保存」静默建库。"
                "kind=ui 时：draft 后应立刻用 upload_micro_app_bundle 上传 HTML/文件（用户无需手传 zip）；"
                "固定还需再调 pin_micro_app（禁止静默 pin）。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_intent": {
                        "type": "string",
                        "enum": ["save", "pin_agree", "user_save", "user_pin", "confirm"],
                        "description": "用户意图门：save|pin_agree|user_save|user_pin|confirm",
                    },
                    "title": {"type": "string", "description": "微应用标题"},
                    "description": {"type": "string"},
                    "icon": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": ["ui", "skill", "routine"],
                        "description": "默认 ui",
                    },
                    "capabilities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "声明的能力，如 host.clipboard.read、cloud.http",
                    },
                    "skill_slug": {"type": "string", "description": "kind=skill 时必填"},
                    "routine_id": {"type": "string", "description": "kind=routine 时可绑已有例行"},
                    "routine_config": {
                        "type": "object",
                        "description": "kind=routine 配方（prompt + cron 或 triggers）",
                    },
                    "source_conversation_id": {"type": "string"},
                    "source_message_id": {"type": "string"},
                },
                "required": ["user_intent", "title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": UPLOAD_MICRO_APP_BUNDLE_TOOL,
            "description": (
                "将 Bot 生成的 UI 微应用文件上传为 bundle（解压校验 + MinIO/本地落库）。"
                "对已有 id：覆盖写 bundle（修改路径），不创建新应用、不 pin。"
                + _MODIFY_RULE
                + "新建路径：draft_micro_app 得到 id 后，把 index.html / manifest.json 等放入 files 调用本工具；"
                "用户不必再手传 zip。可选 zip_base64。不固定（不 pin），也不改 user_intent。"
                "manifest.capabilities 必须 ⊆ 微应用已声明 capabilities。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "微应用 id（draft 返回或 list 得到）"},
                    "micro_app_id": {"type": "string", "description": "同 id"},
                    "files": {
                        "type": "object",
                        "description": (
                            "相对路径 → 内容。值为 utf-8 字符串，或 "
                            '{"encoding":"utf8|base64","content":"..."}。'
                            "通常含 index.html 与 manifest.json。"
                        ),
                        "additionalProperties": True,
                    },
                    "zip_base64": {
                        "type": "string",
                        "description": "可选；已打包 zip 的 base64（与 files 二选一，优先 zip）",
                    },
                    "index_html": {
                        "type": "string",
                        "description": "便捷字段：无 files 时写入 index.html",
                    },
                    "manifest": {
                        "description": "便捷字段：字符串或对象，写入 manifest.json",
                    },
                    "entrypoint": {
                        "type": "string",
                        "description": "可选覆盖入口（须存在于 files）",
                    },
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": UPDATE_MICRO_APP_TOOL,
            "description": (
                "更新已有微应用的元数据（标题/描述/图标/capabilities/routine_config 等），"
                "对齐 PATCH /v1/micro-apps/{id}。不创建新 id、不 pin、不改 chat_pin。"
                + _MODIFY_RULE
                + "改 UI 文件请用 upload_micro_app_bundle（同 id 覆盖）；"
                "若已 pinned，不要再调 pin_micro_app，也不要开 chat_pin。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "已有微应用 id"},
                    "micro_app_id": {"type": "string", "description": "同 id"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "icon": {"type": "string"},
                    "entrypoint": {"type": "string"},
                    "skill_slug": {"type": "string"},
                    "routine_id": {"type": "string"},
                    "capabilities": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "routine_config": {"type": "object"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": PIN_MICRO_APP_TOOL,
            "description": (
                "用户确认后将 draft 微应用固定为 pinned（写入 hub 等入口）。"
                "必须传 user_intent；禁止静默固定。kind=skill 会启用技能；"
                "kind=routine 会物化/绑定例行任务。"
                "kind=ui 建议已 upload_micro_app_bundle 后再 pin。"
                + _MODIFY_RULE
                + "若该 id 已是 pinned：不要再调本工具；修改用 upload/update。"
                "chat_pin：仅当用户明确要求「聊天栏快捷 / 输入框上方 / chat pin」时传 "
                "boolean true（或字符串 true/1）；保存/固定/修改默认 false。"
                "不要传 \"True\"/\"False\" 以外的随意字符串当开关。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_intent": {
                        "type": "string",
                        "enum": ["save", "pin_agree", "user_save", "user_pin", "confirm"],
                    },
                    "id": {"type": "string", "description": "微应用 id"},
                    "chat_pin": {
                        "type": "boolean",
                        "description": (
                            "挂到会话快捷条 chat_pin。仅 JSON boolean true 或显式 "
                            "true/1 为开；缺省/false/\"False\"/\"0\" 为关。"
                            "仅用户明确要「输入框上方/聊天快捷」时传 true；"
                            "保存/固定/修改默认 false。"
                        ),
                    },
                    "surfaces": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "额外入口：desktop_shortcut / mobile_shortcut",
                    },
                    "context_id": {"type": "string"},
                },
                "required": ["user_intent", "id"],
            },
        },
    },
]

MICRO_APP_TOOL_NAMES = frozenset(
    str((t.get("function") or {}).get("name") or "") for t in MICRO_APP_TOOL_DEFS
)
