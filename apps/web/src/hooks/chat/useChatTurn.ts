/**
 * Chat turn module — deep seam for send + run lifecycle.
 *
 * External interface: send / stop / resume / clear / map / busy tick.
 * SendMessageDeps and seal/stamp/attachSources stay inside this module.
 *
 * Hook order (callers must respect): useChatTurnRuns → selection → useChatTurnSend.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import type { Agent, Conversation, Machine } from "../../api";
import type { ClientContext } from "../../lib/clientEnv";
import type { LastActiveSelection } from "../../types/app-ui";
import type { MessagesByConv, PatchConvMessages } from "../../lib/app/conversationMessages";
import type { PendingFile } from "../../components/Composer";
import type { SendMessageDeps } from "./sendMessageDeps";
import { sendUserTextImpl } from "./sendUserTextImpl";
import { useConversationRuns } from "./useConversationRuns";

export type SendUserTextFn = (
  rawContent: string,
  filesToSend?: PendingFile[],
  opts?: { onboarding?: boolean },
) => Promise<void>;

export type ChatTurnRunsParams = {
  conversationRef: RefObject<Conversation | null>;
  messagesByConvRef: RefObject<MessagesByConv>;
  patchConvMessages: PatchConvMessages;
  lastRequestIdRef: RefObject<string>;
  localUserIdRef: RefObject<string | null>;
  openThreadRootIdRef: RefObject<string | null>;
  setOpenThreadRootId: (id: string | null) => void;
  noteTask: (convId: string, active: boolean, label?: string) => void;
  applyBotOnline: (id: string, on: boolean) => void;
  refreshConversations: () => Promise<void>;
};

type RunsFull = ReturnType<typeof useConversationRuns>;

/** What selection / UI may use — no seal/stamp/attach. */
export type ChatTurnRuns = {
  runsRef: RunsFull["runsRef"];
  runBusyTick: number;
  bumpRunBusy: () => void;
  stopCurrentRun: RunsFull["stopCurrentRun"];
  resumeActiveRun: RunsFull["resumeActiveRun"];
  clearAllRuns: RunsFull["clearAllRuns"];
  mapApiMessages: RunsFull["mapApiMessages"];
};

type ChatTurnRunsInternal = ReturnType<typeof useConversationRuns>;

const runsInternalByPublic = new WeakMap<object, ChatTurnRunsInternal>();

export function useChatTurnRuns(params: ChatTurnRunsParams): ChatTurnRuns {
  const internal = useConversationRuns(params);
  const pub: ChatTurnRuns = {
    runsRef: internal.runsRef,
    runBusyTick: internal.runBusyTick,
    bumpRunBusy: internal.bumpRunBusy,
    stopCurrentRun: internal.stopCurrentRun,
    resumeActiveRun: internal.resumeActiveRun,
    clearAllRuns: internal.clearAllRuns,
    mapApiMessages: internal.mapApiMessages,
  };
  runsInternalByPublic.set(pub, internal);
  return pub;
}

export type ChatTurnSendParams = {
  runs: ChatTurnRuns;
  authed: boolean;
  conversationRef: RefObject<Conversation | null>;
  setConversation: (c: Conversation | null) => void;
  openThreadRootIdRef: RefObject<string | null>;
  messagesByConvRef: RefObject<MessagesByConv>;
  patchConvMessages: PatchConvMessages;
  snapshotViewedMessages: () => void;
  selectGenRef: MutableRefObject<number>;
  taskConvIdsRef: MutableRefObject<Set<string>>;
  localUserIdRef: MutableRefObject<string | null>;
  lastRequestIdRef: MutableRefObject<string>;
  agents: Agent[];
  agentId: string;
  setAgentId: (id: string) => void;
  agentNameById: Map<string, string>;
  groupMentionMembers: Agent[] | undefined;
  onboardingKey: string;
  setOnboardingDismissedState: (v: boolean) => void;
  noteTask: (convId: string, active: boolean, label?: string) => void;
  saveLastActiveSelection: (selection: LastActiveSelection) => void;
  ensureConversation: () => Promise<Conversation>;
  refreshConversations: () => Promise<void>;
  refreshAgents: () => Promise<Agent[]>;
  setStatus: (s: string) => void;
  clientEnv: ClientContext;
  machines: Machine[];
  deviceDisplayName: string;
};

export function useChatTurnSend(p: ChatTurnSendParams): SendUserTextFn {
  const deps = useMemo((): SendMessageDeps => {
    const internal = runsInternalByPublic.get(p.runs);
    if (!internal) {
      throw new Error("useChatTurnSend: runs handle was not created by useChatTurnRuns");
    }
    return {
      authed: p.authed,
      openThreadRootIdRef: p.openThreadRootIdRef,
      conversationRef: p.conversationRef,
      setConversation: p.setConversation,
      runsRef: internal.runsRef,
      stopCurrentRun: internal.stopCurrentRun,
      taskConvIdsRef: p.taskConvIdsRef,
      agents: p.agents,
      agentId: p.agentId,
      setAgentId: p.setAgentId,
      agentNameById: p.agentNameById,
      messagesByConvRef: p.messagesByConvRef,
      patchConvMessages: p.patchConvMessages,
      snapshotViewedMessages: p.snapshotViewedMessages,
      selectGenRef: p.selectGenRef,
      mapApiMessages: internal.mapApiMessages,
      noteTask: p.noteTask,
      saveLastActiveSelection: p.saveLastActiveSelection,
      onboardingKey: p.onboardingKey,
      setOnboardingDismissedState: p.setOnboardingDismissedState,
      localUserIdRef: p.localUserIdRef,
      groupMentionMembers: p.groupMentionMembers,
      ensureConversation: p.ensureConversation,
      refreshConversations: p.refreshConversations,
      refreshAgents: p.refreshAgents,
      bumpRunBusy: internal.bumpRunBusy,
      lastRequestIdRef: p.lastRequestIdRef,
      sealStreamingMessagesForConv: internal.sealStreamingMessagesForConv,
      stampUserSavedMessage: internal.stampUserSavedMessage,
      stampSavedMessage: internal.stampSavedMessage,
      attachSourcesToStreaming: internal.attachSourcesToStreaming,
      setStatus: p.setStatus,
      clientEnv: p.clientEnv,
      machines: p.machines,
      deviceDisplayName: p.deviceDisplayName,
    };
  }, [p]);

  const depsRef = useRef(deps);
  useLayoutEffect(() => {
    depsRef.current = deps;
  });

  return useCallback<SendUserTextFn>(async (rawContent, filesToSend = [], opts) => {
    await sendUserTextImpl(depsRef.current, rawContent, filesToSend, opts);
  }, []);
}
