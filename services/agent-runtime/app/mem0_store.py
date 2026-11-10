"""Mem0 OSS memory layer (auto fact extraction + semantic recall).

Uses project OPENAI_* / EMBEDDING_* / DATABASE_URL. Collection is separate from
MemoryStore's `memories` table (default: openbot_mem0). Failures degrade to disabled.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_lock = threading.RLock()
_instance: Any | None = None
_init_attempted = False
_init_error: str | None = None
_enabled_flag: bool | None = None


def _env_truthy(name: str, default: str = "1") -> bool:
    raw = (os.getenv(name) if os.getenv(name) is not None else default) or default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def mem0_wanted() -> bool:
    """Whether MEM0_ENABLED requests Mem0 (before init success)."""
    return _env_truthy("MEM0_ENABLED", "1")


def mem0_collection() -> str:
    return (os.getenv("MEM0_COLLECTION") or "openbot_mem0").strip() or "openbot_mem0"


def mem0_top_k() -> int:
    try:
        return max(1, min(int((os.getenv("MEM0_TOP_K") or "5").strip()), 50))
    except ValueError:
        return 5


def mem0_auto_add() -> bool:
    return _env_truthy("MEM0_AUTO_ADD", "1")


def _history_db_path() -> str:
    override = (os.getenv("MEM0_HISTORY_DB") or "").strip()
    if override:
        return override
    data = Path(__file__).resolve().parents[1] / "data"
    data.mkdir(parents=True, exist_ok=True)
    return str(data / "mem0_history.db")


def _database_url() -> str:
    return (os.getenv("DATABASE_URL") or "").strip() or (
        "postgres://openbot:openbot@127.0.0.1:5432/openbot?sslmode=disable"
    )


def build_mem0_config() -> dict[str, Any]:
    """Build Memory.from_config dict from env (inspect mem0ai 2.2 field names)."""
    llm_base = (os.getenv("OPENAI_BASE_URL") or "").strip().rstrip("/")
    llm_key = (os.getenv("OPENAI_API_KEY") or "dummy").strip() or "dummy"
    llm_model = (
        (os.getenv("MEM0_LLM_MODEL") or "").strip()
        or (os.getenv("OPENAI_MODEL") or "").strip()
        or "gpt-4o-mini"
    )

    emb_base = (os.getenv("EMBEDDING_BASE_URL") or "").strip().rstrip("/")
    emb_key = (
        (os.getenv("EMBEDDING_API_KEY") or os.getenv("OPENAI_API_KEY") or "dummy").strip()
        or "dummy"
    )
    emb_model = (os.getenv("EMBEDDING_MODEL") or "bge-m3").strip()
    try:
        emb_dim = int((os.getenv("EMBEDDING_DIM") or "1024").strip())
    except ValueError:
        emb_dim = 1024

    # Prefer vllm provider for OpenAI-compatible chat endpoints; fall back to openai.
    llm_provider = (os.getenv("MEM0_LLM_PROVIDER") or "vllm").strip().lower() or "vllm"
    if llm_provider == "vllm":
        llm_cfg: dict[str, Any] = {
            "model": llm_model,
            "temperature": 0.1,
            "max_tokens": int((os.getenv("MEM0_LLM_MAX_TOKENS") or "1200").strip() or "1200"),
            "api_key": llm_key,
            "vllm_base_url": llm_base or "http://127.0.0.1:8000/v1",
        }
    else:
        llm_cfg = {
            "model": llm_model,
            "temperature": 0.1,
            "max_tokens": int((os.getenv("MEM0_LLM_MAX_TOKENS") or "1200").strip() or "1200"),
            "api_key": llm_key,
            "openai_base_url": llm_base or "https://api.openai.com/v1",
        }

    # bge-m3 (and most OpenAI-compatible embedders) reject `dimensions=`; only set
    # embedding_dims when MEM0_EMBEDDING_PASS_DIMS=1. Vector store still uses 1024.
    embedder_cfg: dict[str, Any] = {
        "model": emb_model,
        "api_key": emb_key,
        "openai_base_url": emb_base or "https://api.openai.com/v1",
    }
    if _env_truthy("MEM0_EMBEDDING_PASS_DIMS", "0"):
        embedder_cfg["embedding_dims"] = emb_dim

    dsn = _database_url()
    # Ensure sslmode=disable for local docker Postgres when missing.
    if "sslmode=" not in dsn and dsn.startswith("postgres"):
        dsn = dsn + ("&" if "?" in dsn else "?") + "sslmode=disable"

    return {
        "version": "v1.1",
        "history_db_path": _history_db_path(),
        "llm": {"provider": llm_provider if llm_provider in ("vllm", "openai") else "openai", "config": llm_cfg},
        "embedder": {"provider": "openai", "config": embedder_cfg},
        "vector_store": {
            "provider": "pgvector",
            "config": {
                "collection_name": mem0_collection(),
                "embedding_model_dims": emb_dim,
                "connection_string": dsn,
                "sslmode": "disable",
                "hnsw": True,
            },
        },
    }


def status() -> dict[str, Any]:
    """Health-friendly snapshot (no secrets)."""
    with _lock:
        enabled = bool(_instance is not None)
        return {
            "mem0_enabled": enabled,
            "mem0_wanted": mem0_wanted(),
            "mem0_collection": mem0_collection(),
            "mem0_top_k": mem0_top_k(),
            "mem0_auto_add": mem0_auto_add(),
            "mem0_init_error": _init_error,
        }


def get_mem0() -> Any | None:
    """Lazy singleton. Returns None if disabled or init failed."""
    global _instance, _init_attempted, _init_error, _enabled_flag

    if not mem0_wanted():
        _enabled_flag = False
        return None

    with _lock:
        if _instance is not None:
            return _instance
        if _init_attempted:
            return None
        _init_attempted = True
        try:
            from mem0 import Memory

            cfg = build_mem0_config()
            _instance = Memory.from_config(cfg)
            _enabled_flag = True
            _init_error = None
            logger.info(
                "Mem0 enabled collection=%s llm=%s",
                mem0_collection(),
                (os.getenv("MEM0_LLM_MODEL") or os.getenv("OPENAI_MODEL") or ""),
            )
            return _instance
        except Exception as e:  # noqa: BLE001
            _instance = None
            _enabled_flag = False
            _init_error = str(e)
            logger.warning("Mem0 init failed; treating as disabled: %s", e)
            return None


def reset_mem0_cache() -> None:
    """Test helper: clear singleton so next get_mem0() re-inits."""
    global _instance, _init_attempted, _init_error, _enabled_flag
    with _lock:
        _instance = None
        _init_attempted = False
        _init_error = None
        _enabled_flag = None


def _extract_memory_texts(raw: Any) -> list[str]:
    texts: list[str] = []
    if raw is None:
        return texts
    results = raw
    if isinstance(raw, dict):
        results = raw.get("results") or raw.get("memories") or []
    if not isinstance(results, list):
        return texts
    for row in results:
        if isinstance(row, str) and row.strip():
            texts.append(row.strip())
            continue
        if not isinstance(row, dict):
            continue
        mem = row.get("memory") or row.get("text") or row.get("content") or ""
        if isinstance(mem, str) and mem.strip():
            texts.append(mem.strip())
    return texts


def scope_metadata(
    scope: str,
    *,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
) -> dict[str, str]:
    return {
        "scope": (scope or "user").strip() or "user",
        "agent_id": (agent_id or "").strip(),
        "channel_id": (channel_id or "").strip(),
        "peer_agent_id": (peer_agent_id or "").strip(),
    }


def _row_metadata(row: dict[str, Any]) -> dict[str, Any]:
    md = row.get("metadata")
    return md if isinstance(md, dict) else {}


def _row_scope(row: dict[str, Any]) -> str:
    scope = str(_row_metadata(row).get("scope") or "").strip().lower()
    return scope or "user"


def _row_field(row: dict[str, Any], key: str) -> str:
    """Identity fields may sit on the row; everything else stays in metadata."""
    top = row.get(key)
    if isinstance(top, str) and top.strip():
        return top.strip()
    md = _row_metadata(row)
    return str(md.get(key) or "").strip()


def _row_matches_scope(
    row: dict[str, Any],
    *,
    scope: str | None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
) -> bool:
    want = (scope or "").strip().lower()
    if not want:
        return True
    if _row_scope(row) != want:
        return False
    agent = (agent_id or "").strip()
    channel = (channel_id or "").strip()
    peer = (peer_agent_id or "").strip()
    if want == "bot" and agent and _row_field(row, "agent_id") != agent:
        return False
    if want == "channel" and channel and _row_field(row, "channel_id") != channel:
        return False
    if want == "agent_pair" and (agent or peer):
        from .memory import normalize_pair

        left, right = normalize_pair(agent, peer)
        if _row_field(row, "agent_id") != left or _row_field(row, "peer_agent_id") != right:
            return False
    return True


def _extract_memory_rows(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    results = raw
    if isinstance(raw, dict):
        results = raw.get("results") or raw.get("memories") or []
    if not isinstance(results, list):
        return []
    rows: list[dict[str, Any]] = []
    for row in results:
        if isinstance(row, str) and row.strip():
            rows.append({"memory": row.strip(), "metadata": {}})
            continue
        if not isinstance(row, dict):
            continue
        mem = row.get("memory") or row.get("text") or row.get("content") or ""
        if isinstance(mem, str) and mem.strip():
            rows.append(row)
    return rows


def search_for_user(user_id: str, query: str, top_k: int | None = None) -> list[str]:
    """Semantic recall snippets for user_id. Empty on any failure."""
    return search_for_scope(user_id, query, top_k=top_k)


def search_for_scope(
    user_id: str,
    query: str,
    *,
    scope: str | None = None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
    top_k: int | None = None,
) -> list[str]:
    """Semantic recall for one user, optionally one memory scope. Empty on failure."""
    uid = (user_id or "").strip()
    q = (query or "").strip()
    if not uid or not q:
        return []
    m = get_mem0()
    if m is None:
        return []
    k = top_k if top_k is not None else mem0_top_k()
    fetch = k if not (scope or "").strip() else min(50, max(k * 4, k))
    try:
        raw = m.search(q, filters={"user_id": uid}, top_k=fetch)
        from .usage_meter import record_text_call

        record_text_call(
            call_kind_name="mem0",
            model=os.getenv("MEM0_EMBEDDING_MODEL") or os.getenv("EMBEDDING_MODEL") or "bge-m3",
            base_url=os.getenv("MEM0_EMBEDDING_BASE_URL") or os.getenv("EMBEDDING_BASE_URL") or "",
            input_text=q,
            actor={"user_id": uid, "agent_id": agent_id},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Mem0 search failed user_id=%s: %s", uid, e)
        return []
    texts: list[str] = []
    for row in _extract_memory_rows(raw):
        if not _row_matches_scope(
            row,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        ):
            continue
        mem = row.get("memory") or row.get("text") or row.get("content") or ""
        if isinstance(mem, str) and mem.strip():
            texts.append(mem.strip())
        if len(texts) >= k:
            break
    return texts


def list_for_user(
    user_id: str,
    *,
    scope: str | None = None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
    limit: int = 100,
) -> dict[str, Any]:
    """List Mem0 facts for one user. Disabled or failed calls return an empty list."""
    uid = (user_id or "").strip()
    limit = max(1, min(int(limit or 100), 200))
    if not uid:
        return {"enabled": False, "memories": [], "reason": "user_id required"}
    m = get_mem0()
    if m is None:
        reason = _init_error or ("disabled" if not mem0_wanted() else "unavailable")
        return {"enabled": False, "memories": [], "reason": reason}
    try:
        # mem0 >= 1.0 rejects user_id as a top-level arg; it must be inside filters.
        raw = m.get_all(filters={"user_id": uid}, top_k=limit)
    except Exception as e:  # noqa: BLE001
        logger.warning("Mem0 list failed user_id=%s: %s", uid, e)
        return {"enabled": True, "memories": [], "reason": str(e)}
    out: list[dict[str, Any]] = []
    for row in _extract_memory_rows(raw):
        if not _row_matches_scope(
            row,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        ):
            continue
        mem = row.get("memory") or row.get("text") or row.get("content") or ""
        if not isinstance(mem, str) or not mem.strip():
            continue
        out.append(
            {
                "id": str(row.get("id") or ""),
                "content": mem.strip(),
                "scope": _row_scope(row),
                "agent_id": _row_field(row, "agent_id"),
                "channel_id": _row_field(row, "channel_id"),
                "peer_agent_id": _row_field(row, "peer_agent_id"),
                "created_at": row.get("created_at") or "",
                "updated_at": row.get("updated_at") or "",
            }
        )
        if len(out) >= limit:
            break
    out.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
    return {"enabled": True, "memories": out, "reason": ""}


def add_conversation(
    user_id: str,
    messages: list[dict[str, str]] | str,
    *,
    metadata: dict[str, str] | None = None,
    infer: bool = True,
) -> None:
    """Extract/store facts from a turn. Swallows errors."""
    uid = (user_id or "").strip()
    if not uid or messages is None:
        return
    if isinstance(messages, list) and not messages:
        return
    m = get_mem0()
    if m is None:
        return
    try:
        kwargs: dict[str, Any] = {"user_id": uid, "infer": infer}
        meta = dict(metadata or {})
        # mem0 treats agent_id as an identity field and drops it from metadata.
        agent = str(meta.pop("agent_id", "") or "").strip()
        if agent:
            kwargs["agent_id"] = agent
        if meta:
            kwargs["metadata"] = meta
        m.add(messages, **kwargs)
        if isinstance(messages, str):
            submitted = messages
        else:
            submitted = "\n".join(
                str(item.get("content") or "") for item in messages if isinstance(item, dict)
            )
        from .usage_meter import record_text_call

        record_text_call(
            call_kind_name="mem0",
            model=os.getenv("MEM0_EMBEDDING_MODEL") or os.getenv("EMBEDDING_MODEL") or "bge-m3",
            base_url=os.getenv("MEM0_EMBEDDING_BASE_URL") or os.getenv("EMBEDDING_BASE_URL") or "",
            input_text=submitted,
            actor={"user_id": uid, "agent_id": agent},
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Mem0 add failed user_id=%s: %s", uid, e)


def add_conversation_bg(
    user_id: str,
    messages: list[dict[str, str]] | str,
    *,
    metadata: dict[str, str] | None = None,
) -> None:
    """Fire-and-forget add in a daemon thread (do not block SSE)."""
    uid = (user_id or "").strip()
    if not uid or not mem0_auto_add():
        return
    if get_mem0() is None:
        return

    def _run() -> None:
        add_conversation(uid, messages, metadata=metadata)

    t = threading.Thread(target=_run, name="mem0-add", daemon=True)
    t.start()



def delete_all_for_user(user_id: str) -> dict[str, Any]:
    """Delete all Mem0 memories for user_id. Best-effort; returns status dict."""
    uid = (user_id or "").strip()
    if not uid:
        return {"ok": False, "reason": "user_id required"}
    m = get_mem0()
    if m is None:
        return {"ok": True, "skipped": True, "reason": "mem0 disabled"}
    try:
        m.delete_all(user_id=uid)
        return {"ok": True, "purged": True}
    except Exception as e:  # noqa: BLE001
        logger.warning("Mem0 delete_all failed user_id=%s: %s", uid, e)
        return {"ok": False, "reason": str(e)}



def merge_snippets(
    legacy: list[str],
    mem0_texts: list[str],
    *,
    max_total: int = 12,
) -> list[str]:
    """Merge MemoryStore + Mem0 snippets with loose dedupe; tag [mem0]."""
    out: list[str] = []
    seen_norm: set[str] = set()

    def _norm(s: str) -> str:
        return " ".join((s or "").lower().split())

    for s in legacy:
        text = (s or "").strip()
        if not text:
            continue
        n = _norm(text)
        # strip leading [tier] for dedupe key loosely
        key = n
        if key.startswith("[") and "]" in key:
            key = key.split("]", 1)[-1].strip()
        if key in seen_norm:
            continue
        seen_norm.add(key)
        out.append(text)
        if len(out) >= max_total:
            return out

    for s in mem0_texts:
        text = (s or "").strip()
        if not text:
            continue
        tagged = text if text.startswith("[mem0]") else f"[mem0] {text}"
        key = _norm(text if not text.startswith("[mem0]") else text[len("[mem0]") :].strip())
        if key in seen_norm:
            continue
        seen_norm.add(key)
        out.append(tagged)
        if len(out) >= max_total:
            break
    return out


def last_turn_messages(
    history: list[dict[str, Any]],
    assistant_reply: str,
    *,
    window: int = 4,
) -> list[dict[str, str]]:
    """Build a short user/assistant window for Mem0.add after a successful reply."""
    dialog: list[dict[str, str]] = []
    for m in history or []:
        role = str(m.get("role") or "")
        content = str(m.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            dialog.append({"role": role, "content": content})
    reply = (assistant_reply or "").strip()
    if reply:
        dialog.append({"role": "assistant", "content": reply})
    if window > 0 and len(dialog) > window:
        dialog = dialog[-window:]
    return dialog


