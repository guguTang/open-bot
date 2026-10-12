import type { MutableRefObject } from "react";
import type { Agent, Conversation, Machine } from "../../api";
import type { ClientContext } from "../../lib/clientEnv";
import type { LastActiveSelection, UiMessage } from "../../types/app-ui";
import type { ConvRunState } from "../../types/app-ui";
import type { MessagesByConv, PatchConvMessages } from "../../lib/app/conversationMessages";
import type { Message } from "../../api";

export type SendMessageDeps = {
  authed: boolean;
  openThreadRootIdRef: MutableRefObject<string | null>;
  conversationRef: MutableRefObject<Conversation | null>;
  setConversation: (c: Conversation | null) => void;
  runsRef: MutableRefObject<Map<string, ConvRunState>>;
  stopCurrentRun: (opts?: {
    markStopped?: boolean;
    waitForFlush?: boolean;
    conversationId?: string;
    localOnly?: boolean;
  }) => Promise<void>;
  taskConvIdsRef: MutableRefObject<Set<string>>;
  agents: Agent[];
  agentId: string;
  setAgentId: (id: string) => void;
  agentNameById: Map<string, string>;
  messagesByConvRef: MutableRefObject<MessagesByConv>;
  patchConvMessages: PatchConvMessages;
  snapshotViewedMessages: () => void;
  selectGenRef: MutableRefObject<number>;
  mapApiMessages: (msgs: Message[], nameLookup: Map<string, string> | Agent[]) => UiMessage[];
  noteTask: (convId: string, active: boolean, label?: string) => void;
  saveLastActiveSelection: (selection: LastActiveSelection) => void;
  onboardingKey: string;
  setOnboardingDismissedState: (v: boolean) => void;
  localUserIdRef: MutableRefObject<string | null>;
  groupMentionMembers: Agent[] | undefined;
  ensureConversation: () => Promise<Conversation>;
  refreshConversations: () => Promise<void>;
  refreshAgents: () => Promise<Agent[]>;
  bumpRunBusy: () => void;
  lastRequestIdRef: MutableRefObject<string>;
  sealStreamingMessagesForConv: (convId: string, markStopped?: boolean) => void;
  stampUserSavedMessage: (
    convId: string,
    messageId: string,
    extra?: { reply_to_id?: string; thread_root_id?: string; adoptThreadRoot?: boolean },
  ) => void;
  stampSavedMessage: (
    convId: string,
    messageId: string,
    requestId?: string,
    agentId?: string,
  ) => void;
  attachSourcesToStreaming: (convId: string, raw: unknown, messageId?: string) => void;
  setStatus: (s: string) => void;
  clientEnv: ClientContext;
  machines: Machine[];
  deviceDisplayName: string;
};
