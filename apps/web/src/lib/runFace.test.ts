import { describe, expect, it } from "vitest";
import type { Agent, Channel } from "../api";
import { resolveAvatarColor } from "../components/avatarColor";
import { resolveChatRunFace, runSearchHints, type ChatRunFaceInput } from "./runFace";

function agent(id: string, name = id): Agent {
  return { id, name, description: "" };
}

function channel(partial: Partial<Channel> & Pick<Channel, "id" | "name">): Channel {
  return { user_id: "u", created_at: "", members: [], ...partial };
}

function input(over: Partial<ChatRunFaceInput> = {}): ChatRunFaceInput {
  const dm = agent("dm", "单聊");
  return {
    faceAgentId: "",
    isGroup: false,
    activeAgentId: dm.id,
    runActiveTool: "",
    hostActivity: null,
    activeAgent: dm,
    agents: [dm, agent("coder", "编码")],
    activeChannel: null,
    agentNameById: new Map([
      ["dm", "单聊"],
      ["coder", "编码"],
    ]),
    runLive: false,
    runLabel: "正在思考…",
    sending: false,
    taskBusy: false,
    viewingRunActive: false,
    presenceByAgent: {},
    ...over,
  };
}

describe("resolveChatRunFace", () => {
  it("keeps a neutral face while a group is still picking", () => {
    const face = resolveChatRunFace(
      input({
        isGroup: true,
        activeAgentId: "lead-or-random",
        activeAgent: agent("lead-or-random", "焦点"),
        runLive: true,
        sending: true,
      }),
    );
    expect(face.agentId).toBeUndefined();
    expect(face.agentName).toBe("选人中");
    expect(face.label).toBe("正在自动选人…");
    expect(face.status).toBe("working");
    expect(face.searchingHint).toBe(true);
    expect(face.color).toBe(resolveAvatarColor("open-bot-group-pick"));
  });

  it("uses the answering bot after the group face is known", () => {
    const face = resolveChatRunFace(
      input({
        isGroup: true,
        faceAgentId: "coder",
        runLive: true,
        sending: true,
        presenceByAgent: { coder: "working" },
      }),
    );
    expect(face.agentId).toBe("coder");
    expect(face.agentName).toBe("编码");
    expect(face.label).toBe("正在思考…");
    expect(face.status).toBe("working");
    expect(face.searchingHint).toBe(false);
  });

  it("falls back to the DM agent and that agent's presence", () => {
    const face = resolveChatRunFace(
      input({
        runLive: true,
        sending: true,
        presenceByAgent: { dm: "idle" },
      }),
    );
    expect(face.agentId).toBe("dm");
    expect(face.status).toBe("thinking");
    expect(face.agentName).toBe("单聊");
  });

  it("upgrades an idle live run with a tool to working", () => {
    const face = resolveChatRunFace(
      input({
        runLive: true,
        taskBusy: true,
        runActiveTool: "web_search",
        runLabel: "正在检索…",
        presenceByAgent: { dm: "idle" },
      }),
    );
    expect(face.status).toBe("working");
    expect(face.searchingHint).toBe(true);
    expect(face.label).toBe("正在检索…");
  });

  it("uses the task label only when the run is a background task", () => {
    const face = resolveChatRunFace(input({ taskBusy: true, runLabel: "正在整理文件" }));
    expect(face.label).toBe("正在整理文件");
    const fallback = resolveChatRunFace(input({ taskBusy: true, runLabel: "" }));
    expect(fallback.label).toBe("正在做…");
  });

  it("reads a group member profile when the agent list has no match", () => {
    const face = resolveChatRunFace(
      input({
        isGroup: true,
        faceAgentId: "guest",
        activeChannel: channel({
          id: "g",
          name: "群",
          members: ["guest"],
          member_profiles: [{ agent_id: "guest", name: "客座", avatar_shape: "cloud", avatar_color: "#112233" }],
        }),
      }),
    );
    expect(face.agentName).toBe("客座");
    expect(face.avatarColor).toBe("#112233");
  });
});

describe("runSearchHints", () => {
  const hints = (over: Partial<ChatRunFaceInput> = {}) => runSearchHints(input(over));

  it("attributes a search to the face agent, or the DM agent when the face is empty", () => {
    expect(hints({ runActiveTool: "grep", faceAgentId: "coder" }).listAgentSearching("coder")).toBe(true);
    expect(hints({ runActiveTool: "grep", faceAgentId: "coder" }).listAgentSearching("dm")).toBe(false);
    expect(hints({ hostActivity: "联网搜索" }).listAgentSearching("dm")).toBe(true);
    expect(hints({ isGroup: true, runActiveTool: "grep" }).listAgentSearching("dm")).toBe(false);
  });

  it("marks a group member only while their presence is working a search", () => {
    const searching = hints({ runActiveTool: "web_search" });
    expect(searching.memberSearching("working")).toBe(true);
    expect(searching.memberSearching("thinking")).toBe(false);
    expect(hints().memberSearching("working")).toBe(false);
  });
});
