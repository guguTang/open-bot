"""Agent Skills loader (agentskills.io SKILL.md package).

Loads platform skills from Postgres global_skills + global_skill_files
(preferred), falls back to skills/ on disk, then merges per-user skills.
A skill is a directory package: SKILL.md plus optional references/, scripts/, etc.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

_FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.DOTALL)

DEFAULT_DATABASE_URL = "postgres://openbot:openbot@127.0.0.1:5432/openbot?sslmode=disable"

_SKIP_DIR_NAMES = {".git", "node_modules", "__pycache__", "users"}
_SKIP_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".wasm",
    ".so",
    ".dylib",
    ".exe",
    ".bin",
}
_MAX_FILE_BYTES = 512 * 1024
_MAX_FILES = 128


@dataclass
class SkillMeta:
    name: str
    description: str
    path: Path | None = None  # SKILL.md path when from disk
    custom: bool = False
    body_markdown: str | None = None
    source: str = "disk"
    # package-relative path -> content (may be lazy-filled for disk)
    files: dict[str, str] = field(default_factory=dict)


@dataclass
class SkillFull(SkillMeta):
    body: str = ""
    raw: str = ""


def database_url() -> str:
    return (os.getenv("DATABASE_URL") or "").strip() or DEFAULT_DATABASE_URL


def default_skills_root() -> Path:
    env = (os.getenv("SKILLS_DIR") or "").strip()
    if env:
        return Path(env)
    root = (os.getenv("OPEN_BOT_ROOT") or "").strip()
    if root:
        return Path(root) / "skills"
    return Path(__file__).resolve().parents[3] / "skills"


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip().strip("'\"")
    return meta, m.group(2).strip()


def _valid_rel_path(rel: str) -> bool:
    rel = rel.replace("\\", "/").strip()
    if not rel or rel.startswith("/") or ".." in rel.split("/"):
        return False
    for part in rel.split("/"):
        if not part or part in (".", ".."):
            return False
        if not all(c.isalnum() or c in "-_." for c in part):
            return False
    return True


def _read_package_dir(skill_dir: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    if not skill_dir.is_dir():
        return files
    for path in sorted(skill_dir.rglob("*")):
        if not path.is_file():
            continue
        if any(p in _SKIP_DIR_NAMES for p in path.parts):
            continue
        if path.name.startswith(".") or path.suffix.lower() in _SKIP_SUFFIXES:
            continue
        try:
            rel = path.relative_to(skill_dir).as_posix()
        except ValueError:
            continue
        if not _valid_rel_path(rel):
            continue
        try:
            if path.stat().st_size > _MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if "\0" in text:
            continue
        files[rel] = text
        if len(files) >= _MAX_FILES:
            break
    return files


def _load_dir(
    root: Path,
    *,
    custom: bool,
    into: dict[str, SkillMeta],
    skip_existing: bool = False,
) -> None:
    if not root.is_dir():
        return
    for skill_dir in sorted(root.iterdir()):
        if not skill_dir.is_dir():
            continue
        if not custom and skill_dir.name == "users":
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        try:
            text = skill_md.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, _ = _parse_frontmatter(text)
        name = (meta.get("name") or skill_dir.name).strip()
        desc = (meta.get("description") or "").strip()
        if not name or not desc:
            continue
        if skip_existing and name in into:
            continue
        pkg = _read_package_dir(skill_dir)
        if "SKILL.md" not in pkg:
            pkg["SKILL.md"] = text
        into[name] = SkillMeta(
            name=name,
            description=desc,
            path=skill_md,
            custom=custom,
            body_markdown=pkg.get("SKILL.md", text),
            source="disk",
            files=pkg,
        )


def _load_global_from_pg(into: dict[str, SkillMeta]) -> bool:
    try:
        import psycopg
    except ImportError:
        return False
    try:
        with psycopg.connect(database_url()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT name, description, body_markdown
                    FROM global_skills
                    WHERE enabled = TRUE
                    ORDER BY name ASC
                    """
                )
                rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT skill_name, path, content
                    FROM global_skill_files
                    ORDER BY skill_name ASC, path ASC
                    """
                )
                file_rows = cur.fetchall()
    except Exception:  # noqa: BLE001
        return False
    files_by: dict[str, dict[str, str]] = {}
    for skill_name, path, content in file_rows:
        n = str(skill_name or "").strip()
        p = str(path or "").strip().replace("\\", "/")
        if not n or not p:
            continue
        files_by.setdefault(n, {})[p] = str(content or "")
    for name, desc, body in rows:
        n = str(name or "").strip()
        d = str(desc or "").strip()
        raw = str(body or "")
        if not n or not d:
            continue
        pkg = dict(files_by.get(n) or {})
        if "SKILL.md" not in pkg and raw:
            pkg["SKILL.md"] = raw
        into[n] = SkillMeta(
            name=n,
            description=d,
            path=None,
            custom=False,
            body_markdown=pkg.get("SKILL.md", raw),
            source="db",
            files=pkg,
        )
    return True


def _load_user_from_pg(user_id: str, into: dict[str, SkillMeta]) -> bool:
    user_id = (user_id or "").strip()
    if not user_id:
        return False
    try:
        import psycopg
    except ImportError:
        return False
    try:
        with psycopg.connect(database_url()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT skill_name, description, body_markdown
                    FROM user_skill_files
                    WHERE user_id = %s
                    ORDER BY skill_name ASC
                    """,
                    (user_id,),
                )
                rows = cur.fetchall()
                cur.execute(
                    """
                    SELECT skill_name, path, content
                    FROM user_skill_package_files
                    WHERE user_id = %s
                    ORDER BY skill_name ASC, path ASC
                    """,
                    (user_id,),
                )
                file_rows = cur.fetchall()
    except Exception:  # noqa: BLE001
        return False
    files_by: dict[str, dict[str, str]] = {}
    for skill_name, path, content in file_rows:
        n = str(skill_name or "").strip()
        p = str(path or "").strip().replace("\\", "/")
        if not n or not p:
            continue
        files_by.setdefault(n, {})[p] = str(content or "")
    for name, desc, body in rows:
        n = str(name or "").strip()
        d = str(desc or "").strip()
        raw = str(body or "")
        if not n:
            continue
        if not d:
            meta, _ = _parse_frontmatter(raw)
            d = (meta.get("description") or n).strip()
        pkg = dict(files_by.get(n) or {})
        if "SKILL.md" not in pkg and raw:
            pkg["SKILL.md"] = raw
        into[n] = SkillMeta(
            name=n,
            description=d or n,
            path=None,
            custom=True,
            body_markdown=pkg.get("SKILL.md", raw),
            source="db",
            files=pkg,
        )
    return True


# Catalog line descriptions are capped; full body via load_skill.
# Keep enough trigger keywords for discovery; find-skills covers deep search.
CATALOG_DESC_MAX = 120
# Upper bound for an ``inline: true`` skill body injected into the system prompt.
INLINE_BODY_MAX = 12000


class SkillRegistry:
    def __init__(self, root: Path | None = None, user_id: str | None = None) -> None:
        self.root = root or default_skills_root()
        self.user_id = (user_id or "").strip() or None
        self._by_name: dict[str, SkillMeta] = {}
        self.reload()

    def reload(self) -> None:
        self._by_name.clear()
        loaded_pg = _load_global_from_pg(self._by_name)
        _load_dir(self.root, custom=False, into=self._by_name, skip_existing=loaded_pg)
        if self.user_id:
            # Custom user skills: Postgres only (no skills/users/ disk fallback).
            _load_user_from_pg(self.user_id, self._by_name)

    def list_meta(self) -> list[SkillMeta]:
        return list(self._by_name.values())

    def catalog_for_prompt(self, enabled: set[str] | list[str] | None = None) -> str:
        items = self.list_meta()
        if enabled is not None:
            allow = set(enabled)
            items = [s for s in items if s.name in allow]
        if not items:
            return "（当前未发现可用技能）"
        # Catalog is name+short desc only; full body via load_skill. Cap desc to curb prompt bloat.
        lines = []
        max_desc = CATALOG_DESC_MAX
        for s in items:
            desc = (s.description or "").strip()
            if len(desc) > max_desc:
                desc = desc[: max_desc - 3].rstrip() + "…"
            lines.append(f"- {s.name}: {desc}")
        catalog = "\n".join(lines)
        inline = self._inline_bodies(items)
        return f"{catalog}\n\n{inline}" if inline else catalog

    def _inline_bodies(self, items: list[SkillMeta]) -> str:
        """Bodies of enabled skills whose frontmatter sets ``inline: true``.

        The catalog normally carries only name + short description and the model
        fetches the body with load_skill. That never happens when tools are off
        (org/connection enable_tools=false), and even with tools on, output-format
        skills (e.g. generative-ui: the OpenUI Lang grammar + component signatures
        the client renders) are useless if the model guesses the syntax instead of
        loading them. ``inline: true`` puts the body straight into the prompt.
        Keep such skills short; the body is capped at INLINE_BODY_MAX chars.
        """
        blocks: list[str] = []
        for meta in items:
            full = self.load(meta.name)
            if not full:
                continue
            fm, _ = _parse_frontmatter(full.raw)
            if str(fm.get("inline") or "").strip().lower() not in ("true", "1", "yes"):
                continue
            body = full.body.strip()
            if not body:
                continue
            if len(body) > INLINE_BODY_MAX:
                body = body[:INLINE_BODY_MAX].rstrip() + "\n…（已截断）"
            blocks.append(f"## 已内联技能：{meta.name}（无需 load_skill，按下文规则直接输出）\n\n{body}")
        return "\n\n".join(blocks)

    def filter_meta(self, enabled: set[str] | list[str] | None) -> list[SkillMeta]:
        items = self.list_meta()
        if enabled is None:
            return items
        allow = set(enabled)
        return [s for s in items if s.name in allow]

    def _resolve(self, name: str) -> SkillMeta | None:
        meta = self._by_name.get(name)
        if meta:
            return meta
        for m in self._by_name.values():
            if m.path is not None and m.path.parent.name == name:
                return m
        return None

    def file_paths(self, name: str) -> list[str]:
        meta = self._resolve(name)
        if not meta:
            return []
        paths = sorted(meta.files.keys()) if meta.files else []
        if "SKILL.md" not in paths and (meta.body_markdown or meta.path):
            paths = ["SKILL.md", *[p for p in paths if p != "SKILL.md"]]
        return paths

    def read_file(self, name: str, path: str) -> str | None:
        meta = self._resolve(name)
        if not meta:
            return None
        path = (path or "").strip().replace("\\", "/")
        if not path or not _valid_rel_path(path):
            return None
        if path in meta.files:
            return meta.files[path]
        if path == "SKILL.md":
            if meta.body_markdown is not None:
                return meta.body_markdown
            if meta.path is not None:
                try:
                    return meta.path.read_text(encoding="utf-8")
                except OSError:
                    return None
        # Disk fallback for packages loaded without full walk
        if meta.path is not None:
            candidate = meta.path.parent / Path(*path.split("/"))
            try:
                candidate = candidate.resolve()
                root = meta.path.parent.resolve()
                if root not in candidate.parents and candidate != root:
                    return None
                if not str(candidate).startswith(str(root)):
                    return None
                return candidate.read_text(encoding="utf-8")
            except OSError:
                return None
        return None

    def load(self, name: str) -> SkillFull | None:
        meta = self._resolve(name)
        if not meta:
            return None
        raw = meta.body_markdown
        if raw is None and meta.path is not None:
            try:
                raw = meta.path.read_text(encoding="utf-8")
            except OSError:
                return None
        if raw is None:
            raw = meta.files.get("SKILL.md")
        if raw is None:
            return None
        _, body = _parse_frontmatter(raw)
        return SkillFull(
            name=meta.name,
            description=meta.description,
            path=meta.path,
            custom=meta.custom,
            body_markdown=raw,
            source=meta.source,
            files=dict(meta.files) if meta.files else {"SKILL.md": raw},
            body=body,
            raw=raw,
        )


def registry_for_user(user_id: str | None = None, root: Path | None = None) -> SkillRegistry:
    return SkillRegistry(root=root, user_id=user_id)
