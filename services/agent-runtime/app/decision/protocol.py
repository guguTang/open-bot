"""Shared decision types. No vendor imports."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DecisionError(Exception):
    """The configured provider failed or the question payload is invalid."""


class DecisionDisabled(DecisionError):
    """The org has the decision layer turned off."""


class DecisionSettings(BaseModel):
    provider: str = "off"
    base_url: str = ""
    api_key: str = ""
    model: str = ""


class DecisionResult(BaseModel):
    provider: str
    model: str = ""
    answers: dict[str, Any] = Field(default_factory=dict)
    usage: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "provider": self.provider,
            "model": self.model,
            "answers": self.answers,
            "usage": self.usage,
        }


def normalize_provider(provider: str | None) -> str:
    value = (provider or "").strip().lower()
    if value in {"jev", "laya", "unsloth", "custom"}:
        return value
    return "off"


def normalize_questions(questions: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(questions, dict) or not questions:
        raise DecisionError("questions 不能为空")
    out: dict[str, Any] = {}
    for key, raw in questions.items():
        if not isinstance(raw, dict):
            raise DecisionError(f"{key} 不是对象")
        kind = raw.get("type")
        if kind not in {"noul", "choice", "score"}:
            raise DecisionError(f"{key} 的 type 必须是 noul、choice 或 score")
        instructions = raw.get("instructions")
        if instructions is None or instructions == "":
            raise DecisionError(f"{key} 缺少 instructions")
        item: dict[str, Any] = {"type": kind, "instructions": instructions}
        criteria = raw.get("criteria")
        if kind == "choice":
            if not isinstance(criteria, dict) or not criteria:
                raise DecisionError(f"{key} 的 choice 需要 criteria 对象")
            if len(criteria) > 255:
                raise DecisionError(f"{key} 的 choice 最多 255 个选项")
            item["criteria"] = criteria
        elif kind == "score":
            if not isinstance(criteria, list) or len(criteria) < 2 or len(criteria) > 10:
                raise DecisionError(f"{key} 的 score 需要 2 到 10 级 criteria")
            item["criteria"] = criteria
        elif criteria is not None:
            item["criteria"] = criteria
        out[str(key)] = item
    return out


def parse_result(provider: str, payload: dict[str, Any], *, fallback_model: str = "") -> DecisionResult:
    raw_answers = payload.get("answers")
    if not isinstance(raw_answers, dict) or not raw_answers:
        raise DecisionError("决策服务没有返回 answers")
    answers: dict[str, Any] = {}
    for key, raw in raw_answers.items():
        if not isinstance(raw, dict):
            raise DecisionError(f"{key} 的答案格式无法识别")
        answers[str(key)] = _parse_answer(str(key), raw)
    model = str(payload.get("model") or fallback_model or "")
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else None
    return DecisionResult(provider=provider, model=model, answers=answers, usage=usage)


def _parse_answer(key: str, raw: dict[str, Any]) -> dict[str, Any]:
    kind = raw.get("type")
    if kind not in {"noul", "choice", "score"}:
        if "noul" in raw:
            kind = "noul"
        elif "choice" in raw:
            kind = "choice"
        elif "score" in raw:
            kind = "score"
        else:
            raise DecisionError(f"{key} 的答案缺少 type")
    if kind == "noul":
        return {"type": "noul", "noul": _as_float(raw.get("noul"))}
    if kind == "choice":
        return {
            "type": "choice",
            "choice": str(raw.get("choice") or ""),
            "probabilities": raw.get("probabilities") if isinstance(raw.get("probabilities"), dict) else {},
            "confidence": _optional_float(raw.get("confidence")),
        }
    return {
        "type": "score",
        "score": _as_float(raw.get("score")),
        "probabilities": raw.get("probabilities"),
        "confidence": _optional_float(raw.get("confidence")),
        "legend": raw.get("legend"),
    }


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise DecisionError("答案里的数值无法解析") from exc


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    return _as_float(value)
