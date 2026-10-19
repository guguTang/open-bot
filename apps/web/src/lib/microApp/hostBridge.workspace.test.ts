import { describe, expect, it } from "vitest";
import { resolveBotWorkspacePath } from "./hostBridge";
import { capabilityAvailability, devicePluginAvailable } from "./capabilities";

describe("resolveBotWorkspacePath", () => {
  it("normalizes relative paths under /workspace", () => {
    expect(resolveBotWorkspacePath("notes/a.txt")).toBe("/workspace/notes/a.txt");
    expect(resolveBotWorkspacePath("/workspace")).toBe("/workspace");
    expect(resolveBotWorkspacePath("/workspace/foo")).toBe("/workspace/foo");
    expect(resolveBotWorkspacePath("")).toBe("/workspace");
  });

  it("rejects escape and non-workspace roots", () => {
    expect(() => resolveBotWorkspacePath("../etc/passwd")).toThrow(/workspace|\.\./);
    expect(() => resolveBotWorkspacePath("/workspace/../etc/passwd")).toThrow(/\.|\.\./);
    expect(() => resolveBotWorkspacePath("/etc/passwd")).toThrow(/workspace/);
    expect(() => resolveBotWorkspacePath("/workspace/foo/../../etc")).toThrow(/\.|\.\./);
  });
});

describe("Phase 5 capability availability", () => {
  const declared = [
    "agent.invoke",
    "skill.toggle",
    "host.fs.workspace",
    "device.mic",
    "device.geo",
  ];

  it("marks agent/skill/workspace available without host", () => {
    for (const cap of ["agent.invoke", "skill.toggle", "host.fs.workspace"]) {
      const row = capabilityAvailability(cap, { declared, client: null });
      expect(row.available).toBe(true);
      expect(row.host_required).toBeFalsy();
    }
  });

  it("greys out mic/geo off native or without plugins", () => {
    for (const cap of ["device.mic", "device.geo"] as const) {
      const row = capabilityAvailability(cap, { declared, client: null });
      expect(row.available).toBe(false);
      expect(row.device_required).toBe(true);
      // In jsdom / non-Capacitor, plugins are absent.
      expect(devicePluginAvailable(cap)).toBe(false);
    }
  });
});
