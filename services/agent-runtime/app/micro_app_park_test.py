"""Unit tests for micro-app tool-loop park/resume store."""

from __future__ import annotations

import asyncio

import pytest

from . import micro_app_park as park


@pytest.mark.asyncio
async def test_park_resolve_allow():
    park.clear_all()
    await park.create_park(
        req_id="mag-test-1",
        micro_app_id="app1",
        tool="host_shell",
        capability="host.shell.run",
        conversation_id="c1",
        request_id="r1",
    )

    async def _resolve_later():
        await asyncio.sleep(0.05)
        return await park.resolve("mag-test-1", "allow_once")

    resolve_task = asyncio.create_task(_resolve_later())
    decision = await park.await_decision("mag-test-1", timeout_sec=2.0)
    out = await resolve_task
    assert decision == "allow_once"
    assert out.get("park_resolved") is True
    park.clear_all()


@pytest.mark.asyncio
async def test_park_resolve_missing():
    park.clear_all()
    out = await park.resolve("mag-missing", "deny")
    assert out.get("park_resolved") is False
    assert out.get("reason") == "not_parked"


@pytest.mark.asyncio
async def test_park_alias():
    park.clear_all()
    await park.create_park(
        req_id="mag-canon",
        micro_app_id="app1",
        tool="host_read",
        capability="host.fs.read",
    )
    assert await park.alias_to("mag-alias", "mag-canon") is True

    async def _resolve_later():
        await asyncio.sleep(0.05)
        return await park.resolve("mag-alias", "always_allow")

    t = asyncio.create_task(_resolve_later())
    decision = await park.await_decision("mag-canon", timeout_sec=2.0)
    await t
    assert decision == "always_allow"
    park.clear_all()
