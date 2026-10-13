/**
 * 运行脸：群 Auto 选人窗口、在场状态升级、文案、搜索提示。
 * 群里 faceAgentId 还空着时保持中性脸，不用列表焦点助手冒充正在回答的人。
 */

import type { Agent, Channel } from "../api";
import {
  normalizePresenceStatus,
  resolveAvatarColor,
  toolNameLooksLikeSearch,
  type BotPresenceStatus,
} from "../components/avatarColor";

export type RunSearchInput = {
  faceAgentId: string;
  isGroup: boolean;
  activeAgentId?: string | null;
  runActiveTool: string;
  hostActivity?: string | null;
};

export type RunSearchHints = {
  /** 侧栏 / 单聊顶栏：这张头像是当前这次搜索归属的助手。 */
  listAgentSearching: (agentId: string) => boolean;
  /** 群成员叠放：该成员的在场状态是 working，且这次运行像搜索。 */
  memberSearching: (presence: string | null | undefined) => boolean;
};

export type ChatRunFaceInput = RunSearchInput & {
  activeAgent: Agent | null | undefined;
  agents: readonly Agent[];
  activeChannel: Channel | null | undefined;
  agentNameById: ReadonlyMap<string, string>;
  runLive: boolean;
  runLabel: string;
  sending: boolean;
  taskBusy: boolean;
  viewingRunActive: boolean;
  presenceByAgent: Readonly<Record<string, string | undefined>>;
};

export type ChatRunFace = RunSearchHints & {
  agent: Agent | null | undefined;
  agentId: string | undefined;
  agentName: string;
  shape: string | undefined;
  avatarColor: string | undefined;
  color: string;
  status: BotPresenceStatus;
  searchingHint: boolean;
  label: string;
};

function looksLikeSearch(input: Pick<RunSearchInput, "runActiveTool" | "hostActivity">): boolean {
  return toolNameLooksLikeSearch(input.runActiveTool) || toolNameLooksLikeSearch(input.hostActivity || "");
}

function groupDecisionPending(input: Pick<RunSearchInput, "isGroup" | "faceAgentId"> & { runLive: boolean }): boolean {
  return Boolean(input.isGroup && !(input.faceAgentId || "").trim() && input.runLive);
}

export function runSearchHints(input: RunSearchInput): RunSearchHints {
  const searching = looksLikeSearch(input);
  const face = (input.faceAgentId || "").trim();
  return {
    listAgentSearching(agentId: string) {
      if (!searching || !agentId) return false;
      if (face) return agentId === face;
      return !input.isGroup && Boolean(input.activeAgentId) && agentId === input.activeAgentId;
    },
    memberSearching(presence) {
      return searching && normalizePresenceStatus(presence) === "working";
    },
  };
}

function memberAgents(activeChannel: Channel | null | undefined, agents: readonly Agent[]): Agent[] {
  if (!activeChannel?.members?.length) return [];
  return activeChannel.members.flatMap((id) => {
    const agent = agents.find((item) => item.id === id);
    if (!agent) return [];
    const profile = activeChannel.member_profiles?.find((item) => item.agent_id === id);
    return [
      {
        ...agent,
        avatar_shape: agent.avatar_shape || profile?.avatar_shape,
        avatar_color: agent.avatar_color || profile?.avatar_color,
      },
    ];
  });
}

function resolveFaceAgent(input: ChatRunFaceInput): Agent | null | undefined {
  const id = (input.faceAgentId || "").trim();
  if (!id) {
    if (input.isGroup) return undefined;
    return input.activeAgent;
  }
  const fromGroup = memberAgents(input.activeChannel, input.agents).find((agent) => agent.id === id);
  if (fromGroup) return fromGroup;
  const known = input.agents.find((agent) => agent.id === id);
  if (known) return known;
  const profile = input.activeChannel?.member_profiles?.find((item) => item.agent_id === id);
  if (profile) {
    return {
      id,
      name: profile.name || input.agentNameById.get(id) || id,
      description: "",
      avatar_shape: profile.avatar_shape,
      avatar_color: profile.avatar_color,
    };
  }
  return { id, name: input.agentNameById.get(id) || id, description: "" };
}

function attributedFaceId(input: Pick<ChatRunFaceInput, "faceAgentId" | "isGroup" | "activeAgent">): string {
  const face = (input.faceAgentId || "").trim();
  if (face) return face;
  if (input.isGroup) return "";
  return (input.activeAgent?.id || "").trim();
}

function faceStatus(input: ChatRunFaceInput, pending: boolean): BotPresenceStatus {
  if (pending) return "working";
  const faceId = attributedFaceId(input);
  const fromPresence = normalizePresenceStatus(faceId ? input.presenceByAgent[faceId] : undefined);
  if (fromPresence !== "idle") return fromPresence;
  if (!input.runLive) return "idle";
  return input.runActiveTool ? "working" : "thinking";
}

function faceLabel(input: ChatRunFaceInput, pending: boolean): string {
  if (pending && (!input.runLabel || input.runLabel === "正在思考…")) return "正在自动选人…";
  if (input.taskBusy && !input.sending && !input.viewingRunActive) return input.runLabel || "正在做…";
  return input.runLabel || "正在思考…";
}

/** 运行状态行要画的脸，连带列表头像该不该转搜索。 */
export function resolveChatRunFace(input: ChatRunFaceInput): ChatRunFace {
  const pending = groupDecisionPending(input);
  const agent = resolveFaceAgent(input);
  const searching = looksLikeSearch(input);
  const colorSeed =
    agent?.id || agent?.name || (pending ? "open-bot-group-pick" : "open-bot");
  return {
    ...runSearchHints(input),
    agent,
    agentId: agent?.id,
    agentName: agent?.name ?? (pending ? "选人中" : "助手"),
    shape: agent?.avatar_shape,
    avatarColor: agent?.avatar_color,
    color: resolveAvatarColor(colorSeed, agent?.avatar_color),
    status: faceStatus(input, pending),
    searchingHint: searching || pending,
    label: faceLabel(input, pending),
  };
}
