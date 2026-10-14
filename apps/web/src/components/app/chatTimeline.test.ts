import { describe, expect, it } from "vitest";
import { speakerFaceForMessage, speakerNameForMessage } from "./chatTimeline";
import type { UiMessage } from "../../types/app-ui";

const names = new Map([
  ["bot1", "统筹"],
  ["bot2", "码农助手"],
]);

function msg(partial: Partial<UiMessage>): UiMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "修好了",
    created_at: "2026-10-13T00:00:00Z",
    ...partial,
  };
}

describe("speakerNameForMessage", () => {
  it("labels another bot in a DM", () => {
    expect(speakerNameForMessage(msg({ agent_id: "bot2" }), undefined, names, "bot1")).toBe(
      "来自于 码农助手 的消息",
    );
  });

  it("omits the label when the conversation owner is speaking", () => {
    expect(speakerNameForMessage(msg({ agent_id: "bot1" }), undefined, names, "bot1")).toBeUndefined();
  });

  it("keeps the group member name without the 来自 prefix", () => {
    expect(speakerNameForMessage(msg({ agent_id: "bot2" }), "chan", names, "bot1")).toBe("码农助手");
  });
});

describe("speakerFaceForMessage", () => {
  it("returns the other bot in a DM and nothing for the owner or a group", () => {
    const agents = [{ id: "bot2", name: "码农助手", avatar_shape: "square", avatar_color: "#118ab2" }];
    expect(speakerFaceForMessage(msg({ agent_id: "bot2" }), { agent_id: "bot1" }, agents as never)).toMatchObject({
      id: "bot2",
      name: "码农助手",
    });
    expect(speakerFaceForMessage(msg({ agent_id: "bot1" }), { agent_id: "bot1" }, agents as never)).toBeUndefined();
    expect(
      speakerFaceForMessage(msg({ agent_id: "bot2" }), { agent_id: "bot1", channel_id: "chan" }, agents as never),
    ).toBeUndefined();
  });
});
