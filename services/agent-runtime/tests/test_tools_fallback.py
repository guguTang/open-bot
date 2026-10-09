"""Unit tests for vLLM auto-tool-choice fallback (no pytest — runnable as script)."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.llm import (  # noqa: E402
    CHEAPER_HOST_RETRY,
    DEFAULT_TOOL_ROUNDS,
    TOOL_FAIL_NUDGE,
    TOOL_FAIL_NUDGE_CAP,
    AutoToolChoiceUnsupported,
    LLMOverride,
    guide_tool_result,
    is_auto_tool_choice_unsupported,
    is_context_length_error,
    run_tool_loop,
    tool_observation_failed,
    tool_result_fallback,
    truncate_tool_result_for_context,
)
from app.main import clamp_tool_rounds  # noqa: E402
from app.machines import HOST_EXEC_TIMEOUT_SEC  # noqa: E402


def _ok(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  OK  {msg}")


def test_detector() -> None:
    msg = (
        '"auto" tool choice requires --enable-auto-tool-choice '
        "and --tool-call-parser to be set"
    )
    _ok(is_auto_tool_choice_unsupported(msg), "vLLM classic auto tool choice 400")
    _ok(
        is_auto_tool_choice_unsupported(
            "upstream HTTP 400: enable_auto_tool_choice missing"
        ),
        "underscore form",
    )
    _ok(
        is_auto_tool_choice_unsupported("need --tool-call-parser hermes"),
        "tool-call-parser alone",
    )
    _ok(not is_auto_tool_choice_unsupported("model not found"), "unrelated error")
    _ok(not is_auto_tool_choice_unsupported(""), "empty")


async def test_run_tool_loop_fallback() -> None:
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)

    calls: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls.append({"tools": tools, "tool_choice": tool_choice})
        if tools:
            raise AutoToolChoiceUnsupported(
                'upstream HTTP 400: "auto" tool choice requires '
                "--enable-auto-tool-choice and --tool-call-parser to be set"
            )
        return {
            "choices": [
                {"message": {"role": "assistant", "content": "你好，这是无 tools 回退答案"}}
            ],
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
        }

    async def on_status(payload: dict[str, Any]) -> None:
        statuses.append(payload)

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        raise AssertionError(f"tools should not run, got {name}")

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://192.168.5.34:30632/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, usage = await run_tool_loop(
                [{"role": "user", "content": "hi"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                override=LLMOverride(enable_tools=True),
                on_status=on_status,
            )

    _ok(len(calls) == 2, f"two chat_completion calls (got {len(calls)})")
    _ok(calls[0]["tools"] is not None, "first call sent tools")
    _ok(calls[1]["tools"] is None, "retry without tools")
    _ok(final == "你好，这是无 tools 回退答案", f"fallback text (got {final!r})")
    _ok(used == [], f"no tools used (got {used})")
    _ok(
        any(s.get("reason") == "auto_tool_choice_unsupported" for s in statuses),
        f"status note emitted (got {statuses})",
    )
    _ok(usage is not None and usage.get("total_tokens") == 8, f"usage accrued ({usage})")


async def test_run_tool_loop_markup_after_fallback() -> None:
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    calls: list[dict[str, Any]] = []
    ran: list[str] = []
    n = {"i": 0}

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls.append({"tools": tools, "tool_choice": tool_choice})
        if tools:
            raise AutoToolChoiceUnsupported(
                'upstream HTTP 400: "auto" tool choice requires --enable-auto-tool-choice'
            )
        n["i"] += 1
        if n["i"] == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": (
                                "<tool_call>\n"
                                "<function=list_machines>\n"
                                "</function>\n"
                                "</tool_call>"
                            ),
                        }
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
            }
        return {
            "choices": [{"message": {"role": "assistant", "content": "目前没有已连接电脑"}}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 5, "total_tokens": 9},
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        ran.append(name)
        return '{"machines":[],"count":0}'

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://192.168.5.34:30632/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "我的设备有哪些"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                override=LLMOverride(enable_tools=True),
            )

    _ok(ran == ["list_machines"], f"markup tool ran (got {ran})")
    _ok(used == ["list_machines"], f"used recorded (got {used})")
    _ok(final == "目前没有已连接电脑", f"final text (got {final!r})")
    _ok(calls[0]["tools"] is not None and calls[1]["tools"] is None, "fallback then markup")


async def test_tool_timeout_reasoning_only_is_visible() -> None:
    """A timed-out tool plus think-only follow-ups nudges, then shows a timeout reply."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    calls = {"n": 0}
    nudges = {"n": 0}

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "host_shell",
                                        "arguments": '{"command":"find ~/Downloads -exec stat {} \\;"}',
                                    },
                                }
                            ],
                        }
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
            }
        if any(m.get("content") == TOOL_FAIL_NUDGE for m in messages if m.get("role") == "user"):
            nudges["n"] += 1
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "<think>命令超时了，换更快的 find</think>",
                    }
                }
            ],
            "usage": {"prompt_tokens": 20, "completion_tokens": 12, "total_tokens": 32},
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        _ok(name == "host_shell", f"tool name {name}")
        return '{"ok": false, "error": "命令超过 30 秒还没结束"}'

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看最不常用的大文件"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=8,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell"], f"used {used}")
    _ok(final and "<think>" not in final, f"visible fallback (got {final!r})")
    _ok("超过时限" in final, f"timeout strategy text (got {final!r})")
    _ok(nudges["n"] == TOOL_FAIL_NUDGE_CAP, f"nudged {nudges['n']} times (cap {TOOL_FAIL_NUDGE_CAP})")
    _ok(
        calls["n"] == 1 + 1 + TOOL_FAIL_NUDGE_CAP,
        f"tool round + think + {TOOL_FAIL_NUDGE_CAP} nudges (got {calls['n']})",
    )



def test_host_waits_stay_above_desktop_shell() -> None:
    """Runtime HTTP must outlast API hostExecTimeout (150s), which outlasts desktop 120s."""
    _ok(HOST_EXEC_TIMEOUT_SEC > 150, f"runtime wait {HOST_EXEC_TIMEOUT_SEC} cuts before the API")


def test_guide_on_timeout_and_shell_error() -> None:
    timed = guide_tool_result("host_shell", '{"ok": false, "error": "命令超过 120 秒还没结束"}')
    _ok("不要重复同一条命令" in timed, "timeout says do not repeat")
    _ok("换一条命令再调用 host_shell" in timed, "timeout asks for a revised tool call")
    _ok("host_shell" in timed, "timeout keeps file lookup on host_shell")
    _ok("-exec stat" in timed, "timeout forbids per-file stat")
    _ok("字面量 $" in timed, "timeout warns about literal $")
    failed = guide_tool_result("host_shell", '{"ok": false, "error": "启动失败"}')
    _ok(CHEAPER_HOST_RETRY in failed, "shell error gets the same guidance")
    ok = guide_tool_result("host_shell", '{"ok": true, "output": "a"}')
    _ok("不要重复" not in ok, "success is unchanged")
    denied = guide_tool_result("host_shell", '{"ok": false, "denied": true, "error": "用户拒绝了这次操作"}')
    offline = guide_tool_result("host_shell", '{"ok": false, "error": "应用没开着"}')
    ls = guide_tool_result("host_ls", '{"ok": false, "error": "没有在时限内完成或确认这次操作"}')
    _ok("不要重复同一条命令" in ls, "host timeout other than shell still guides")
    other = guide_tool_result("sandbox_shell", '{"ok": false, "error": "timeout"}')
    bad_find = guide_tool_result(
        "host_shell",
        json.dumps(
            {
                "ok": True,
                "exit_code": 0,
                "command": "find ~/Downloads -name $",
                "output": "find: $: unknown primary or operator\n",
            },
            ensure_ascii=False,
        ),
    )
    _ok(CHEAPER_HOST_RETRY in bad_find, "useless find stdout is guided")
    _ok('"ok": false' in bad_find.lower() or '"ok":false' in bad_find.replace(" ", "").lower(), "marks observation failed")
    _ok("unknown primary" in bad_find, "keeps the find error in the observation")


def _shell_call(call_id: str, command: str) -> dict[str, Any]:
    return {
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": "host_shell",
                                "arguments": '{"command": ' + __import__('json').dumps(command) + '}',
                            },
                        }
                    ],
                }
            }
        ]
    }


async def test_timeout_allows_another_tool_round() -> None:
    """A timed-out host_shell is a result, not the end of the turn."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    seen: list[str] = []
    ran: list[str] = []

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        n = len(seen) + 1
        seen.append("tools" if tools else "plain")
        if n == 1:
            return _shell_call("call_slow", "find ~/Downloads -exec stat {} \\;")
        if n == 2:
            tool_body = next(m["content"] for m in reversed(messages) if m.get("role") == "tool")
            _ok("不要重复同一条命令" in tool_body, "model sees do-not-repeat")
            _ok("host_shell" in tool_body, "model sees host_shell file lookup hint")
            _ok("-exec stat" in tool_body, "model sees no per-file stat")
            _ok(tools is not None, "follow-up round still has tools")
            return _shell_call("call_cheap", "find ~/Downloads -type f -print")
        return {"choices": [{"message": {"role": "assistant", "content": "最大的是 a.mp4"}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        ran.append(str(args.get("command") or ""))
        if len(ran) == 1:
            return '{"ok": false, "error": "命令超过 120 秒还没结束"}'
        return '{"ok": true, "output": "a.mp4"}'

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看 Downloads 里最大的文件"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=4,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell", "host_shell"], f"second tool ran (got {used})")
    _ok(ran[1] == "find ~/Downloads -type f -print", f"cheaper command (got {ran})")
    _ok(final == "最大的是 a.mp4", f"turn finished after the retry (got {final!r})")
    _ok(seen == ["tools", "tools", "tools"], f"did not drop tools after timeout (got {seen})")


async def test_tool_exception_still_continues() -> None:
    """A Chinese stop-line after a host failure is unfinished until the nudge cap."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    calls = {"n": 0}

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            return _shell_call("call_err", "find ~/Downloads -exec stat {} \\;")
        tool_body = next(m["content"] for m in reversed(messages) if m.get("role") == "tool")
        _ok("boom" in tool_body and "不要重复同一条命令" in tool_body, "exception is a guided result")
        return {"choices": [{"message": {"role": "assistant", "content": "换个查法失败了，先停一下"}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        raise RuntimeError("boom")

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "查一下"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=4,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell"], f"used {used}")
    _ok(final == "换个查法失败了，先停一下", f"conclusion kept after the cap (got {final!r})")
    _ok(
        calls["n"] == 1 + 1 + TOOL_FAIL_NUDGE_CAP,
        f"tool round + conclusion + {TOOL_FAIL_NUDGE_CAP} nudges (got {calls['n']})",
    )



async def test_success_stdout_think_only_is_quoted() -> None:
    """A successful tool plus a think-only follow-up must show the stdout, not an apology."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    calls = {"n": 0}
    listing = "440M output.wav\n422M 择日飞升 第05集.ts\n"

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            return _shell_call("call_ok", "find ~/Downloads -name '*.ts' -o -name '*.mp4'")
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "<think>结果已经有了，整理成列表</think>",
                    }
                }
            ]
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        return json.dumps(
            {
                "ok": True,
                "exit_code": 0,
                "command": "find ~/Downloads -name '*.ts'",
                "output": "440M output.wav\n422M 择日飞升 第05集.ts\n",
            },
            ensure_ascii=False,
        )
    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看我电脑上有哪些视频文件"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=4,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell"], f"used {used}")
    _ok(final and "<think>" not in final, f"think stripped (got {final!r})")
    _ok("output.wav" in final and "择日飞升" in final, f"stdout quoted (got {final!r})")
    _ok("没能整理成可见回复" not in final, f"no apology (got {final!r})")
    _ok("更窄的命令" not in final, f"no narrower-retry on success (got {final!r})")
    _ok(calls["n"] == 2, f"no extra completion (got {calls['n']})")
    _ok(listing.splitlines()[0] in final, "first line kept")


def test_quote_success_failure_and_truncation() -> None:
    useless = tool_result_fallback(
        [
            {
                "role": "tool",
                "content": json.dumps(
                    {
                        "ok": True,
                        "exit_code": 0,
                        "command": "find ~/Downloads -name $",
                        "output": "find: $: unknown primary or operator\n",
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    )
    _ok("命令执行失败" in useless, f"useless find is a failure (got {useless!r})")
    _ok("unknown primary" in useless, f"shows the error (got {useless!r})")
    _ok("find ~/Downloads" in useless, f"shows the command (got {useless!r})")
    _ok("结果如下" not in useless and "更窄" not in useless and "没能整理" not in useless, f"not a dump/apology (got {useless!r})")
    _ok(tool_observation_failed({"ok": True, "output": "find: $: unknown primary or operator"}), "detector marks find $")

    empty = tool_result_fallback([{"role": "tool", "content": '{"ok": true, "output": ""}'}])
    _ok("没有可显示的输出" in empty and "更窄" not in empty, f"empty success (got {empty!r})")

    failed = tool_result_fallback(
        [
            {
                "role": "tool",
                "content": json.dumps(
                    {
                        "ok": False,
                        "error": "启动失败",
                        "command": "find ~",
                        "output": "partial",
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    )
    _ok("命令执行失败" in failed and "启动失败" in failed, f"short Chinese failure (got {failed!r})")
    _ok("更窄的命令" not in failed and "没能整理" not in failed, f"no old apology (got {failed!r})")
    _ok("`find ~`" in failed, f"includes command (got {failed!r})")

    timed = tool_result_fallback(
        [{"role": "tool", "content": '{"ok": false, "error": "命令超过 30 秒还没结束", "output": "half"}'}]
    )
    _ok("超过时限" in timed and "half" not in timed, f"timeout stays the strategy text (got {timed!r})")

    huge = "x" * 5000
    quoted = tool_result_fallback(
        [{"role": "tool", "content": '{"ok": true, "command": "find ~", "output": "' + huge + '"}'}]
    )
    _ok("输出过长，已截断" in quoted, f"huge stdout truncated (got len {len(quoted)})")
    _ok(len(quoted) < 4500, f"quote bounded (got {len(quoted)})")
    _ok("更窄" not in quoted, "truncation is not a retry hint")



async def test_useless_find_react_retry_succeeds() -> None:
    """Failed/useless host_shell is fed back; the model revises; success is used."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    ran: list[str] = []
    seen_bodies: list[str] = []

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        n = len(seen_bodies) + 1
        if n == 1:
            seen_bodies.append("first")
            return _shell_call("call_bad", "find ~/Downloads -name $ | head")
        if n == 2:
            tool_body = next(m["content"] for m in reversed(messages) if m.get("role") == "tool")
            seen_bodies.append(tool_body)
            _ok("unknown primary" in tool_body, "model sees the find error")
            _ok("不要重复同一条命令" in tool_body, "model sees revise note")
            _ok("字面量 $" in tool_body, "model sees no literal $")
            _ok("host_shell" in tool_body, "model sees host_shell file lookup hint")
            _ok(tools is not None, "follow-up still has tools")
            return _shell_call(
                "call_fix",
                "find ~/Downloads -type f -name '*.mp4' -o -name '*.ts' | head",
            )
        return {"choices": [{"message": {"role": "assistant", "content": "有 a.mp4 和 b.ts"}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        cmd = str(args.get("command") or "")
        ran.append(cmd)
        if "name $" in cmd:
            return json.dumps(
                {
                    "ok": True,
                    "exit_code": 0,
                    "command": cmd,
                    "output": "find: $: unknown primary or operator\n",
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "ok": True,
                "exit_code": 0,
                "command": cmd,
                "output": "a.mp4\nb.ts\n",
            },
            ensure_ascii=False,
        )

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看我电脑上有哪些视频文件"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=6,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell", "host_shell"], f"model chose a second command (got {used})")
    _ok(len(ran) == 2 and ran[0] != ran[1], f"commands differ (got {ran})")
    _ok("$" not in ran[1] or "name $" not in ran[1], f"revised command (got {ran[1]!r})")
    _ok(final == "有 a.mp4 和 b.ts", f"answer from successful retry (got {final!r})")


async def test_useless_find_think_only_nudges_then_fails() -> None:
    """Think-only after a useless find is nudged, then a short Chinese failure."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    calls = {"n": 0}
    ran: list[str] = []
    nudge_rounds = {"n": 0}

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            return _shell_call("call_bad", "find ~/Downloads -name $")
        if any(m.get("content") == TOOL_FAIL_NUDGE for m in messages if m.get("role") == "user"):
            nudge_rounds["n"] += 1
            _ok(tools is not None, "nudge round still has tools")
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "<think>find 报错了，不知道怎么改</think>",
                    }
                }
            ]
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        cmd = str(args.get("command") or "")
        ran.append(cmd)
        return json.dumps(
            {
                "ok": True,
                "exit_code": 0,
                "command": cmd,
                "output": "find: $: unknown primary or operator\n",
            },
            ensure_ascii=False,
        )

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看视频文件"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=8,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell"], f"only model-issued shells (got {used})")
    _ok(ran == ["find ~/Downloads -name $"], f"did not auto-rerun (got {ran})")
    _ok(nudge_rounds["n"] == TOOL_FAIL_NUDGE_CAP, f"nudged {nudge_rounds['n']}")
    _ok("命令执行失败" in final, f"short failure (got {final!r})")
    _ok("unknown primary" in final, f"includes error (got {final!r})")
    _ok("结果如下" not in final and "更窄" not in final, f"not dump/apology (got {final!r})")
    _ok("<think>" not in final, f"think stripped (got {final!r})")


async def test_success_after_retry_think_only_quotes_stdout() -> None:
    """After a revised command succeeds, think-only quotes that stdout."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    ran: list[str] = []

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        tool_count = sum(1 for m in messages if m.get("role") == "tool")
        if tool_count == 0:
            return _shell_call("call_bad", "find ~/Downloads -name $")
        if tool_count == 1:
            return _shell_call("call_ok", "find ~/Downloads -name '*.mp4' | head")
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "<think>列表已经有了</think>",
                    }
                }
            ]
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        cmd = str(args.get("command") or "")
        ran.append(cmd)
        if "name $" in cmd:
            return json.dumps(
                {
                    "ok": True,
                    "exit_code": 0,
                    "command": cmd,
                    "output": "find: $: unknown primary or operator\n",
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "ok": True,
                "exit_code": 0,
                "command": cmd,
                "output": "movie.mp4\nclip.ts\n",
            },
            ensure_ascii=False,
        )

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "视频呢"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=6,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell", "host_shell"], f"used {used}")
    _ok("movie.mp4" in final and "clip.ts" in final, f"quotes success (got {final!r})")
    _ok("命令执行失败" not in final, f"not a failure (got {final!r})")
    _ok("unknown primary" not in final, f"does not quote the failed obs (got {final!r})")


async def test_chinese_conclusion_nudges_without_rerun() -> None:
    """Stderr-only host failure + a short Chinese conclusion is not done.

    Qwen omits tool_choice, so the revise is a TOOL_FAIL_NUDGE, still capped,
    and the same shell is not executed again.
    """
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)
    calls = {"n": 0}
    choices: list[Any] = []
    nudges = {"n": 0}
    ran: list[str] = []
    conclusion = "查过了，没有匹配的视频。"

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        choices.append(tool_choice)
        if calls["n"] == 1:
            return _shell_call("call_bad", "find ~/Downloads -name $")
        if any(m.get("content") == TOOL_FAIL_NUDGE for m in messages if m.get("role") == "user"):
            nudges["n"] += 1
            _ok(tool_choice != "required", "qwen revise is not tool_choice=required")
        return {"choices": [{"message": {"role": "assistant", "content": conclusion}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        cmd = str(args.get("command") or "")
        ran.append(cmd)
        return json.dumps(
            {
                "ok": True,
                "exit_code": 0,
                "command": cmd,
                "stdout": "",
                "stderr": "find: $: unknown primary or operator\n",
            },
            ensure_ascii=False,
        )

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "Qwen3-32B-AWQ"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看视频文件"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=8,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell"], f"no auto rerun (got {used})")
    _ok(ran == ["find ~/Downloads -name $"], f"shell ran once (got {ran})")
    _ok(nudges["n"] == TOOL_FAIL_NUDGE_CAP, f"nudged {nudges['n']}")
    _ok("required" not in choices, f"no required choice (got {choices})")
    _ok(
        calls["n"] == 1 + 1 + TOOL_FAIL_NUDGE_CAP,
        f"capped extra rounds (got {calls['n']})",
    )
    _ok(final == conclusion, f"conclusion kept only after the cap (got {final!r})")


async def test_required_revise_lets_model_pick_next_command() -> None:
    """OpenAI-style profiles force tool_choice=required instead of a text nudge."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)
    choices: list[Any] = []
    ran: list[str] = []

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        choices.append(tool_choice)
        _ok(
            not any(m.get("content") == TOOL_FAIL_NUDGE for m in messages if m.get("role") == "user"),
            "required path does not also inject the text nudge",
        )
        if tool_choice == "required":
            _ok(tools is not None, "required round still has tools")
            return _shell_call("call_fix", "find ~/Downloads -name '*.mp4' | head")
        tool_count = sum(1 for m in messages if m.get("role") == "tool")
        if tool_count == 0:
            return _shell_call("call_bad", "find ~/Downloads -name $")
        return {"choices": [{"message": {"role": "assistant", "content": "有 a.mp4"}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        cmd = str(args.get("command") or "")
        ran.append(cmd)
        if "name $" in cmd:
            return json.dumps(
                {
                    "ok": True,
                    "exit_code": 0,
                    "command": cmd,
                    "output": "find: $: unknown primary or operator\n",
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {"ok": True, "exit_code": 0, "command": cmd, "output": "a.mp4\n"},
            ensure_ascii=False,
        )

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "gpt-4o"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看视频"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=6,
                override=LLMOverride(enable_tools=True),
            )

    _ok(choices[:3] == ["auto", "auto", "required"], f"required only on the revise (got {choices})")
    _ok(used == ["host_shell", "host_shell"], f"model issued the second call (got {used})")
    _ok(ran[0] != ran[1], f"commands differ (got {ran})")
    _ok(final == "有 a.mp4", f"finished after the model retry (got {final!r})")


async def test_required_revise_stops_at_cap() -> None:
    """tool_choice=required does not remove TOOL_FAIL_NUDGE_CAP."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)
    calls = {"n": 0}
    required = {"n": 0}
    ran: list[str] = []
    conclusion = "没有视频。"

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        if tool_choice == "required":
            required["n"] += 1
        if calls["n"] == 1:
            return _shell_call("call_bad", "find ~/Downloads -name $")
        return {"choices": [{"message": {"role": "assistant", "content": conclusion}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        ran.append(str(args.get("command") or ""))
        return json.dumps(
            {
                "ok": False,
                "command": args.get("command") or "",
                "error": "find: $: unknown primary or operator",
            },
            ensure_ascii=False,
        )

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", "gpt-4o"),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看视频"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=8,
                override=LLMOverride(enable_tools=True),
            )

    _ok(used == ["host_shell"], f"did not auto-rerun (got {used})")
    _ok(ran == ["find ~/Downloads -name $"], f"one shell (got {ran})")
    _ok(required["n"] == TOOL_FAIL_NUDGE_CAP, f"required rounds {required['n']}")
    _ok(calls["n"] == 1 + 1 + TOOL_FAIL_NUDGE_CAP, f"stopped at cap (got {calls['n']})")
    _ok(final == conclusion, f"text accepted only after cap (got {final!r})")


async def _finish_after(model: str, result: str, reply: str) -> tuple[str, list[str], list[Any], int]:
    choices: list[Any] = []
    ran: list[str] = []
    calls = {"n": 0}

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        choices.append(tool_choice)
        _ok(
            not any(m.get("content") == TOOL_FAIL_NUDGE for m in messages if m.get("role") == "user"),
            "denial/no-retry must not be nudged",
        )
        if calls["n"] == 1:
            return _shell_call("call_no", "find ~/Downloads -name '*.mp4'")
        return {"choices": [{"message": {"role": "assistant", "content": reply}}]}

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        ran.append(str(args.get("command") or ""))
        return result

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://127.0.0.1:9/v1", model),
        ):
            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "看看视频"}],
                api_key="sk-test",
                tool_handler=tool_handler,
                max_rounds=6,
                override=LLMOverride(enable_tools=True),
            )
    _ok(used == ["host_shell"], f"used {used}")
    return final, ran, choices, calls["n"]


async def test_denied_or_no_retry_is_not_nudged() -> None:
    """User denial and _NO_RETRY_HINT end the turn even on gpt-4o."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)
    denied = json.dumps(
        {"ok": False, "denied": True, "error": "用户拒绝了这次操作"},
        ensure_ascii=False,
    )
    final, ran, choices, n = await _finish_after("gpt-4o", denied, "好的，先不查了。")
    _ok(final == "好的，先不查了。", f"denial reply kept (got {final!r})")
    _ok(n == 2, f"no extra revise (got {n})")
    _ok(ran == ["find ~/Downloads -name '*.mp4'"], f"not rerun (got {ran})")
    _ok(choices == ["auto", "auto"], f"no required after denial (got {choices})")

    offline = json.dumps({"ok": False, "error": "应用没开着"}, ensure_ascii=False)
    final, ran, choices, n = await _finish_after("gpt-4o", offline, "桌面应用没开着。")
    _ok(final == "桌面应用没开着。", f"offline reply kept (got {final!r})")
    _ok(n == 2 and "required" not in choices, f"no nudge for no-retry hint (got {n} {choices})")
    _ok(len(ran) == 1, f"not rerun (got {ran})")


def test_host_file_skill_avoids_heredoc() -> None:
    import re

    skill = ROOT.parent.parent / "skills" / "host-file-query" / "SKILL.md"
    text = skill.read_text()
    blocks = re.findall(r"```(?:bash)?\n(.*?)```", text, re.S)
    _ok(blocks, "skill has an invocation example")
    _ok(all("<<" not in block for block in blocks), f"fenced examples are not heredoc (got {blocks!r})")
    _ok(any("bash -c" in block for block in blocks), "points at bash -c")
    _ok("host_shell" in text, "skill routes queries through host_shell")
    _ok("<<" in text and "不要" in text, "prose still warns that << confirms")
    _ok("bash -s" not in "\n".join(blocks), "recommended fence is not bash -s heredoc")



def test_truncate_tool_result_keeps_head_and_tail() -> None:
    small = "ok" * 10
    _ok(truncate_tool_result_for_context(small) == small, "short result unchanged")
    head = "H" * 100
    mid = "M" * 5000
    tail = "T" * 100
    huge = head + mid + tail
    out = truncate_tool_result_for_context(huge, limit=400, head=100, tail=100)
    _ok(out.startswith(head), "keeps head")
    _ok(out.endswith(tail), "keeps tail")
    _ok("truncated" in out and "chars" in out, f"notes omission (got {out[90:140]!r})")
    _ok("M" * 50 not in out or out.count("M") < 5000, "middle omitted")
    _ok(len(out) < len(huge), "shorter than original")


def test_context_length_detector() -> None:
    _ok(is_context_length_error("context_length_exceeded"), "openai code")
    _ok(is_context_length_error("Maximum context length exceeded"), "phrase")
    _ok(is_context_length_error("prompt is too long"), "prompt too long")
    _ok(not is_context_length_error("model not found"), "unrelated")
    _ok(not is_context_length_error(""), "empty")


def test_default_interactive_round_cap() -> None:
    _ok(DEFAULT_TOOL_ROUNDS == 24, f"interactive default is 24 (got {DEFAULT_TOOL_ROUNDS})")
    _ok(clamp_tool_rounds(None) == 24, "clamp None -> 24")
    _ok(clamp_tool_rounds(4) == 4, "explicit lower still allowed")
    _ok(clamp_tool_rounds(16) == 16, "background 16 kept")
    _ok(clamp_tool_rounds(32) == 32, "admin-raised 32 kept")
    _ok(clamp_tool_rounds(100) == 48, "hard ceiling")


async def test_context_overflow_compacts_and_retries() -> None:
    """Context-length failure compacts in-loop messages and retries once; no extra tool round."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)

    calls = {"n": 0}
    tool_runs: list[str] = []

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError(
                "upstream HTTP 400: context_length_exceeded: prompt is too long"
            )
        # After compact+retry: finish without tools.
        return {
            "choices": [
                {"message": {"role": "assistant", "content": "已根据压缩后的上下文作答。"}}
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14},
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        tool_runs.append(name)
        raise AssertionError("no tool should run for this overflow test")

    async def fake_compact(messages, **kwargs):
        # Shrink by dropping an early bulky tool observation.
        slim = [m for m in messages if not (m.get("role") == "tool" and len(str(m.get("content") or "")) > 100)]
        if len(slim) >= len(messages):
            slim = messages[:1] + [{"role": "system", "content": "摘要：先前工具输出已压缩"}] + messages[-2:]
        return slim, {"compacted": True, "compact_reason": "overflow_retry"}

    bulky = [{"role": "user", "content": "hi"}] + [
        {"role": "tool", "tool_call_id": "1", "content": "X" * 500}
    ]
    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://example/v1", "gpt-4o"),
        ):
            with patch("app.compact.compact_messages", new=AsyncMock(side_effect=fake_compact)):
                final, used, _usage = await run_tool_loop(
                    bulky,
                    api_key="sk-test",
                    tool_handler=tool_handler,
                    max_rounds=4,
                    override=LLMOverride(enable_tools=True),
                )
    _ok(final == "已根据压缩后的上下文作答。", f"final after retry (got {final!r})")
    _ok(calls["n"] == 2, f"one overflow + one retry (got {calls['n']})")
    _ok(tool_runs == [], f"did not re-run tools (got {tool_runs})")
    _ok(used == [], f"no tools used (got {used})")


async def test_round_cap_allows_twelve_tool_rounds() -> None:
    """Default interactive budget is high enough for a real lookup chain."""
    os.environ["OPENAI_ENABLE_TOOLS"] = "1"
    os.environ.pop("OPENAI_TOOL_CHOICE_AUTO", None)

    calls = {"n": 0}

    async def fake_chat(
        messages: list[dict[str, Any]],
        *,
        api_key: str,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict | None = None,
        override: LLMOverride | None = None,
    ) -> dict[str, Any]:
        calls["n"] += 1
        # Keep requesting a tool until the loop stops asking.
        if tools is not None:
            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": f"c{calls['n']}",
                                    "type": "function",
                                    "function": {
                                        "name": "calculator",
                                        "arguments": '{"expression":"1+1"}',
                                    },
                                }
                            ],
                        }
                    }
                ]
            }
        return {
            "choices": [{"message": {"role": "assistant", "content": "done"}}],
        }

    async def tool_handler(name: str, args: dict[str, Any]) -> str:
        return json.dumps({"ok": True, "output": "2"})

    with patch("app.llm.chat_completion", new=AsyncMock(side_effect=fake_chat)):
        with patch(
            "app.llm.openai_config",
            return_value=("sk-test", "http://example/v1", "gpt-4o"),
        ):
            # Prevent auto-defer from enqueueing when calculator rounds exhaust.
            async def no_defer(name: str, args: dict[str, Any]) -> str:
                if name == "defer_work":
                    return json.dumps({"ok": True, "id": "t1"})
                return await tool_handler(name, args)

            final, used, _usage = await run_tool_loop(
                [{"role": "user", "content": "算一下"}],
                api_key="sk-test",
                tool_handler=no_defer,
                max_rounds=DEFAULT_TOOL_ROUNDS,
                override=LLMOverride(enable_tools=True),
            )
    _ok(
        used.count("calculator") == DEFAULT_TOOL_ROUNDS,
        f"calculator ran for the full cap (got {used.count('calculator')})",
    )
    # Exhausted → defer_work handoff instead of a raw dump / apology.
    _ok(used[-1] == "defer_work", f"last tool is defer_work (got {used})")
    _ok("还在做" in (final or ""), f"confirms background handoff (final={final!r})")


def main() -> None:
    print("test_tools_fallback")
    test_detector()
    asyncio.run(test_run_tool_loop_fallback())
    asyncio.run(test_run_tool_loop_markup_after_fallback())
    asyncio.run(test_tool_timeout_reasoning_only_is_visible())
    asyncio.run(test_success_stdout_think_only_is_quoted())
    test_quote_success_failure_and_truncation()
    test_host_waits_stay_above_desktop_shell()
    test_guide_on_timeout_and_shell_error()
    asyncio.run(test_timeout_allows_another_tool_round())
    asyncio.run(test_tool_exception_still_continues())
    asyncio.run(test_useless_find_react_retry_succeeds())
    asyncio.run(test_useless_find_think_only_nudges_then_fails())
    asyncio.run(test_success_after_retry_think_only_quotes_stdout())
    asyncio.run(test_chinese_conclusion_nudges_without_rerun())
    asyncio.run(test_required_revise_lets_model_pick_next_command())
    asyncio.run(test_required_revise_stops_at_cap())
    asyncio.run(test_denied_or_no_retry_is_not_nudged())
    test_host_file_skill_avoids_heredoc()
    test_truncate_tool_result_keeps_head_and_tail()
    test_context_length_detector()
    test_default_interactive_round_cap()
    asyncio.run(test_context_overflow_compacts_and_retries())
    asyncio.run(test_round_cap_allows_twelve_tool_rounds())
    print("all passed")


if __name__ == "__main__":
    main()
