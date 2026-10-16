"""host_screenshot tool wiring and vision attachment."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.client_env import tool_display_label  # noqa: E402
from app.host_vision import (  # noqa: E402
    HOST_IMAGE_KEY,
    drop_host_images_for_text_model,
    is_vision_input_reject,
    promote_host_images_for_model,
    split_host_image,
)
from app.llm import (  # noqa: E402
    TOOL_DEFS,
    fold_tool_results_in_messages,
    guide_tool_result,
    observe_tool_result,
    tool_observation_failed,
)


def _ok(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)
    print(f"  OK  {msg}")


def test_tool_def_and_label() -> None:
    shot = next(t for t in TOOL_DEFS if (t.get("function") or {}).get("name") == "host_screenshot")
    desc = str((shot.get("function") or {}).get("description") or "")
    props = ((shot.get("function") or {}).get("parameters") or {}).get("properties") or {}
    _ok("host_screenshot" in desc or "see it" in desc, "description says the model can see the image")
    _ok("shown to the user" in desc or "user in chat" in desc, "description says image is shown in chat")
    _ok("screencapture" in desc, "description tells the model not to use blind screencapture")
    _ok("scope" in props and "display" in props, "optional scope and display")
    _ok(tool_display_label("host_screenshot") == "截取屏幕", "status label")


def test_split_attaches_image_and_strips_pixels_from_text() -> None:
    payload = {
        "ok": True,
        "mime": "image/jpeg",
        "width": 32,
        "height": 16,
        "scope": "main",
        "image_base64": "aGVsbG8=",  # too short, rejected
    }
    text, vision = split_host_image(json.dumps(payload))
    obj = json.loads(text)
    _ok(vision is None and obj.get("image_attached") is False, "tiny payload is not attached")
    _ok("image_base64" not in text, "pixels removed even when rejected")

    payload["image_base64"] = "A" * 80
    text, vision = split_host_image(json.dumps(payload))
    obj = json.loads(text)
    _ok(vision is not None and vision["data"] == "A" * 80, "vision carries base64")
    _ok(vision["mime"] == "image/jpeg", "mime kept")
    _ok(obj.get("image_attached") is True and "image_base64" not in obj, "text json has no pixels")
    _ok("画面" in obj.get("note", ""), "note tells the model an image is attached")


def test_promote_builds_image_url_part() -> None:
    text, vision = split_host_image(
        json.dumps({"ok": True, "mime": "image/png", "image_base64": "B" * 40})
    )
    messages = [
        {
            "role": "tool",
            "tool_call_id": "call_1",
            "content": text,
            HOST_IMAGE_KEY: vision,
        }
    ]
    promoted = promote_host_images_for_model(messages)
    content = promoted[0]["content"]
    _ok(isinstance(content, list) and content[1]["type"] == "image_url", "image part present")
    url = content[1]["image_url"]["url"]
    _ok(url.startswith("data:image/png;base64,B"), "data url uses mime and bytes")
    _ok(HOST_IMAGE_KEY not in promoted[0], "private key stripped before upstream")
    _ok(messages[0]["content"] == text, "in-loop message stays a JSON string")


def test_fold_drops_older_screenshots() -> None:
    vision = {"mime": "image/jpeg", "data": "C" * 40}
    messages = [
        {"role": "tool", "tool_call_id": "old", "content": '{"ok":true}', HOST_IMAGE_KEY: vision},
        {"role": "tool", "tool_call_id": "new", "content": '{"ok":true}', HOST_IMAGE_KEY: dict(vision)},
    ]
    folded = fold_tool_results_in_messages(messages, keep_recent_full=1)
    _ok(HOST_IMAGE_KEY not in folded[0], "older screenshot image dropped")
    _ok(folded[1].get(HOST_IMAGE_KEY, {}).get("data") == "C" * 40, "newest screenshot kept")
    _ok(HOST_IMAGE_KEY in messages[0], "fold does not mutate the source message")


def test_permission_error_is_not_a_shell_retry() -> None:
    raw = json.dumps(
        {
            "ok": False,
            "code": "screen_recording_denied",
            "error": "没有屏幕录制权限。请到系统设置允许 Open Bot。",
        },
        ensure_ascii=False,
    )
    guided = guide_tool_result("host_screenshot", raw)
    _ok("host_shell" not in guided, "permission error is not rewritten as a shell retry")
    obj = json.loads(guided)
    _ok(not tool_observation_failed(obj), "screen recording denial is not a retryable failure")
    text, vision = observe_tool_result("host_screenshot", raw)
    _ok(vision is None and "屏幕录制" in text, "observe keeps the permission error text")


def test_text_model_fallback_strips_image() -> None:
    messages = [
        {
            "role": "tool",
            "content": [
                {"type": "text", "text": '{"ok": true}'},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}},
            ],
        }
    ]
    _ok(is_vision_input_reject("upstream HTTP 400: unknown field image_url"), "image_url 400")
    _ok(not is_vision_input_reject("upstream HTTP 400: invalid json"), "unrelated 400")
    dropped = drop_host_images_for_text_model(messages)
    _ok(isinstance(dropped[0]["content"], str), "content back to text")
    _ok("没有看到画面" in dropped[0]["content"], "note says the image was not seen")
    _ok("base64" not in dropped[0]["content"], "pixels not left in the fallback text")


if __name__ == "__main__":
    test_tool_def_and_label()
    test_split_attaches_image_and_strips_pixels_from_text()
    test_promote_builds_image_url_part()
    test_fold_drops_older_screenshots()
    test_permission_error_is_not_a_shell_retry()
    test_text_model_fallback_strips_image()
    print("all passed")
