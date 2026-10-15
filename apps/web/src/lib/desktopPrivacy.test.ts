import { describe, expect, it } from "vitest";
import type { ClientContext } from "./clientEnv";
import { classifyHostExecReview } from "./hostExecReview";
import { shouldShowDesktopCapturePermissions } from "./desktopPrivacy";
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
  it("shows Screen Recording guidance only on the macOS desktop app", () => {
    expect(shouldShowDesktopCapturePermissions(client({ platform: "macos", app: "tauri" }))).toBe(true);
    expect(
      shouldShowDesktopCapturePermissions(
        client({
          platform: "macos",
          app: "browser",
          capabilities: { host_tools: false, workspace_tools: true },
        }),
      ),
    ).toBe(false);
    expect(shouldShowDesktopCapturePermissions(client({ platform: "windows", app: "tauri" }))).toBe(false);
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
});
