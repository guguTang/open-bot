"""OpenAI-compatible embedding client (bge-m3 etc.)."""

from __future__ import annotations

import os
from typing import Any

import httpx

# Defaults aligned with enigma config_34 (30603 currently serves bge-m3; 30606 is alternate).
DEFAULT_BASE_URL = "http://192.168.5.34:30603/v1"
DEFAULT_MODEL = "bge-m3"
DEFAULT_DIM = 1024


def embedding_config() -> tuple[str, str, str, int]:
    base = (os.getenv("EMBEDDING_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")
    key = (os.getenv("EMBEDDING_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    model = (os.getenv("EMBEDDING_MODEL") or DEFAULT_MODEL).strip()
    try:
        dim = int((os.getenv("EMBEDDING_DIM") or str(DEFAULT_DIM)).strip())
    except ValueError:
        dim = DEFAULT_DIM
    return base, key, model, dim


def embed_texts(texts: list[str], *, timeout: float = 30.0) -> list[list[float]] | None:
    texts = [t for t in texts if (t or "").strip()]
    if not texts:
        return []
    base, key, model, _dim = embedding_config()
    if not base:
        return None
    url = f"{base}/embeddings"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    payload: dict[str, Any] = {"model": model, "input": texts if len(texts) > 1 else texts[0]}
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        from .usage_meter import record_text_call

        record_text_call(
            call_kind_name="embedding",
            model=model,
            base_url=base,
            input_text="\n".join(texts),
            raw_usage=data.get("usage") if isinstance(data, dict) else None,
        )
        rows = data.get("data") or []
        rows = sorted(rows, key=lambda r: int(r.get("index", 0)))
        out = [list(map(float, r.get("embedding") or [])) for r in rows]
        if len(out) != len(texts) or any(len(v) == 0 for v in out):
            return None
        return out
    except Exception:  # noqa: BLE001
        return None


def embed_one(text: str) -> list[float] | None:
    res = embed_texts([text])
    if not res:
        return None
    return res[0]


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"
