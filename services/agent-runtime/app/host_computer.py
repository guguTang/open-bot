"""Normalize Mac desktop-control tool calls onto the host exec channel.

Coordinates are image pixels of a prior host_screenshot (its width × height)
and must carry that frame_id. This module only checks the shape; the desktop
binds the frame and rejects a stale or all-display screenshot.
"""

from __future__ import annotations

import math
import re
from typing import Any

COMPUTER_TOOLS = frozenset(
    {
        "host_click",
        "host_type",
        "host_key",
        "host_scroll",
        "host_mouse_move",
        "host_drag",
        "host_list_windows",
        "host_ax",
        "host_tcc_status",
    }
)

_FRAME_RE = re.compile(r"^[A-Za-z0-9_-]{4,80}$")
_ELEMENT_RE = re.compile(r"^e[A-Za-z0-9]{4,40}$")
_MAX_TYPE = 2000


def is_computer_tool(name: str) -> bool:
    return name in COMPUTER_TOOLS


def prepare_host_computer(name: str, args: dict[str, Any] | None) -> tuple[str, str, dict[str, Any]]:
    """Return ``(path, dest, args)`` for ``exec_host``.

    ``path`` is the short confirm-card summary. ``dest`` stays empty.
    Raises ``ValueError`` with a Chinese message the model can act on.
    """
    raw = args if isinstance(args, dict) else {}
    if name == "host_tcc_status":
        return "", "", {}
    if name == "host_list_windows":
        frame_id = _opt_frame(raw.get("frame_id"))
        out: dict[str, Any] = {}
        if frame_id:
            out["frame_id"] = frame_id
        return frame_id or "窗口", "", out
    if name == "host_ax":
        return _prepare_ax(raw)
    if name == "host_click":
        return _prepare_click(raw)
    if name == "host_type":
        return _prepare_type(raw)
    if name == "host_key":
        return _prepare_key(raw)
    if name == "host_scroll":
        return _prepare_scroll(raw)
    if name == "host_mouse_move":
        return _prepare_move(raw)
    if name == "host_drag":
        return _prepare_drag(raw)
    raise ValueError("不支持的桌面操作")


def _opt_frame(value: Any) -> str:
    if value is None or str(value).strip() == "":
        return ""
    frame_id = str(value).strip()
    if not _FRAME_RE.match(frame_id):
        raise ValueError("frame_id 无效。请使用刚才 host_screenshot 返回的 frame_id")
    return frame_id


def _require_frame(value: Any) -> str:
    frame_id = _opt_frame(value)
    if not frame_id:
        raise ValueError("需要最近一次截图的 frame_id。先 host_screenshot，再用返回的 frame_id")
    return frame_id


def _element(value: Any) -> str:
    if value is None or str(value).strip() == "":
        return ""
    ref = str(value).strip()
    if not _ELEMENT_RE.match(ref):
        raise ValueError("element_ref 无效。请重新 host_ax，用返回的 element_ref")
    return ref


def _num(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} 需为数字")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} 无效")
    return number


def _point(raw: dict[str, Any], x_key: str = "x", y_key: str = "y") -> tuple[float, float]:
    if x_key not in raw or y_key not in raw:
        raise ValueError("需要截图像素坐标 x 和 y")
    return _num(raw.get(x_key), x_key), _num(raw.get(y_key), y_key)


def _modifiers(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if not isinstance(value, list):
        raise ValueError("modifiers 需为字符串数组")
    out: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            out.append(text)
    return out


def _background(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if "background" in raw and raw.get("background") is not None:
        if not isinstance(raw.get("background"), bool):
            raise ValueError("background 需为 true 或 false")
        out["background"] = bool(raw.get("background"))
    if raw.get("pid") is not None and str(raw.get("pid")).strip() != "":
        try:
            pid = int(raw.get("pid"))
        except (TypeError, ValueError):
            raise ValueError("pid 无效") from None
        if pid <= 0:
            raise ValueError("pid 无效")
        out["pid"] = pid
    if out.get("background") and "pid" not in out and "element_ref" not in out:
        # element_ref may be added by the caller before this check. Callers that
        # already copied element_ref into `out` should pass it in raw as well.
        if not str(raw.get("element_ref") or "").strip():
            raise ValueError("后台发送需要 pid。先 host_list_windows 或 host_ax 取得 pid")
    return out


def _button(raw: dict[str, Any]) -> str:
    button = str(raw.get("button") or "left").strip().lower() or "left"
    if button not in ("left", "right", "middle", "center"):
        raise ValueError("button 只能是 left、right 或 middle")
    return "middle" if button == "center" else button


def _fmt_pt(x: float, y: float) -> str:
    return f"{_trim(x)},{_trim(y)}"


def _trim(n: float) -> str:
    if float(n).is_integer():
        return str(int(n))
    return f"{n:.1f}"


def _prepare_click(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    element = _element(raw.get("element_ref"))
    out: dict[str, Any] = {}
    if element:
        out["element_ref"] = element
        frame_id = _opt_frame(raw.get("frame_id"))
        if frame_id:
            out["frame_id"] = frame_id
        summary = f"元素 {element}"
    else:
        frame_id = _require_frame(raw.get("frame_id"))
        x, y = _point(raw)
        out["frame_id"] = frame_id
        out["x"] = x
        out["y"] = y
        summary = _fmt_pt(x, y)
    button = _button(raw)
    if button != "left":
        out["button"] = button
    clicks = raw.get("clicks", 1)
    try:
        count = int(clicks if clicks is not None else 1)
    except (TypeError, ValueError):
        raise ValueError("clicks 需为 1 到 3") from None
    if count < 1 or count > 3:
        raise ValueError("clicks 需为 1 到 3")
    if count != 1:
        out["clicks"] = count
    mods = _modifiers(raw.get("modifiers"))
    if mods:
        out["modifiers"] = mods
    out.update(_background(raw))
    return summary, "", out


def _prepare_type(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    text = raw.get("text")
    if not isinstance(text, str) or not text:
        raise ValueError("text 是空的")
    if len(text) > _MAX_TYPE:
        raise ValueError("一次最多输入 2000 个字符")
    element = _element(raw.get("element_ref"))
    frame_id = _opt_frame(raw.get("frame_id"))
    if not element and not frame_id:
        raise ValueError("输入前需要 frame_id 或 element_ref。先看屏幕或查看界面元素")
    out: dict[str, Any] = {"text": text}
    if element:
        out["element_ref"] = element
    if frame_id:
        out["frame_id"] = frame_id
    out.update(_background(raw))
    return f"输入 {len(text)} 字", "", out


def _prepare_key(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    key = str(raw.get("key") or "").strip()
    if not key or len(key) > 64:
        raise ValueError("按键无效")
    element = _element(raw.get("element_ref"))
    frame_id = _opt_frame(raw.get("frame_id"))
    if not element and not frame_id:
        raise ValueError("按键前需要 frame_id 或 element_ref。先看屏幕或查看界面元素")
    mods = _modifiers(raw.get("modifiers"))
    out: dict[str, Any] = {"key": key}
    if mods:
        out["modifiers"] = mods
    if element:
        out["element_ref"] = element
    if frame_id:
        out["frame_id"] = frame_id
    out.update(_background(raw))
    shown = "+".join([*mods, key]) if mods and "+" not in key else key
    return shown, "", out


def _prepare_scroll(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    frame_id = _require_frame(raw.get("frame_id"))
    x, y = _point(raw)
    dx = _num(raw.get("dx", 0), "dx") if "dx" in raw else 0.0
    dy = _num(raw.get("dy", 0), "dy") if "dy" in raw else 0.0
    if dx == 0 and dy == 0:
        raise ValueError("滚动距离是 0")
    out = {"frame_id": frame_id, "x": x, "y": y, "dx": dx, "dy": dy}
    out.update(_background(raw))
    return f"{_fmt_pt(x, y)} dy={_trim(dy)} dx={_trim(dx)}", "", out


def _prepare_move(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    frame_id = _require_frame(raw.get("frame_id"))
    x, y = _point(raw)
    out: dict[str, Any] = {"frame_id": frame_id, "x": x, "y": y}
    out.update(_background(raw))
    return _fmt_pt(x, y), "", out


def _prepare_drag(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    frame_id = _require_frame(raw.get("frame_id"))
    x, y = _point(raw)
    x2, y2 = _point(raw, "x2", "y2")
    out: dict[str, Any] = {"frame_id": frame_id, "x": x, "y": y, "x2": x2, "y2": y2}
    button = _button(raw)
    if button != "left":
        out["button"] = button
    out.update(_background(raw))
    return f"{_fmt_pt(x, y)} → {_fmt_pt(x2, y2)}", "", out


def _prepare_ax(raw: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    out: dict[str, Any] = {}
    frame_id = _opt_frame(raw.get("frame_id"))
    if frame_id:
        out["frame_id"] = frame_id
    app = str(raw.get("app") or "").strip()
    if app:
        if len(app) > 80:
            raise ValueError("应用名太长")
        out["app"] = app
    if raw.get("pid") is not None and str(raw.get("pid")).strip() != "":
        try:
            pid = int(raw.get("pid"))
        except (TypeError, ValueError):
            raise ValueError("pid 无效") from None
        if pid <= 0:
            raise ValueError("pid 无效")
        out["pid"] = pid
    if raw.get("window_id") is not None and str(raw.get("window_id")).strip() != "":
        try:
            window_id = int(raw.get("window_id"))
        except (TypeError, ValueError):
            raise ValueError("window_id 无效") from None
        out["window_id"] = window_id
    if raw.get("max_depth") is not None and str(raw.get("max_depth")).strip() != "":
        try:
            depth = int(raw.get("max_depth"))
        except (TypeError, ValueError):
            raise ValueError("max_depth 需为 1 到 3") from None
        if depth < 1 or depth > 3:
            raise ValueError("max_depth 需为 1 到 3")
        out["max_depth"] = depth
    if raw.get("limit") is not None and str(raw.get("limit")).strip() != "":
        try:
            limit = int(raw.get("limit"))
        except (TypeError, ValueError):
            raise ValueError("limit 需为 1 到 120") from None
        if limit < 1 or limit > 120:
            raise ValueError("limit 需为 1 到 120")
        out["limit"] = limit
    has_x = raw.get("x") is not None and str(raw.get("x")).strip() != ""
    has_y = raw.get("y") is not None and str(raw.get("y")).strip() != ""
    if has_x or has_y:
        if not frame_id:
            raise ValueError("按坐标查看元素需要 frame_id")
        x, y = _point(raw)
        out["x"] = x
        out["y"] = y
        summary = _fmt_pt(x, y)
    elif app:
        summary = app
    elif "pid" in out:
        summary = f"pid {out['pid']}"
    else:
        summary = "前台"
    return summary, "", out
