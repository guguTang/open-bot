import { describe, expect, it } from "vitest";
import type { ClientContext } from "./clientEnv";
import { classifyHostExecReview } from "./hostExecReview";
import { DESKTOP_CAPTURE_PERMISSION_HINT, shouldShowDesktopCapturePermissions } from "./desktopPrivacy";
import { toolLabelForHostOp } from "./toolAllowlist";

function client(partial: Partial<ClientContext>): ClientContext {
  return {
    platform: "web",
    app: "browser",
    os: "",
    arch: "",
    app_version: "0.1.0",
    locale: "zh-CN",
    capabilities: { host_tools: false, workspace_tools: true },
    ...partial,
  };
}

describe("desktop capture permissions", () => {
  it("tells people to grant TCC to the installed Open Bot app", () => {
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("DMG");
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("Open Bot");
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("Contents/MacOS/open-bot-desktop");
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("屏幕录制");
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("辅助功能");
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("输入监控");
    expect(DESKTOP_CAPTURE_PERMISSION_HINT).toContain("事件发布");
  });

  it("shows capture guidance on macOS, Windows, and Linux desktop apps", () => {
    expect(shouldShowDesktopCapturePermissions(client({ platform: "macos", app: "tauri" }))).toBe(true);
    expect(shouldShowDesktopCapturePermissions(client({ platform: "windows", app: "tauri" }))).toBe(true);
    expect(shouldShowDesktopCapturePermissions(client({ platform: "linux", app: "tauri" }))).toBe(true);
    expect(
      shouldShowDesktopCapturePermissions(
        client({
          platform: "macos",
          app: "browser",
          capabilities: { host_tools: false, workspace_tools: true },
        }),
      ),
    ).toBe(false);
    expect(shouldShowDesktopCapturePermissions(client({ platform: "ios", app: "capacitor" }))).toBe(false);
  });

  it("auto-approves screenshot like other low-risk host reads", () => {
    expect(classifyHostExecReview("screenshot", "main", "")).toEqual({
      tier: "auto",
      reason: "截取屏幕是只读操作，Auto-review 自动放行",
      code: "screenshot",
    });
    expect(toolLabelForHostOp("screenshot")).toBe("host_screenshot");
  });

  it("confirms pointer actions and auto-runs permission and window reads", () => {
    expect(classifyHostExecReview("click", "12,34", "")).toEqual({
      tier: "confirm",
      reason: "点击界面，需你确认",
      code: "click",
    });
    expect(classifyHostExecReview("type", "输入 2 字", "").tier).toBe("confirm");
    expect(classifyHostExecReview("key", "cmd+t", "").code).toBe("key");
    expect(classifyHostExecReview("scroll", "1,1", "").code).toBe("scroll");
    expect(classifyHostExecReview("drag", "1,1", "").code).toBe("drag");
    expect(classifyHostExecReview("mouse_move", "1,1", "").code).toBe("mouse_move");
    expect(classifyHostExecReview("tcc_status", "", "").code).toBe("tcc_status");
    expect(classifyHostExecReview("list_windows", "", "").code).toBe("readonly_op");
    expect(classifyHostExecReview("ax", "Safari", "").tier).toBe("auto");
    expect(toolLabelForHostOp("click")).toBe("host_click");
    expect(toolLabelForHostOp("tcc_status")).toBe("host_tcc_status");
  });
});
