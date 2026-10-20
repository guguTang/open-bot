"""inline: true skills are injected into the prompt (works with tools off)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.llm import build_system_prompt  # noqa: E402
from app.skills import INLINE_BODY_MAX, SkillMeta, SkillRegistry  # noqa: E402

REPO = ROOT.parents[1]


def _reg(metas: list[SkillMeta]) -> SkillRegistry:
    reg = SkillRegistry.__new__(SkillRegistry)
    reg.root = Path("/tmp")
    reg.user_id = None
    reg._by_name = {m.name: m for m in metas}
    return reg


def _meta(name: str, raw: str) -> SkillMeta:
    return SkillMeta(name=name, description=f"{name} desc", path=None, body_markdown=raw, files={"SKILL.md": raw})


def test_inline_body_injected_only_when_flagged_and_enabled() -> None:
    reg = _reg(
        [
            _meta("ui", "---\nname: ui\ndescription: d\ninline: true\n---\nUSE root = Card(...)"),
            _meta("plain", "---\nname: plain\ndescription: d\n---\nSECRET BODY"),
        ]
    )
    cat = reg.catalog_for_prompt()
    assert "USE root = Card(...)" in cat
    assert "SECRET BODY" not in cat
    assert "- plain: plain desc" in cat
    assert "USE root" not in reg.catalog_for_prompt({"plain"})


def test_inline_reaches_prompt_with_tools_off() -> None:
    reg = _reg([_meta("ui", "---\nname: ui\ndescription: d\ninline: true\n---\nOPENUI GRAMMAR")])
    prompt = build_system_prompt(
        agent_id="a", skills_catalog=reg.catalog_for_prompt({"ui"}), memory_snippets=[], tools_enabled=False
    )
    assert "OPENUI GRAMMAR" in prompt


def test_inline_body_is_capped() -> None:
    reg = _reg([_meta("big", "---\nname: big\ndescription: d\ninline: true\n---\n" + "x" * (INLINE_BODY_MAX + 500))])
    cat = reg.catalog_for_prompt()
    assert "已截断" in cat
    assert len(cat) < INLINE_BODY_MAX + 400


def test_generative_ui_skill_is_inline() -> None:
    raw = (REPO / "skills/generative-ui/SKILL.md").read_text(encoding="utf-8")
    reg = _reg([_meta("generative-ui", raw)])
    cat = reg.catalog_for_prompt({"generative-ui"})
    assert "Component Signatures" in cat
    assert "openui-lang" in cat
