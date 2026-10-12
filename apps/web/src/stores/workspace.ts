/**
 * 当前工作区：账号、会话、助手、群。
 *
 * 侧栏、聊天顶栏、设置页都要读这些。写在 App 的编排 hooks 里，读在叶子组件里。
 * App 用 patch 同步，组件按字段订阅，避免一次改群折叠拖着整页设置重跑。
 */

import { create } from "zustand";
import type { Agent, Channel, Conversation, LLMConnection, User } from "../api";
import type { ComposerMentionItem, ComposerSkillOption } from "../components/Composer";
import type { MachineExecPolicy } from "../lib/userSettings";

export type WorkspaceSnapshot = {
  user: User | null;
  conversation: Conversation | null;
  agentId: string;
  agents: Agent[];
  channels: Channel[];
  assistantsCollapsed: boolean;
  groupsCollapsed: boolean;
  agentBusy: boolean;
  channelBusy: boolean;
  busySelectionKeys: readonly string[];
  defaultLLM: LLMConnection | undefined;
  selectionHydrated: boolean;
  viewingRunActive: boolean;
  hostExecPolicy: MachineExecPolicy;
  hostWritesOn: boolean;
  composerMentionItems: ComposerMentionItem[];
  composerSkills: ComposerSkillOption[];
};

const initialWorkspace: WorkspaceSnapshot = {
  user: null,
  conversation: null,
  agentId: "",
  agents: [],
  channels: [],
  assistantsCollapsed: false,
  groupsCollapsed: false,
  agentBusy: false,
  channelBusy: false,
  busySelectionKeys: [],
  defaultLLM: undefined,
  selectionHydrated: false,
  viewingRunActive: false,
  hostExecPolicy: "allow",
  hostWritesOn: false,
  composerMentionItems: [],
  composerSkills: [],
};

type WorkspaceStore = WorkspaceSnapshot & {
  patch: (partial: Partial<WorkspaceSnapshot>) => void;
  reset: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>()((set) => ({
  ...initialWorkspace,
  patch: (partial) =>
    set((s) => {
      let changed = false;
      const next: WorkspaceStore = { ...s };
      for (const key of Object.keys(partial) as (keyof WorkspaceSnapshot)[]) {
        const value = partial[key];
        if (value !== undefined && !Object.is(value, s[key])) {
          (next as Record<typeof key, typeof value>)[key] = value;
          changed = true;
        }
      }
      return changed ? next : s;
    }),
  reset: () => set((s) => ({ ...s, ...initialWorkspace })),
}));

export function workspaceState(): WorkspaceSnapshot {
  return useWorkspaceStore.getState();
}

export function patchWorkspace(partial: Partial<WorkspaceSnapshot>) {
  useWorkspaceStore.getState().patch(partial);
}
