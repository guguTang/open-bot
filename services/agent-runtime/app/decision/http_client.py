"""HTTP System One client shared by hosted Jev, remote Laya, Unsloth, and custom."""

from __future__ import annotations

from typing import Any

import httpx

from .protocol import DecisionError, DecisionResult, normalize_questions, parse_result

JEV_DEFAULT_BASE = "https://api.typesafe.ai"
JEV_DEFAULT_MODEL = "jev-latest"
UNSLOTH_DEFAULT_BASE = "http://localhost:8888"
UNSLOTH_DEFAULT_MODEL = "laya"


class SystemOneHTTPClient:
    def __init__(
        self,
        provider: str,
        base_url: str,
        api_key: str,
        model: str,
        *,
        timeout: float = 30,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.provider = provider
        self.enabled = True
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip()
        self.model = model.strip()
        self.timeout = timeout
        self._transport = transport

    def decide(self, state: Any, questions: dict[str, Any]) -> DecisionResult:
        if self.provider == "jev" and not self.api_key:
            raise DecisionError("Jev 需要 API key")
        if not self.base_url:
            raise DecisionError("决策服务缺少 base_url")
        if not self.model:
            raise DecisionError("决策服务缺少 model")
        body = {
            "state": state,
            "model": self.model,
            "questions": normalize_questions(questions),
        }
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.base_url}/v1/systemone"
        try:
            with httpx.Client(timeout=self.timeout, transport=self._transport) as client:
                resp = client.post(url, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise DecisionError(f"决策服务不可达: {exc}") from exc
        if resp.status_code >= 400:
            detail = resp.text.strip().replace("\n", " ")[:300]
            raise DecisionError(f"决策服务返回 {resp.status_code}: {detail}")
        try:
            payload = resp.json()
        except ValueError as exc:
            raise DecisionError("决策服务返回了无法解析的 JSON") from exc
        if not isinstance(payload, dict):
            raise DecisionError("决策服务返回了无法解析的 JSON")
        return parse_result(self.provider, payload, fallback_model=self.model)
