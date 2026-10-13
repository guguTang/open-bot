import { describe, expect, it } from "vitest";
import { resolveSettingsHubNav } from "./settingsNav";

describe("resolveSettingsHubNav", () => {
  it("maps account/server onto general panes", () => {
    expect(resolveSettingsHubNav("account")).toEqual({
      tab: "general",
      generalPane: "account",
      prefetch: "general",
    });
    expect(resolveSettingsHubNav("server")).toEqual({
      tab: "general",
      generalPane: "server",
      prefetch: "general",
    });
  });

  it("maps general hub to review pane", () => {
    expect(resolveSettingsHubNav("general")).toEqual({
      tab: "general",
      generalPane: "review",
      prefetch: "general",
    });
  });

  it("passes through other tabs", () => {
    expect(resolveSettingsHubNav("llm")).toEqual({ tab: "llm", prefetch: "llm" });
    expect(resolveSettingsHubNav("review")).toEqual({ tab: "review", prefetch: "review" });
  });
});
