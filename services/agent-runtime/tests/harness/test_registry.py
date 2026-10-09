"""Extension registry smoke tests."""

from __future__ import annotations

import pytest

from app.harness.registry import ExtensionRegistry


@pytest.mark.asyncio
async def test_hooks_and_sections():
    reg = ExtensionRegistry()
    seen: list[str] = []

    async def before(**kwargs):
        seen.append(kwargs.get("name") or "")

    reg.register_section("alpha", "Alpha section")
    reg.register_hook("beforeTool", "*", before)
    reg.select(["alpha"])
    assert "Alpha" in reg.sections_text()
    await reg.run_hooks("beforeTool", name="host_shell", args={})
    assert seen == ["host_shell"]
