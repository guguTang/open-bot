"""Postgres memory store (tiers: profile | log | note) with optional pgvector recall.

Falls back to per-user JSON files when DATABASE_URL is unreachable.
Falls back to keyword recall when embeddings / pgvector are unavailable.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .embedding import embed_one, embedding_config, vector_literal

logger = logging.getLogger(__name__)

TIERS = frozenset({"profile", "log", "note"})
SCOPES = frozenset({"user", "bot", "channel", "agent_pair"})
TOTAL_MEMORY_BUDGET = 8
# Higher scopes fill first. Unused quota spills to the next scope.
SCENE_QUOTAS: dict[str, list[tuple[str, int]]] = {
    "dm": [("bot", 5), ("user", 3)],
    "channel": [("channel", 4), ("bot", 3), ("user", 2)],
    "agent_pair": [("agent_pair", 4), ("bot", 3), ("user", 2)],
}
_TIER_RANK = {"profile": 0, "log": 1, "note": 2}
DEFAULT_DATABASE_URL = "postgres://openbot:openbot@127.0.0.1:5432/openbot?sslmode=disable"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def database_url() -> str:
    return (os.getenv("DATABASE_URL") or "").strip() or DEFAULT_DATABASE_URL


@dataclass
class MemoryItem:
    id: str
    tier: str
    content: str
    tags: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=_utcnow)
    updated_at: str = field(default_factory=_utcnow)
    user_id: str | None = None
    has_embedding: bool = False
    scope: str = "user"
    agent_id: str = ""
    channel_id: str = ""
    peer_agent_id: str = ""


def normalize_pair(agent_id: str | None, peer_agent_id: str | None) -> tuple[str, str]:
    """Order a bot pair so A-B and B-A share one key."""
    a = (agent_id or "").strip()
    b = (peer_agent_id or "").strip()
    if not a or not b:
        return a, b
    return (a, b) if a <= b else (b, a)


def scene_kind(channel_id: str | None, peer_agent_id: str | None) -> str:
    if (peer_agent_id or "").strip():
        return "agent_pair"
    if (channel_id or "").strip():
        return "channel"
    return "dm"


def scope_label(scope: str) -> str:
    return "pair" if scope == "agent_pair" else scope


def resolve_write_scope(
    explicit: str | None,
    *,
    agent_id: str | None = None,
    channel_id: str | None = None,
    peer_agent_id: str | None = None,
) -> tuple[str, str, str, str]:
    """Return (scope, agent_id, channel_id, peer_agent_id) for a write.

    Omitted scope: channel when the run is in a group, otherwise the current bot.
    """
    scope = (explicit or "").strip().lower()
    agent = (agent_id or "").strip()
    channel = (channel_id or "").strip()
    peer = (peer_agent_id or "").strip()
    if not scope:
        scope = "channel" if channel else "bot"
    if scope not in SCOPES:
        raise ValueError(f"scope must be one of {sorted(SCOPES)}")
    if scope == "user":
        return "user", "", "", ""
    if scope == "bot":
        if not agent:
            raise ValueError("agent_id required for bot scope")
        return "bot", agent, "", ""
    if scope == "channel":
        if not channel:
            raise ValueError("channel_id required for channel scope")
        return "channel", "", channel, ""
    if not agent or not peer:
        raise ValueError("agent_id and peer_agent_id required for agent_pair scope")
    left, right = normalize_pair(agent, peer)
    return "agent_pair", left, "", right


def format_memory_snippet(item: MemoryItem) -> str:
    return f"[{scope_label(item.scope)}] [{item.tier}] {item.content}"


def _content_key(text: str) -> str:
    s = (text or "").strip()
    while s.startswith("[") and "]" in s:
        s = s.split("]", 1)[1].strip()
    return " ".join(s.lower().split())


# Caps for durable per-run recall payloads (admin inventory is separate).
MAX_RECALL_ITEMS = 32
MAX_RECALL_SNIPPET_CHARS = 500


def _clip_snippet(text: str, limit: int = MAX_RECALL_SNIPPET_CHARS) -> str:
    s = (text or "").strip()
    if len(s) <= limit:
        return s
    return s[: max(0, limit - 1)] + "…"


def merge_scoped_snippets(
    explicit: dict[str, list[MemoryItem]],
    mem0_by_scope: dict[str, list[str]],
    scene: str,
) -> list[str]:
    """Fill per-scope quotas. Explicit memories precede Mem0 inside a scope.

    Unused quota spills to the next scope. Duplicate text keeps the earlier copy.
    """
    return [r["snippet"] for r in build_recall_records(explicit, mem0_by_scope, scene)]


def build_recall_records(
    explicit: dict[str, list[MemoryItem]],
    mem0_by_scope: dict[str, list[str]],
    scene: str,
) -> list[dict[str, Any]]:
    """Structured items actually injected into the prompt (same quotas as snippets)."""
    plan = SCENE_QUOTAS.get(scene) or SCENE_QUOTAS["dm"]
    spill = 0
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def push(record: dict[str, Any], text: str) -> bool:
        key = _content_key(text)
        if not key or key in seen:
            return False
        if len(out) >= min(TOTAL_MEMORY_BUDGET, MAX_RECALL_ITEMS):
            return False
        seen.add(key)
        out.append(record)
        return True

    for scope, quota in plan:
        budget = quota + spill
        taken = 0
        for item in explicit.get(scope) or []:
            if taken >= budget or len(out) >= TOTAL_MEMORY_BUDGET:
                break
            snippet = format_memory_snippet(item)
            content = _clip_snippet(item.content)
            record = {
                "source": "explicit",
                "scope": item.scope or scope,
                "tier": item.tier or "",
                "content": content,
                "snippet": _clip_snippet(snippet),
                "memory_id": item.id or "",
                "agent_id": item.agent_id or "",
                "channel_id": item.channel_id or "",
                "peer_agent_id": item.peer_agent_id or "",
            }
            if push(record, snippet):
                taken += 1
        label = scope_label(scope)
        for text in mem0_by_scope.get(scope) or []:
            if taken >= budget or len(out) >= TOTAL_MEMORY_BUDGET:
                break
            raw = (text or "").strip()
            snippet = f"[{label}] [mem0] {raw}"
            record = {
                "source": "mem0",
                "scope": scope,
                "tier": "",
                "content": _clip_snippet(raw),
                "snippet": _clip_snippet(snippet),
                "memory_id": "",
                "agent_id": "",
                "channel_id": "",
                "peer_agent_id": "",
            }
            if push(record, snippet):
                taken += 1
        spill = max(0, budget - taken)
        if len(out) >= TOTAL_MEMORY_BUDGET:
            break
    return out[: min(TOTAL_MEMORY_BUDGET, MAX_RECALL_ITEMS)]


def build_recall_payload(
    explicit: dict[str, list[MemoryItem]],
    mem0_by_scope: dict[str, list[str]],
    scene: str,
    *,
    recalled: list[MemoryItem] | None = None,
    mem0_hits: list[str] | None = None,
) -> dict[str, Any]:
    """Admin-facing per-run recall payload (counts + capped items)."""
    items = build_recall_records(explicit, mem0_by_scope, scene)
    explicit_n = len(recalled) if recalled is not None else sum(
        1 for i in items if i.get("source") == "explicit"
    )
    mem0_n = len(mem0_hits) if mem0_hits is not None else sum(
        1 for i in items if i.get("source") == "mem0"
    )
    return {
        "scene": scene,
        "explicit_count": explicit_n,
        "mem0_count": mem0_n,
        "item_count": len(items),
        "items": items,
    }


def default_store_path() -> Path:
    return Path(__file__).resolve().parents[1] / "data" / "memories.json"


def store_path_for_user(user_id: str | None) -> Path:
    base = Path(__file__).resolve().parents[1] / "data"
    if user_id and str(user_id).strip():
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(user_id).strip())
        return base / "users" / f"{safe}.json"
    return default_store_path()


def re_split(q: str) -> list[str]:
    import re

    return re.split(r"[\s,，。；;、]+", q)


def _keyword_recall(candidates: list[MemoryItem], query: str, top_k: int) -> list[MemoryItem]:
    q = (query or "").strip().lower()
    if not candidates:
        return []
    if not q:
        return candidates[: max(1, top_k)]
    tokens = [t for t in re_split(q) if t]

    def score(item: MemoryItem) -> float:
        text = (item.content + " " + " ".join(item.tags)).lower()
        s = 0.0
        for t in tokens:
            if t in text:
                s += 1.0 + text.count(t) * 0.1
        # Small boost only after a real match, so profile does not outrank a closer note.
        if item.tier == "profile" and s > 0:
            s += 0.15
        return s

    ranked = sorted(candidates, key=lambda i: (-score(i), _TIER_RANK.get(i.tier, 9)))
    out = [i for i in ranked if score(i) > 0]
    if not out:
        return ranked[: max(1, top_k)]
    return out[: max(1, top_k)]


def _append_scope_sql(
    sql: str,
    params: list[Any],
    *,
    tier: str | None = None,
    scope: str | None = None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
) -> tuple[str, list[Any]]:
    if tier:
        sql += " AND tier = %s"
        params.append(tier.strip().lower())
    scope_name = (scope or "").strip().lower()
    if not scope_name:
        return sql, params
    sql += " AND scope = %s"
    params.append(scope_name)
    if scope_name == "bot":
        sql += " AND agent_id = %s"
        params.append((agent_id or "").strip())
    elif scope_name == "channel":
        sql += " AND channel_id = %s"
        params.append((channel_id or "").strip())
    elif scope_name == "agent_pair":
        left, right = normalize_pair(agent_id, peer_agent_id)
        sql += " AND agent_id = %s AND peer_agent_id = %s"
        params.extend([left, right])
    return sql, params


def _filter_items(
    items: list[MemoryItem],
    *,
    tier: str | None = None,
    scope: str | None = None,
    agent_id: str = "",
    channel_id: str = "",
    peer_agent_id: str = "",
) -> list[MemoryItem]:
    if tier:
        want = tier.strip().lower()
        items = [i for i in items if i.tier == want]
    scope_name = (scope or "").strip().lower()
    if not scope_name:
        return items
    agent = (agent_id or "").strip()
    channel = (channel_id or "").strip()
    peer = (peer_agent_id or "").strip()
    if scope_name == "agent_pair":
        agent, peer = normalize_pair(agent, peer)
    out: list[MemoryItem] = []
    for item in items:
        if item.scope != scope_name:
            continue
        if scope_name == "bot" and item.agent_id != agent:
            continue
        if scope_name == "channel" and item.channel_id != channel:
            continue
        if scope_name == "agent_pair" and (item.agent_id != agent or item.peer_agent_id != peer):
            continue
        out.append(item)
    return out


class _JSONMemoryBackend:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._items: list[MemoryItem] = []
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._load()

    @property
    def vector_enabled(self) -> bool:
        return False

    def _load(self) -> None:
        if not self.path.is_file():
            self._items = []
            return
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self._items = []
            return
        items: list[MemoryItem] = []
        for row in raw if isinstance(raw, list) else raw.get("items", []):
            try:
                tier = str(row.get("tier", "note"))
                if tier not in TIERS:
                    tier = "note"
                scope = str(row.get("scope") or "user").strip().lower()
                if scope not in SCOPES:
                    scope = "user"
                items.append(
                    MemoryItem(
                        id=str(row.get("id") or uuid.uuid4()),
                        tier=tier,
                        content=str(row.get("content") or ""),
                        tags=list(row.get("tags") or []),
                        created_at=str(row.get("created_at") or _utcnow()),
                        updated_at=str(row.get("updated_at") or _utcnow()),
                        scope=scope,
                        agent_id=str(row.get("agent_id") or ""),
                        channel_id=str(row.get("channel_id") or ""),
                        peer_agent_id=str(row.get("peer_agent_id") or ""),
                    )
                )
            except Exception:  # noqa: BLE001
                continue
        self._items = [i for i in items if i.content.strip()]

    def _save(self) -> None:
        payload = [
            {
                k: v
                for k, v in asdict(i).items()
                if k not in ("user_id", "has_embedding")
            }
            for i in self._items
        ]
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def write(
        self,
        content: str,
        tier: str = "note",
        tags: Iterable[str] | None = None,
        *,
        user_id: str | None = None,
        scope: str = "user",
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> MemoryItem:
        content = (content or "").strip()
        if not content:
            raise ValueError("content required")
        tier = (tier or "note").strip().lower()
        if tier not in TIERS:
            raise ValueError(f"tier must be one of {sorted(TIERS)}")
        scope_name, agent, channel, peer = resolve_write_scope(
            scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        item = MemoryItem(
            id=str(uuid.uuid4()),
            tier=tier,
            content=content,
            tags=[t.strip() for t in (tags or []) if str(t).strip()],
            user_id=user_id,
            scope=scope_name,
            agent_id=agent,
            channel_id=channel,
            peer_agent_id=peer,
        )
        with self._lock:
            self._items.append(item)
            self._save()
        return item

    def upsert_tagged(
        self,
        content: str,
        tag: str,
        tier: str = "profile",
        *,
        user_id: str | None = None,
        scope: str = "user",
    ) -> MemoryItem:
        content = (content or "").strip()
        tag = (tag or "").strip()
        if not content or not tag:
            raise ValueError("content and tag required")
        scope_name, _, _, _ = resolve_write_scope(scope)
        with self._lock:
            for item in self._items:
                if item.tier == tier and item.scope == scope_name and tag in (item.tags or []):
                    if user_id and item.user_id and item.user_id != user_id:
                        continue
                    item.content = content
                    item.updated_at = _utcnow()
                    self._save()
                    return item
        return self.write(content, tier=tier, tags=[tag], user_id=user_id, scope=scope)

    def list_items(
        self,
        *,
        user_id: str | None = None,
        tier: str | None = None,
        limit: int = 50,
        scope: str | None = None,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> list[MemoryItem]:
        with self._lock:
            items = list(self._items)
        items = _filter_items(
            items,
            tier=tier,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        items.sort(key=lambda x: x.updated_at, reverse=True)
        return items[: max(1, min(limit, 200))]

    def recall(
        self,
        query: str,
        *,
        user_id: str | None = None,
        tier: str | None = None,
        top_k: int = 5,
        scope: str | None = None,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> list[MemoryItem]:
        with self._lock:
            candidates = list(self._items)
        candidates = _filter_items(
            candidates,
            tier=tier,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        return _keyword_recall(candidates, query, top_k)


class _PGMemoryBackend:
    def __init__(self, dsn: str) -> None:
        import psycopg

        self._dsn = dsn
        self._lock = threading.RLock()
        self._vector_enabled = False
        self._embedding_dim = embedding_config()[3]
        with psycopg.connect(dsn) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                  id TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  tier TEXT NOT NULL DEFAULT 'note',
                  content TEXT NOT NULL DEFAULT '',
                  tags TEXT[] NOT NULL DEFAULT '{}',
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            conn.execute("ALTER TABLE memories ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user'")
            conn.execute("ALTER TABLE memories ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE memories ADD COLUMN IF NOT EXISTS channel_id TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE memories ADD COLUMN IF NOT EXISTS peer_agent_id TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_memories_scope_agent ON memories (user_id, scope, agent_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_memories_scope_channel ON memories (user_id, scope, channel_id)"
            )
            conn.commit()
            try:
                conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
                conn.execute(
                    f"ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector({self._embedding_dim})"
                )
                conn.commit()
                self._vector_enabled = True
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                logger.warning("pgvector unavailable, keyword recall only: %s", e)
                self._vector_enabled = False

    @property
    def vector_enabled(self) -> bool:
        return self._vector_enabled

    def _connect(self):
        import psycopg

        return psycopg.connect(self._dsn)

    def write(
        self,
        content: str,
        tier: str = "note",
        tags: Iterable[str] | None = None,
        *,
        user_id: str | None = None,
        scope: str = "user",
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> MemoryItem:
        content = (content or "").strip()
        if not content:
            raise ValueError("content required")
        tier = (tier or "note").strip().lower()
        if tier not in TIERS:
            raise ValueError(f"tier must be one of {sorted(TIERS)}")
        scope_name, agent, channel, peer = resolve_write_scope(
            scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        uid = (user_id or "").strip() or "_anonymous"
        tag_list = [t.strip() for t in (tags or []) if str(t).strip()]
        item_id = str(uuid.uuid4())
        emb = None
        if self._vector_enabled:
            emb = embed_one(content)
            if emb is not None and len(emb) != self._embedding_dim:
                logger.warning(
                    "embedding dim mismatch got=%s expected=%s; skipping",
                    len(emb),
                    self._embedding_dim,
                )
                emb = None
        with self._lock:
            with self._connect() as conn:
                if emb is not None:
                    row = conn.execute(
                        """
                        INSERT INTO memories (
                          id, user_id, tier, content, tags, embedding,
                          scope, agent_id, channel_id, peer_agent_id, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s::vector, %s, %s, %s, %s, NOW(), NOW())
                        RETURNING id, tier, content, tags, created_at, updated_at, user_id, TRUE,
                                  scope, agent_id, channel_id, peer_agent_id
                        """,
                        (item_id, uid, tier, content, tag_list, vector_literal(emb), scope_name, agent, channel, peer),
                    ).fetchone()
                else:
                    row = conn.execute(
                        """
                        INSERT INTO memories (
                          id, user_id, tier, content, tags,
                          scope, agent_id, channel_id, peer_agent_id, created_at, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                        RETURNING id, tier, content, tags, created_at, updated_at, user_id, FALSE,
                                  scope, agent_id, channel_id, peer_agent_id
                        """,
                        (item_id, uid, tier, content, tag_list, scope_name, agent, channel, peer),
                    ).fetchone()
                conn.commit()
        return self._row_to_item(row)

    def upsert_tagged(
        self,
        content: str,
        tag: str,
        tier: str = "profile",
        *,
        user_id: str | None = None,
        scope: str = "user",
    ) -> MemoryItem:
        content = (content or "").strip()
        tag = (tag or "").strip()
        if not content or not tag:
            raise ValueError("content and tag required")
        tier = (tier or "profile").strip().lower()
        scope_name, agent, channel, peer = resolve_write_scope(scope)
        uid = (user_id or "").strip() or "_anonymous"
        with self._lock:
            with self._connect() as conn:
                row = conn.execute(
                    """
                    UPDATE memories SET content = %s, updated_at = NOW()
                    WHERE id = (
                      SELECT id FROM memories
                      WHERE user_id = %s AND tier = %s AND scope = %s AND %s = ANY(tags)
                      ORDER BY updated_at DESC
                      LIMIT 1
                    )
                    RETURNING id, tier, content, tags, created_at, updated_at, user_id,
                              CASE WHEN embedding IS NULL THEN FALSE ELSE TRUE END,
                              scope, agent_id, channel_id, peer_agent_id
                    """,
                    (content, uid, tier, scope_name, tag),
                ).fetchone()
                if row is not None:
                    if self._vector_enabled:
                        emb = embed_one(content)
                        if emb is not None and len(emb) == self._embedding_dim:
                            conn.execute(
                                "UPDATE memories SET embedding = %s::vector WHERE id = %s",
                                (vector_literal(emb), row[0]),
                            )
                            row = conn.execute(
                                """
                                SELECT id, tier, content, tags, created_at, updated_at, user_id, TRUE,
                                       scope, agent_id, channel_id, peer_agent_id
                                FROM memories WHERE id = %s
                                """,
                                (row[0],),
                            ).fetchone()
                    conn.commit()
                    return self._row_to_item(row)
                conn.commit()
        return self.write(content, tier=tier, tags=[tag], user_id=user_id, scope=scope_name, agent_id=agent, channel_id=channel, peer_agent_id=peer)

    def list_items(
        self,
        *,
        user_id: str | None = None,
        tier: str | None = None,
        limit: int = 50,
        scope: str | None = None,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> list[MemoryItem]:
        uid = (user_id or "").strip() or "_anonymous"
        limit = max(1, min(int(limit or 50), 200))
        params: list[Any] = [uid]
        sql = """
            SELECT id, tier, content, tags, created_at, updated_at, user_id,
                   CASE WHEN embedding IS NULL THEN FALSE ELSE TRUE END,
                   scope, agent_id, channel_id, peer_agent_id
            FROM memories WHERE user_id = %s
        """
        sql, params = _append_scope_sql(
            sql,
            params,
            tier=tier,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        sql += " ORDER BY updated_at DESC LIMIT %s"
        params.append(limit)
        try:
            with self._connect() as conn:
                rows = conn.execute(sql, params).fetchall()
        except Exception:  # noqa: BLE001
            sql2 = """
                SELECT id, tier, content, tags, created_at, updated_at, user_id, FALSE,
                       scope, agent_id, channel_id, peer_agent_id
                FROM memories WHERE user_id = %s
            """
            params2: list[Any] = [uid]
            sql2, params2 = _append_scope_sql(
                sql2,
                params2,
                tier=tier,
                scope=scope,
                agent_id=agent_id,
                channel_id=channel_id,
                peer_agent_id=peer_agent_id,
            )
            sql2 += " ORDER BY updated_at DESC LIMIT %s"
            params2.append(limit)
            with self._connect() as conn:
                rows = conn.execute(sql2, params2).fetchall()
        return [self._row_to_item(r) for r in rows]

    def recall(
        self,
        query: str,
        *,
        user_id: str | None = None,
        tier: str | None = None,
        top_k: int = 5,
        scope: str | None = None,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> list[MemoryItem]:
        top_k = max(1, int(top_k or 5))
        uid = (user_id or "").strip() or "_anonymous"
        q = (query or "").strip()

        if self._vector_enabled and q:
            q_emb = embed_one(q)
            if q_emb is not None and len(q_emb) == self._embedding_dim:
                sql = """
                    SELECT id, tier, content, tags, created_at, updated_at, user_id, TRUE,
                           scope, agent_id, channel_id, peer_agent_id
                    FROM memories
                    WHERE user_id = %s AND embedding IS NOT NULL
                """
                params: list[Any] = [uid]
                sql, params = _append_scope_sql(
                    sql,
                    params,
                    tier=tier,
                    scope=scope,
                    agent_id=agent_id,
                    channel_id=channel_id,
                    peer_agent_id=peer_agent_id,
                )
                sql += " ORDER BY embedding <=> %s::vector ASC LIMIT %s"
                params.extend([vector_literal(q_emb), top_k])
                try:
                    with self._connect() as conn:
                        rows = conn.execute(sql, params).fetchall()
                    if rows:
                        return [self._row_to_item(r) for r in rows]
                except Exception as e:  # noqa: BLE001
                    logger.warning("vector recall failed, falling back to keywords: %s", e)

        candidates = self.list_items(
            user_id=user_id,
            tier=tier,
            limit=200,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )
        return _keyword_recall(candidates, q, top_k)

    @staticmethod
    def _row_to_item(row: Any) -> MemoryItem:
        tags = list(row[3] or [])
        created = row[4]
        updated = row[5]
        has_emb = bool(row[7]) if len(row) > 7 else False
        scope = str(row[8]).strip().lower() if len(row) > 8 and row[8] else "user"
        if scope not in SCOPES:
            scope = "user"
        return MemoryItem(
            id=str(row[0]),
            tier=str(row[1]),
            content=str(row[2] or ""),
            tags=tags,
            created_at=created.isoformat() if hasattr(created, "isoformat") else str(created),
            updated_at=updated.isoformat() if hasattr(updated, "isoformat") else str(updated),
            user_id=str(row[6]) if row[6] else None,
            has_embedding=has_emb,
            scope=scope,
            agent_id=str(row[9] or "") if len(row) > 9 else "",
            channel_id=str(row[10] or "") if len(row) > 10 else "",
            peer_agent_id=str(row[11] or "") if len(row) > 11 else "",
        )


class MemoryStore:
    """Facade used by runtime tools/API. Prefer Postgres when available."""

    def __init__(self, user_id: str | None = None, path: Path | None = None) -> None:
        self.user_id = (user_id or "").strip() or None
        self._backend: Any
        self._backend_kind = "json"
        dsn = database_url()
        try:
            self._backend = _PGMemoryBackend(dsn)
            self._backend_kind = "postgres"
        except Exception:  # noqa: BLE001
            self._backend = _JSONMemoryBackend(path or store_path_for_user(self.user_id))
            self._backend_kind = "json"

    @property
    def backend_kind(self) -> str:
        return self._backend_kind

    @property
    def vector_enabled(self) -> bool:
        return bool(getattr(self._backend, "vector_enabled", False))

    def write(
        self,
        content: str,
        tier: str = "note",
        tags: Iterable[str] | None = None,
        *,
        scope: str = "user",
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> MemoryItem:
        return self._backend.write(
            content,
            tier=tier,
            tags=tags,
            user_id=self.user_id,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )

    def upsert_tagged(self, content: str, tag: str, tier: str = "profile", *, scope: str = "user") -> MemoryItem:
        return self._backend.upsert_tagged(content, tag, tier=tier, user_id=self.user_id, scope=scope)

    def list(
        self,
        tier: str | None = None,
        limit: int = 50,
        *,
        scope: str | None = None,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> list[MemoryItem]:
        return self._backend.list_items(
            user_id=self.user_id,
            tier=tier,
            limit=limit,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )

    def recall(
        self,
        query: str,
        *,
        tier: str | None = None,
        top_k: int = 5,
        scope: str | None = None,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
    ) -> list[MemoryItem]:
        return self._backend.recall(
            query,
            user_id=self.user_id,
            tier=tier,
            top_k=top_k,
            scope=scope,
            agent_id=agent_id,
            channel_id=channel_id,
            peer_agent_id=peer_agent_id,
        )

    def recall_buckets(
        self,
        query: str,
        *,
        agent_id: str = "",
        channel_id: str = "",
        peer_agent_id: str = "",
        tier: str | None = None,
    ) -> dict[str, list[MemoryItem]]:
        """Recall each scope active in this scene, ranked inside the scope."""
        scene = scene_kind(channel_id, peer_agent_id)
        buckets: dict[str, list[MemoryItem]] = {}
        for scope, _quota in SCENE_QUOTAS[scene]:
            aid, cid, peer = "", "", ""
            if scope == "bot":
                aid = (agent_id or "").strip()
            elif scope == "channel":
                cid = (channel_id or "").strip()
            elif scope == "agent_pair":
                aid, peer = normalize_pair(agent_id, peer_agent_id)
            buckets[scope] = self.recall(
                query,
                tier=tier,
                top_k=TOTAL_MEMORY_BUDGET,
                scope=scope,
                agent_id=aid,
                channel_id=cid,
                peer_agent_id=peer,
            )
        return buckets

    def to_public(self, item: MemoryItem) -> dict[str, Any]:
        d = asdict(item)
        d.pop("user_id", None)
        return d

    def maybe_import_json(self) -> int:
        if self._backend_kind != "postgres" or not self.user_id:
            return 0
        if self.list(limit=1):
            return 0
        path = store_path_for_user(self.user_id)
        if not path.is_file():
            return 0
        legacy = _JSONMemoryBackend(path)
        imported = 0
        for item in legacy.list_items(limit=200):
            try:
                self.write(
                    item.content,
                    tier=item.tier,
                    tags=item.tags,
                    scope=item.scope,
                    agent_id=item.agent_id,
                    channel_id=item.channel_id,
                    peer_agent_id=item.peer_agent_id,
                )
                imported += 1
            except Exception:  # noqa: BLE001
                continue
        return imported


_user_stores: dict[str, MemoryStore] = {}
_user_stores_lock = threading.Lock()


def get_store(user_id: str | None = None) -> MemoryStore:
    key = (user_id or "").strip() or "_global"
    with _user_stores_lock:
        store = _user_stores.get(key)
        if store is None:
            store = MemoryStore(user_id=user_id if key != "_global" else None)
            try:
                store.maybe_import_json()
            except Exception:  # noqa: BLE001
                pass
            _user_stores[key] = store
        return store


def clear_store_cache() -> None:
    with _user_stores_lock:
        _user_stores.clear()
