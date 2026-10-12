import { useCallback, useMemo, useRef, useState } from "react";
import {
  cancelConversationRun,
  getConversationRunStatus,
  listMessages,
  subscribeConversationEvents,
  type Agent,
  type Conversation,
} from "../../api";
import { isGroupPassContent } from "../../lib/app/groupPass";
import { selectionKeyForConv } from "../../lib/app/conversationMessages";
import {
  attachSourcesToStreaming as attachSourcesLib,
  mapApiMessages,
  stampSavedMessage as stampSavedLib,
  type RunMessageOpsContext,
} from "../../lib/app/conversationRuns";
import type { ConvRunState, UiMessage } from "../../types/app-ui";
import type { MessagesByConv, PatchConvMessages } from "../../lib/app/conversationMessages";
import {
  setMessages,
  setRunActiveTool,
  setRunFaceAgentId,
  setRunLabel,
  setSending,
} from "../../stores/chat";

export function useConversationRuns(deps: {
  conversationRef: React.RefObject<Conversation | null>;
  messagesByConvRef: React.RefObject<MessagesByConv>;
  patchConvMessages: PatchConvMessages;
  lastRequestIdRef: React.RefObject<string>;
  localUserIdRef: React.RefObject<string | null>;
  openThreadRootIdRef: React.RefObject<string | null>;
  setOpenThreadRootId: (id: string | null) => void;
  noteTask: (convId: string, active: boolean, label?: string) => void;
  applyBotOnline: (id: string, on: boolean) => void;
  refreshConversations: () => Promise<void>;
}) {
  const runsRef = useRef<Map<string, ConvRunState>>(new Map());
  const [runBusyTick, setRunBusyTick] = useState(0);
  const bumpRunBusy = useCallback(() => setRunBusyTick((n) => n + 1), []);

  const runMsgCtx = useMemo(
    (): RunMessageOpsContext => ({
      runsRef,
      messagesByConvRef: deps.messagesByConvRef,
      patchConvMessages: deps.patchConvMessages,
    }),
    [deps.messagesByConvRef, deps.patchConvMessages],
  );

  const attachSourcesToStreaming = useCallback(
    (convId: string, raw: unknown, messageId?: string) => {
      attachSourcesLib(runMsgCtx, convId, raw, messageId);
    },
    [runMsgCtx],
  );

  const stampSavedMessage = useCallback(
    (convId: string, messageId: string, requestId?: string, agentId?: string) => {
      stampSavedLib(runMsgCtx, convId, messageId, requestId, agentId);
    },
    [runMsgCtx],
  );

  const stampUserSavedMessage = useCallback(
    (
      convId: string,
      messageId: string,
      extra?: { reply_to_id?: string; thread_root_id?: string; adoptThreadRoot?: boolean },
    ) => {
      if (!messageId) return;
      const localId = deps.localUserIdRef.current;
      const serverRoot = (extra?.thread_root_id || "").trim();
      deps.patchConvMessages(convId, (prev) => {
        if (prev.some((m) => m.id === messageId)) return prev;
        const idx = localId
          ? prev.findIndex((m) => m.id === localId)
          : [...prev].reverse().findIndex((m) => m.role === "user" && m.id.startsWith("local-user-"));
        const realIdx = localId ? idx : idx >= 0 ? prev.length - 1 - idx : -1;
        if (realIdx < 0) return prev;
        const oldId = prev[realIdx].id;
        return prev.map((m, i) => {
          if (i === realIdx) {
            // thread_root policy:
            // - Sidebar-thread send (optimistic had thread_root_id, or caller says we POSTed one):
            //   keep it, preferring the server's echoed value when present.
            // - Mainline (incl. 「回复」 quote): never adopt a server thread_root (would hide from timeline).
            const optimisticRoot = (m.thread_root_id || "").trim();
            const root =
              optimisticRoot || extra?.adoptThreadRoot ? serverRoot || optimisticRoot : "";
            const next: UiMessage = {
              ...m,
              id: messageId,
              reply_to_id: extra?.reply_to_id || m.reply_to_id,
            };
            if (root) next.thread_root_id = root;
            else delete next.thread_root_id;
            return next;
          }
          // Rare: thread opened on a still-local root — follow the id swap.
          if (oldId.startsWith("local-") && m.thread_root_id === oldId) {
            return { ...m, thread_root_id: messageId };
          }
          return m;
        });
      });
      if (localId && deps.openThreadRootIdRef.current === localId) deps.setOpenThreadRootId(messageId);
      if (deps.localUserIdRef.current === localId) deps.localUserIdRef.current = messageId;
    },
    [deps],
  );

  const sealStreamingMessagesForConv = useCallback(
    (convId: string, _markStopped?: boolean) => {
      deps.patchConvMessages(convId, (prev) =>
        prev
          .filter((m) => {
            if (m.streaming && isGroupPassContent(m.content || "")) return false;
            // Stop and supersede: drop empty streaming bubbles — never stamp 「（已停止）」.
            if (m.streaming && !(m.content && m.content.trim())) return false;
            return true;
          })
          .map((m) => {
            if (!m.streaming) return m;
            return { ...m, streaming: false };
          }),
      );
      const run = runsRef.current.get(convId);
      if (run) run.assistantId = null;
    },
    [deps.patchConvMessages],
  );

  const stopCurrentRun = useCallback(
    async (opts?: {
      /** @deprecated Ignored — empty bubbles are always dropped; no 「（已停止）」. */
      markStopped?: boolean;
      waitForFlush?: boolean;
      conversationId?: string;
      /**
       * Abort the local stream only. Used when a newer send will supersede via
       * server register (cancelReason=replace).
       */
      localOnly?: boolean;
    }) => {
      const convId = opts?.conversationId ?? deps.conversationRef.current?.id;
      if (!convId) return;
      const run = runsRef.current.get(convId);
      if (run) {
        run.generation += 1;
        run.abort.abort();
        // localOnly (interrupt-and-send): keep the map entry so generation stays
        // monotonic. Deleting reset gen→0 and let the stale send's finally match
        // the superseding run (same gen) and drop it — bot appeared silent.
        if (!opts?.localOnly) {
          runsRef.current.delete(convId);
          bumpRunBusy();
        } else {
          // Refresh busy tick so viewingRunActive/chatProcessing re-render while
          // the map entry is retained (pairs with d6c4fcf processing indicator).
          bumpRunBusy();
        }
      }
      sealStreamingMessagesForConv(convId);
      if (deps.conversationRef.current?.id === convId) {
        // localOnly (interrupt-and-send): keep sending/processing UI. Clearing it
        // while runsRef is retained (e806a30) desynced RunStatus after replace interrupts.
        if (!opts?.localOnly) {
          setSending(false);
        }
        setRunLabel("正在思考…");
      }
      if (opts?.localOnly) return;
      const rid =
        deps.conversationRef.current?.id === convId ? deps.lastRequestIdRef.current.trim() : "";
      const cancelPromise = cancelConversationRun(convId, rid ? { requestId: rid } : undefined).catch(
        () => {},
      );
      if (opts?.waitForFlush) {
        await cancelPromise;
      }
    },
    [bumpRunBusy, deps, sealStreamingMessagesForConv],
  );

  const resumeActiveRun = useCallback(
    async (conv: Conversation, nameLookup: Map<string, string> | Agent[]) => {
      if (runsRef.current.has(conv.id)) return;
      let active = false;
      try {
        active = (await getConversationRunStatus(conv.id)).active;
      } catch {
        return;
      }
      if (!active) return;

      const ac = new AbortController();
      const gen = (runsRef.current.get(conv.id)?.generation ?? 0) + 1;
      runsRef.current.set(conv.id, {
        abort: ac,
        generation: gen,
        assistantId: null,
        runLabel: "正在思考…",
        activeTool: "",
        faceAgentId: "",
        selectionKey: selectionKeyForConv(conv),
      });
      bumpRunBusy();
      if (deps.conversationRef.current?.id === conv.id) {
        setSending(true);
        setRunLabel("正在思考…");
        setRunActiveTool("");
        setRunFaceAgentId("");
      }

      const isRunCurrent = () => {
        const run = runsRef.current.get(conv.id);
        return Boolean(run && run.generation === gen && run.abort === ac);
      };
      const isViewingStream = () => deps.conversationRef.current?.id === conv.id;
      const setRunLabelForStream = (label: string) => {
        const run = runsRef.current.get(conv.id);
        if (run && run.generation === gen && run.abort === ac) run.runLabel = label;
        if (isViewingStream()) setRunLabel(label);
      };
      const setActiveToolForStream = (tool: string) => {
        const run = runsRef.current.get(conv.id);
        if (run && run.generation === gen && run.abort === ac) run.activeTool = tool;
        if (isViewingStream()) setRunActiveTool(tool);
      };
      const setFaceAgentForStream = (agentId: string) => {
        const run = runsRef.current.get(conv.id);
        if (run && run.generation === gen && run.abort === ac) run.faceAgentId = agentId;
        if (isViewingStream()) setRunFaceAgentId(agentId);
      };
      const ensureStreamingBubble = (agentId?: string, agentName?: string) => {
        const run = runsRef.current.get(conv.id);
        if (!run || run.generation !== gen || run.abort !== ac) return;
        if (!run.assistantIdsByAgent) run.assistantIdsByAgent = {};
        if (agentId && run.assistantIdsByAgent[agentId]) {
          const id = run.assistantIdsByAgent[agentId];
          const cur = (deps.messagesByConvRef.current.get(conv.id) ?? []).find((m) => m.id === id);
          if (cur?.streaming) {
            run.assistantId = id;
            return;
          }
        }
        // Claim unnamed streaming placeholder when present.
        if (run.assistantId) {
          const cur = (deps.messagesByConvRef.current.get(conv.id) ?? []).find((m) => m.id === run.assistantId);
          if (cur?.streaming && (!cur.agent_id || cur.agent_id === agentId)) {
            if (agentId && !cur.agent_id) {
              run.assistantIdsByAgent[agentId] = run.assistantId;
              deps.patchConvMessages(conv.id, (prev) =>
                prev.map((m) =>
                  m.id === run.assistantId
                    ? { ...m, agent_id: agentId, agent_name: agentName || m.agent_name, streaming: true }
                    : m,
                ),
              );
            }
            return;
          }
        }
        // Parallel resume: keep other agents' streaming bubbles; add one for this agent.
        const nextId = `local-asst-resume-${Date.now()}-${agentId || "x"}`;
        run.assistantId = nextId;
        if (agentId) run.assistantIdsByAgent[agentId] = nextId;
        deps.patchConvMessages(conv.id, (prev) => [
          ...prev,
          {
            id: nextId,
            role: "assistant" as const,
            content: "",
            streaming: true,
            agent_id: agentId,
            agent_name: agentName,
          },
        ]);
      };

      try {
        await subscribeConversationEvents(
          conv.id,
          {
            onBotOnline: (evt) => {
              if (!evt.agent_id) return;
              const openId = deps.conversationRef.current?.id;
              if (evt.conversation_id && openId && evt.conversation_id !== openId) return;
              deps.applyBotOnline(evt.agent_id, evt.online === true);
            },
            onAgentStart: (info) => {
              if (!isRunCurrent()) return;
              const name =
                info.agent_name ||
                (Array.isArray(nameLookup)
                  ? nameLookup.find((a) => a.id === info.agent_id)?.name
                  : nameLookup.get(info.agent_id)) ||
                info.agent_id;
              setRunLabelForStream(`${name} 正在回复…`);
              if (info.agent_id) setFaceAgentForStream(info.agent_id);
              ensureStreamingBubble(info.agent_id, name);
            },
            onToken: (text, info) => {
              if (!isRunCurrent()) return;
              ensureStreamingBubble(info?.agent_id);
              const run = runsRef.current.get(conv.id);
              const agentId = info?.agent_id;
              if (agentId && !run?.faceAgentId) setFaceAgentForStream(agentId);
              const curId =
                (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
              if (!curId) return;
              deps.patchConvMessages(conv.id, (prev) =>
                prev.map((m) => (m.id === curId ? { ...m, content: m.content + text, streaming: true } : m)),
              );
            },
            onMeta: (meta) => {
              if (!isRunCurrent()) return;
              if (meta.phase === "resumed") {
                if (isViewingStream()) {
                  setSending(true);
                  setRunLabel("正在思考…");
                }
                return;
              }
              if (meta.phase === "cancelled") {
                sealStreamingMessagesForConv(conv.id);
                setActiveToolForStream("");
                // finally clears sending when this resume gen still owns the run.
                if (isViewingStream()) {
                  setRunLabel("正在思考…");
                }
              }
              if (meta.phase === "user_saved" && typeof meta.message_id === "string") {
                stampUserSavedMessage(conv.id, meta.message_id, {
                  reply_to_id: typeof meta.reply_to_id === "string" ? meta.reply_to_id : undefined,
                  thread_root_id: typeof meta.thread_root_id === "string" ? meta.thread_root_id : undefined,
                });
              }
              if (meta.phase === "message_saved" && typeof meta.message_id === "string") {
                stampSavedMessage(
                  conv.id,
                  meta.message_id,
                  typeof meta.request_id === "string" ? meta.request_id : undefined,
                  typeof meta.agent_id === "string" ? meta.agent_id : undefined,
                );
                if (meta.sources != null) {
                  attachSourcesToStreaming(conv.id, meta.sources, meta.message_id);
                }
              } else if (meta.sources != null) {
                attachSourcesToStreaming(conv.id, meta.sources);
              }
              if (meta.phase === "task_queued") {
                deps.noteTask(conv.id, true, "正在做…");
              }
            },
            onStatus: (data) => {
              if (!isRunCurrent()) return;
              const phase = String(data.phase || "");
              const tool = typeof data.tool === "string" ? data.tool : "";
              if (phase === "tool") {
                setActiveToolForStream(tool || data.label || "tool");
              } else if (phase === "thinking" || phase === "tool_done") {
                setActiveToolForStream("");
              }
              if (typeof data.label === "string" && data.label.trim()) {
                if (phase === "tool" && tool) {
                  setRunLabelForStream(`${data.label} · ${tool}`);
                } else {
                  setRunLabelForStream(data.label);
                }
                return;
              }
              if (phase === "tool") {
                setRunLabelForStream(tool ? `正在运行命令 · ${tool}` : "正在运行命令");
              } else if (phase === "thinking" || phase === "tool_done") {
                setRunLabelForStream("正在思考…");
              }
            },
            onError: (msg, info) => {
              if (!isRunCurrent()) return;
              ensureStreamingBubble(info?.agent_id);
              const run = runsRef.current.get(conv.id);
              const agentId = info?.agent_id;
              const curId =
                (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
              deps.patchConvMessages(conv.id, (prev) =>
                prev.map((m) =>
                  m.id === curId
                    ? { ...m, streaming: false, content: m.content || `（失败）${msg}` }
                    : m,
                ),
              );
            },
            onDone: () => {
              if (!isRunCurrent()) return;
              sealStreamingMessagesForConv(conv.id, false);
              setActiveToolForStream("");
              setRunLabelForStream("正在思考…");
              void listMessages(conv.id)
                .then((msgs) => {
                  if (!isRunCurrent() && runsRef.current.has(conv.id)) return;
                  // Only replace if this resume gen already cleaned or still current after seal.
                  if (
                    deps.conversationRef.current?.id === conv.id ||
                    deps.messagesByConvRef.current.has(conv.id)
                  ) {
                    const mapped = mapApiMessages(msgs, nameLookup);
                    deps.messagesByConvRef.current.set(conv.id, mapped);
                    if (deps.conversationRef.current?.id === conv.id) {
                      setMessages(mapped);
                    }
                  }
                })
                .catch(() => {});
              void deps.refreshConversations();
            },
          },
          ac.signal,
        );
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === "AbortError") ||
          (err instanceof Error && err.name === "AbortError");
        if (aborted) return;
        if (!isRunCurrent()) return;
        console.warn("resume run failed", err);
      } finally {
        const run = runsRef.current.get(conv.id);
        // Match generation AND abort controller (same as sendUserText) so a
        // superseded resume cannot clear the interrupt replacement run's UI.
        if (run && run.generation === gen && run.abort === ac) {
          runsRef.current.delete(conv.id);
          bumpRunBusy();
          if (deps.conversationRef.current?.id === conv.id) {
            setSending(false);
          }
        }
      }
    },
    [
      attachSourcesToStreaming,
      bumpRunBusy,
      deps,
      sealStreamingMessagesForConv,
      stampSavedMessage,
      stampUserSavedMessage,
    ],
  );

  const clearAllRuns = useCallback(
    (onEach?: (convId: string, run: ConvRunState) => void) => {
      for (const [convId, run] of [...runsRef.current.entries()]) {
        onEach?.(convId, run);
        run.generation += 1;
        run.abort.abort();
      }
      runsRef.current.clear();
      bumpRunBusy();
    },
    [bumpRunBusy],
  );

  return {
    runsRef,
    runBusyTick,
    bumpRunBusy,
    attachSourcesToStreaming,
    stampSavedMessage,
    stampUserSavedMessage,
    sealStreamingMessagesForConv,
    stopCurrentRun,
    resumeActiveRun,
    clearAllRuns,
    mapApiMessages,
  };
}
