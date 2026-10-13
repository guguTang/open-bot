import { describe, expect, it } from "vitest";
import type { UiMessage } from "../../types/app-ui";
import { isChatProcessing, resolveTranscriptView } from "./transcriptView";

function message(partial: Partial<UiMessage> & Pick<UiMessage, "id" | "role">): UiMessage {
  return { content: "", ...partial };
}

function view(over: Partial<Parameters<typeof resolveTranscriptView>[0]> = {}) {
  return resolveTranscriptView({
    selectionHydrated: true,
    chatSwitchPending: false,
    channelId: null,
    onboardingDismissed: false,
    chatProcessing: false,
    messages: [],
    ...over,
  });
}

describe("resolveTranscriptView", () => {
  it("shows loading until selection is hydrated or a switch has messages", () => {
    expect(view({ selectionHydrated: false }).banner).toBe("loading");
    expect(view({ chatSwitchPending: true }).banner).toBe("loading");
    expect(
      view({ chatSwitchPending: true, messages: [message({ id: "1", role: "user", content: "hi" })] }).banner,
    ).toBeNull();
  });

  it("shows onboarding only for an idle direct chat with no user or assistant text", () => {
    expect(view().banner).toBe("onboarding");
    expect(view({ channelId: "group" }).banner).toBe("empty");
    expect(view({ onboardingDismissed: true }).banner).toBe("empty");
    expect(view({ chatProcessing: true }).banner).toBe("empty");
    expect(view({ messages: [message({ id: "1", role: "user", content: "hi" })] }).banner).toBeNull();
    expect(view({ messages: [message({ id: "s", role: "summary", content: "记" })] }).banner).toBe("onboarding");
  });

  it("hides the live run row once an assistant bubble is streaming text", () => {
    const streaming = message({ id: "a", role: "assistant", content: "…", streaming: true });
    expect(view({ chatProcessing: true, messages: [streaming] }).showLiveRun).toBe(false);
    const pending = message({ id: "a", role: "assistant", content: "", streaming: true });
    expect(view({ chatProcessing: true, messages: [pending] }).showLiveRun).toBe(true);
    expect(view({ messages: [pending] }).showLiveRun).toBe(false);
  });

  it("keeps thread replies off the main timeline and counts them", () => {
    const indexed = view({
      messages: [
        message({ id: "root", role: "user", content: "问" }),
        message({ id: "reply", role: "assistant", content: "答", thread_root_id: "root" }),
        message({ id: "sum", role: "summary", content: "略", thread_root_id: "root" }),
      ],
    }).indexed;
    expect(indexed.mainTimeline.map((item) => item.id)).toEqual(["root"]);
    expect(indexed.replyCountByRoot.get("root")).toBe(1);
  });
});

describe("isChatProcessing", () => {
  it("is true when any run flag is on", () => {
    expect(isChatProcessing({ sending: false, taskBusy: false, viewingRunActive: false })).toBe(false);
    expect(isChatProcessing({ sending: true, taskBusy: false, viewingRunActive: false })).toBe(true);
    expect(isChatProcessing({ sending: false, taskBusy: true, viewingRunActive: false })).toBe(true);
    expect(isChatProcessing({ sending: false, taskBusy: false, viewingRunActive: true })).toBe(true);
  });
});
