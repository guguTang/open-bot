"""Local Dream-equivalent memory consolidation (OSS path).

Mem0 Platform / Dream is a hosted product. This module provides a local
consolidation job that (default on):
  1) lists recent Mem0 facts (when Mem0 OSS is enabled) and/or MemoryStore notes
  2) asks the chat LLM to distill a durable profile summary
  3) upserts it into MemoryStore as tier=profile tag=dream

Default: MEM0_DREAM_ENABLED truthy (same pattern as MEM0_ENABLED). Set
MEM0_DREAM_ENABLED=0 to disable. Optional MEM0_DREAM_INTERVAL_SECONDS controls
per-user auto rate limit after chat (default 3600). Prefer Mem0 Platform when
MEM0_PLATFORM_API_KEY / MEM0_API_KEY is set and MEM0_PLATFORM_DREAM=1 (Platform
mode is opt-in; OSS runtime does not call hosted Dream API yet).

Honesty: this is NOT Mem0 Platform Dream; it is an OSS-compatible substitute.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from . import mem0_store
from .llm import openai_config
from .memory import get_store

logger = logging.getLogger("open-bot.dream")

_rate_lock = threading.Lock()
# user_id -> monotonic timestamp of last successful/attempted consolidate start
_last_run_mono: dict[str, float] = {}
_in_flight: set[str] = set()


def _truthy(name: str, default: str = "0") -> bool:
    """Match MEM0_ENABLED / mem0_store._env_truthy semantics."""
    raw = os.getenv(name)
    if raw is None:
        raw = default
    raw = (raw or default).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def platform_dream_available() -> bool:
    key = (os.getenv("MEM0_PLATFORM_API_KEY") or os.getenv("MEM0_API_KEY") or "").strip()
    return bool(key) and _truthy("MEM0_PLATFORM_DREAM", "0")


def local_dream_enabled() -> bool:
    """Local Dream on by default (MEM0_DREAM_ENABLED default 1)."""
    return _truthy("MEM0_DREAM_ENABLED", "1")


def dream_interval_seconds() -> int:
    """Min seconds between auto consolidations per user (chat path)."""
    raw = (os.getenv("MEM0_DREAM_INTERVAL_SECONDS") or "3600").strip()
    try:
        return max(60, min(int(raw), 86400 * 7))
    except ValueError:
        return 3600


def dream_mode() -> str:
    """Return platform | local | off."""
    if platform_dream_available():
        return "platform"
    if local_dream_enabled():
        return "local"
    return "off"


def status() -> dict[str, Any]:
    return {
        "dream_mode": dream_mode(),
        "mem0_wanted": mem0_store.mem0_wanted(),
        "platform_available": platform_dream_available(),
        "local_enabled": local_dream_enabled(),
        "interval_seconds": dream_interval_seconds(),
        "note": (
            "Local Dream defaults on (MEM0_DREAM_ENABLED=1); set 0 to disable. "
            "Auto-runs after chat with MEM0_DREAM_INTERVAL_SECONDS rate limit. "
            "Platform Dream requires MEM0_PLATFORM_API_KEY + MEM0_PLATFORM_DREAM=1 "
            "(opt-in; OSS runtime does not call hosted Dream API yet)."
        ),
    }


def _llm_summarize(facts: list[str], *, user_id: str = "") -> str:
    api_key, base, model = openai_config(None)
    if not api_key and not base:
        raise RuntimeError("OPENAI_* not configured")
    bullet = "\n".join(f"- {f}" for f in facts[:80])
    messages = [
        {
            "role": "system",
            "content": (
                "你是记忆整理助手。根据事实列表，写出简洁、稳定的用户画像摘要（中文优先）。"
                "只保留长期有用信息；去掉一次性闲聊。输出纯文本，分短段落，不超过 800 字。"
            ),
        },
        {
            "role": "user",
            "content": f"请整理以下记忆事实为 durable profile：\n{bullet}",
        },
    ]
    url = f"{base.rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"model": model, "stream": False, "messages": messages, "max_tokens": 900}
    with httpx.Client(timeout=90.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()
    from .usage_meter import record_text_call

    record_text_call(
        call_kind_name="dream",
        model=model,
        base_url=base,
        messages=messages,
        output_text=str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""),
        raw_usage=data.get("usage") if isinstance(data, dict) else None,
        actor={"user_id": user_id},
    )
    choices = data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message") or {}
    return str(msg.get("content") or "").strip()


def consolidate_user(user_id: str, *, max_facts: int = 60) -> dict[str, Any]:
    """Run one consolidation for a user. Returns status dict."""
    uid = (user_id or "").strip()
    if not uid:
        return {"ok": False, "error": "user_id required"}

    mode = dream_mode()
    if mode == "off":
        return {"ok": False, "error": "dream disabled", "status": status()}

    if mode == "platform":
        return {
            "ok": False,
            "error": (
                "Mem0 Platform Dream configured but open-bot OSS runtime does not call "
                "hosted Dream API yet; set MEM0_PLATFORM_DREAM=0 to use local consolidation "
                "or run Dream in the Mem0 Platform console."
            ),
            "status": status(),
        }

    facts: list[str] = []
    listed = mem0_store.list_for_user(uid, limit=max_facts)
    for item in listed.get("memories") or []:
        text = str(item.get("content") or "").strip()
        if text:
            facts.append(text)
        if len(facts) >= max_facts:
            break

    if len(facts) < max_facts:
        store = get_store(uid)
        try:
            legacy = store.list(limit=max_facts)
        except Exception:  # noqa: BLE001
            legacy = []
        for row in legacy or []:
            content = ""
            tier = ""
            if hasattr(row, "content"):
                content = str(getattr(row, "content") or "").strip()
                tier = str(getattr(row, "tier") or "")
            elif isinstance(row, dict):
                content = str(row.get("content") or "").strip()
                tier = str(row.get("tier") or "")
            if not content or tier == "profile":
                continue
            facts.append(content)
            if len(facts) >= max_facts:
                break

    # dedupe
    seen: set[str] = set()
    uniq: list[str] = []
    for f in facts:
        key = " ".join(f.lower().split())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(f)
    facts = uniq

    if not facts:
        return {"ok": False, "error": "no facts to consolidate", "user_id": uid}

    try:
        summary = _llm_summarize(facts, user_id=uid)
    except Exception as e:  # noqa: BLE001
        logger.warning("dream LLM failed user=%s: %s", uid, e)
        return {"ok": False, "error": f"llm failed: {e}", "user_id": uid}

    if not summary:
        return {"ok": False, "error": "empty summary", "user_id": uid}

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    content = f"[dream:{stamp}] {summary}"
    store = get_store(uid)
    try:
        item = store.upsert_tagged(content, tag="dream", tier="profile", scope="user")
        mid = getattr(item, "id", "") or ""
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"memory write failed: {e}", "user_id": uid}

    return {
        "ok": True,
        "mode": "local",
        "user_id": uid,
        "facts_used": len(facts),
        "memory_id": mid,
        "summary_chars": len(summary),
    }


def _should_auto_run(uid: str) -> bool:
    """Rate-limit + single-flight gate. Caller must hold _rate_lock when mutating."""
    if dream_mode() != "local":
        return False
    if uid in _in_flight:
        return False
    now = time.monotonic()
    last = _last_run_mono.get(uid)
    if last is not None and (now - last) < float(dream_interval_seconds()):
        return False
    return True


def maybe_consolidate_user_bg(user_id: str) -> bool:
    """Fire-and-forget local Dream after chat if enabled and past interval.

    Returns True if a background job was started.
    """
    uid = (user_id or "").strip()
    if not uid:
        return False
    with _rate_lock:
        if not _should_auto_run(uid):
            return False
        _in_flight.add(uid)
        _last_run_mono[uid] = time.monotonic()

    def _run() -> None:
        try:
            result = consolidate_user(uid)
            if result.get("ok"):
                logger.info(
                    "dream auto ok user=%s facts=%s chars=%s",
                    uid,
                    result.get("facts_used"),
                    result.get("summary_chars"),
                )
            else:
                logger.debug(
                    "dream auto skip/fail user=%s: %s",
                    uid,
                    result.get("error"),
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("dream auto failed user=%s: %s", uid, e)
        finally:
            with _rate_lock:
                _in_flight.discard(uid)

    t = threading.Thread(target=_run, name=f"dream-consolidate-{uid[:8]}", daemon=True)
    t.start()
    return True


def reset_rate_limits_for_tests() -> None:
    """Clear in-memory rate state (tests only)."""
    with _rate_lock:
        _last_run_mono.clear()
        _in_flight.clear()


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Local Dream consolidation (ops / one-shot)")
    ap.add_argument("--user-id", required=True)
    ap.add_argument("--max-facts", type=int, default=60)
    args = ap.parse_args(argv)
    # Allow one-shot CLI even if env flag off
    os.environ.setdefault("MEM0_DREAM_ENABLED", "1")
    result = consolidate_user(args.user_id, max_facts=args.max_facts)
    print(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
