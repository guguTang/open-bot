"""Mac computer-use tool schema and host-exec argument normalization."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.client_env import tool_display_label  # noqa: E402
from app.host_computer import prepare_host_computer  # noqa: E402
from app.llm import TOOL_DEFS  # noqa: E402


def _ok(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  OK  {msg}")


def _tool(name: str) -> dict:
    return next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == name)


def test_tool_defs_cover_the_action_set() -> None:
    names = [
        "host_click",
        "host_type",
        "host_key",
        "host_scroll",
        "host_mouse_move",
        "host_drag",
        "host_list_windows",
        "host_ax",
        "host_tcc_status",
    ]
    for name in names:
        tool = _tool(name)
        desc = str((tool.get("function") or {}).get("description") or "")
        _ok("host_shell" in desc or "Read-only" in desc or "Mac" in desc or "mac" in desc.lower(), f"{name} describes the mac path")
        _ok(tool_display_label(name) != "正在处理…", f"{name} has a status label")
    click = _tool("host_click")
    props = ((click.get("function") or {}).get("parameters") or {}).get("properties") or {}
    _ok("frame_id" in props and "element_ref" in props, "click accepts frame_id and element_ref")
    shot = str((_tool("host_screenshot").get("function") or {}).get("description") or "")
    _ok("frame_id" in shot and "scale" in shot, "screenshot tells the model about frame binding")
    _ok(tool_display_label("host_click") == "点击界面", "click status label")
    _ok(tool_display_label("host_tcc_status") == "检查权限", "tcc status label")


def test_click_requires_a_frame_or_element() -> None:
    try:
        prepare_host_computer("host_click", {"x": 1, "y": 2})
    except ValueError as exc:
        _ok("frame_id" in str(exc), "missing frame explains frame_id")
    else:
        raise AssertionError("click without frame should fail")
    path, _dest, args = prepare_host_computer(
        "host_click",
        {"frame_id": "fabc1234", "x": 12, "y": 34.5, "button": "right", "clicks": 2},
    )
    _ok(path == "12,34.5", "summary is image pixels")
    _ok(args["frame_id"] == "fabc1234" and args["button"] == "right" and args["clicks"] == 2, "args kept")
    path, _dest, args = prepare_host_computer("host_click", {"element_ref": "eabc1234"})
    _ok(args["element_ref"] == "eabc1234" and "x" not in args, "element click skips coordinates")
    _ok("元素" in path, "element summary")


def test_type_and_key_need_a_recent_look() -> None:
    try:
        prepare_host_computer("host_type", {"text": "hi"})
    except ValueError as exc:
        _ok("frame_id" in str(exc), "type without a look is rejected")
    else:
        raise AssertionError("bare type should fail")
    path, _dest, args = prepare_host_computer(
        "host_type", {"text": "你好", "frame_id": "fabc1234"}
    )
    _ok(path == "输入 2 字" and args["text"] == "你好", "type keeps the full text")
    path, _dest, args = prepare_host_computer(
        "host_key", {"key": "t", "modifiers": ["command"], "frame_id": "fabc1234"}
    )
    _ok(path == "command+t" and args["key"] == "t", "shortcut summary")
    try:
        prepare_host_computer("host_key", {"key": "t", "background": True, "frame_id": "fabc1234"})
    except ValueError as exc:
        _ok("pid" in str(exc), "background key needs a pid")
    else:
        raise AssertionError("background without pid should fail")


def test_scroll_drag_and_readonly_shapes() -> None:
    try:
        prepare_host_computer("host_scroll", {"frame_id": "fabc1234", "x": 1, "y": 2, "dx": 0, "dy": 0})
    except ValueError as exc:
        _ok("0" in str(exc), "zero scroll rejected")
    else:
        raise AssertionError("zero scroll should fail")
    _path, _dest, args = prepare_host_computer(
        "host_drag",
        {"frame_id": "fabc1234", "x": 0, "y": 0, "x2": 10, "y2": 20},
    )
    _ok(args["x2"] == 10 and args["y2"] == 20, "drag keeps both ends")
    path, _dest, args = prepare_host_computer("host_tcc_status", {})
    _ok(path == "" and args == {}, "tcc status is empty")
    path, _dest, args = prepare_host_computer("host_ax", {"app": "Safari", "max_depth": 2})
    _ok(path == "Safari" and args["max_depth"] == 2, "ax names the app")
    try:
        prepare_host_computer("host_ax", {"x": 1, "y": 2})
    except ValueError as exc:
        _ok("frame_id" in str(exc), "ax hit test needs a frame")
    else:
        raise AssertionError("ax point without frame should fail")


if __name__ == "__main__":
    test_tool_defs_cover_the_action_set()
    test_click_requires_a_frame_or_element()
    test_type_and_key_need_a_recent_look()
    test_scroll_drag_and_readonly_shapes()
    print("all passed")
