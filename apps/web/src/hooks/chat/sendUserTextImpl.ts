import { toast } from "sonner";
import type { PendingFile } from "../../components/Composer";
import {
  AttachmentMeta,
  listMessagesWithStatus,
  openPrimaryConversation,
  persistConversationMessage,
  sendMessageStream,
  uploadConversationAttachment,
  type Agent,
  type Conversation,
} from "../../api";
import {
  setOnboardingDismissed,
} from "../../components/botOnboarding";
import { buildHandoffContext } from "../../lib/app/handoff";
import { isGroupPassContent } from "../../lib/app/groupPass";
import { firstMentionedAgent, matchAgentByMentionToken, stripLeadingAtAgent } from "../../lib/app/mentions";
import { selectionKeyForConv } from "../../lib/app/conversationMessages";
import {
  shouldRegisterAsHost,
  getStoredMachineId,
  defaultMachineLabel,
} from "../../lib/clientEnv";
import { effectiveTimezone, readCachedUserSettings } from "../../lib/userSettings";
import type { LastActiveSelection, UiMessage } from "../../types/app-ui";
import type { SendMessageDeps } from "./sendMessageDeps";
import {
  chatState,
  pinChatScroll,
  replyTargetRef,
  setApprovalGate,
  setInput,
  setMessages,
  setPendingFiles,
  setReplyTarget,
  setRunActiveTool,
  setRunFaceAgentId,
  setRunLabel,
  setSending,
  viewedMessages,
} from "../../stores/chat";

export async function sendUserTextImpl(
  d: SendMessageDeps,
  rawContent: string,
  filesToSend: PendingFile[] = [],
) {
    const content = rawContent.trim();
    if ((!content && filesToSend.length === 0) || !d.authed) return;
    // Sidebar thread panel (opened via 「N 条回复」) shares this Composer. Capture it now,
    // before any await, so the send goes where the user was looking when they hit Enter.
    const threadRootAtSend = (d.openThreadRootIdRef.current || "").trim();
    const threadConvAtSend = d.conversationRef.current?.id;
    // keep-partial-next-turn: only interrupt the *current* conversation's run.
    // Supersede: seal partial locally, drop empty bubbles (no 「（已停止）」). Server
    // cancel + durable abort is left to the next send's register (cancelReason=replace).
    const viewedId = d.conversationRef.current?.id;
    let supersededBusy = false;
    if (viewedId && d.runsRef.current.has(viewedId)) {
      supersededBusy = true;
      await d.stopCurrentRun({
        localOnly: true,
        conversationId: viewedId,
      });
    } else if (
      chatState().sending ||
      chatState().taskBusy ||
      (viewedId ? d.taskConvIdsRef.current.has(viewedId) : false)
    ) {
      // Durable still busy but client map empty (SSE drop / finally raced): force
      // when_busy=replace so the API aborts the old harness instead of inbox-queue
      // (inbox → done with no tokens → empty bubble → looks like never replied).
      supersededBusy = true;
    }

    // DM: @其他 Bot → 切到对方主线程再发；原会话留下转交记录，并把近期上下文带给对方。
    let sendContent = content;
    let handoffConv: Conversation | null = null;
    let handoffContext: { role: string; content: string }[] | undefined;
    const inGroup = Boolean(d.conversationRef.current?.channel_id);
    if (!inGroup && content) {
      const mentioned = firstMentionedAgent(content, d.agents);
      const currentAid = d.conversationRef.current?.agent_id || d.agentId;
      if (mentioned && mentioned.id !== currentAid) {
        try {
          const sourceConvId = d.conversationRef.current?.id;
          const sourceAgent =
            d.agents.find((a) => a.id === currentAid) ||
            ({ id: currentAid, name: d.agentNameById.get(currentAid) || "助手" } as Agent);
          const sourceMsgs = sourceConvId
            ? d.messagesByConvRef.current.get(sourceConvId) ?? viewedMessages()
            : viewedMessages();
          handoffContext = buildHandoffContext(sourceMsgs, sourceAgent.name || "助手");

          // 原 Bot 会话留下这次转交，下次回来仍看得见、模型也读得到。
          if (sourceConvId) {
            try {
              const persisted = await persistConversationMessage(sourceConvId, content);
              d.patchConvMessages(sourceConvId, (prev) => [
                ...prev,
                {
                  id: persisted.id,
                  role: "user",
                  content,
                  created_at: persisted.created_at,
                },
              ]);
            } catch {
              d.patchConvMessages(sourceConvId, (prev) => [
                ...prev,
                { id: `local-handoff-${Date.now()}`, role: "user", content },
              ]);
            }
          }

          d.snapshotViewedMessages();
          d.selectGenRef.current += 1;
          d.setAgentId(mentioned.id);
          const targetConv = await openPrimaryConversation(mentioned.id);
          d.conversationRef.current = targetConv;
          d.setConversation(targetConv);
          const listed = await listMessagesWithStatus(targetConv.id);
          const mapped = d.mapApiMessages(listed.messages, d.agentNameById);
          d.messagesByConvRef.current.set(targetConv.id, mapped);
          setMessages(mapped);
          d.noteTask(
            targetConv.id,
            Boolean(listed.task_active),
            listed.task_active ? "正在做…" : undefined,
          );
          handoffConv = targetConv;
          sendContent = stripLeadingAtAgent(content, mentioned);
          d.saveLastActiveSelection({ kind: "agent", id: mentioned.id });
          toast.message(`已转给 ${mentioned.name}（已带上此前对话）`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
          return;
        }
      }
    }

    setSending(true);
    setInput("");
    setPendingFiles([]);
    d.setStatus("");
    setRunLabel("正在思考…");
    // Choosing / answering onboarding hides the card for this conversation
    setOnboardingDismissed(d.onboardingKey);
    d.setOnboardingDismissedState(true);
    // After send always jump to bottom (common chat pattern).
    pinChatScroll();
    const localAttachments: AttachmentMeta[] = filesToSend.map((f, i) => {
      const mime = f.file.type || "application/octet-stream";
      const meta: AttachmentMeta = {
        id: `local-${i}`,
        name: f.file.name,
        mime,
        size: f.file.size,
        path: "",
      };
      // Optimistic image preview via blob: until upload returns auth url.
      if (/^image\//i.test(mime)) {
        try {
          meta.url = URL.createObjectURL(f.file);
        } catch {
          /* ignore */
        }
      }
      return meta;
    });
    const activeReply = replyTargetRef.current;
    // thread_root_id is set ONLY when the sidebar thread panel is open (「N 条回复」) and we are
    // still in that conversation (not a DM @handoff into another Bot).
    // PM: explicit 「回复」 on the mainline is quote only — reply_to_id, no thread_root_id.
    // Diverting into thread_root would hide the send (and Bot answer) from the main timeline.
    const sendThreadRootId =
      threadRootAtSend && !handoffConv && d.conversationRef.current?.id === threadConvAtSend
        ? threadRootAtSend
        : "";
    const threadStamp = sendThreadRootId ? { thread_root_id: sendThreadRootId } : {};
    const userMsg: UiMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: sendContent || (filesToSend.length ? `（${filesToSend.length} 个附件）` : ""),
      attachments: localAttachments.length ? localAttachments : undefined,
      ...(activeReply?.id ? { reply_to_id: activeReply.id } : {}),
      ...threadStamp,
    };
    d.localUserIdRef.current = userMsg.id;
    // Clear reply bar after capturing (composer already cleared input above).
    if (activeReply) {
      replyTargetRef.current = null;
      setReplyTarget(null);
    }
    const assistantId = `local-asst-${Date.now()}`;
    const appendOptimistic = (prev: UiMessage[]) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant" as const,
        content: "",
        streaming: true,
        // No reply_to_id: Bot answers are not quotes (only explicit「回复」).
        // thread_root_id only for sidebar-thread sends (stays in panel); mainline stays unset.
        ...threadStamp,
      },
    ];
    const optTargetId = handoffConv?.id || d.conversationRef.current?.id || viewedId;
    if (optTargetId) {
      d.patchConvMessages(optTargetId, appendOptimistic);
    } else {
      setMessages(appendOptimistic(viewedMessages()));
    }
    const mentionAgentIds = (() => {
      if (!d.conversationRef.current?.channel_id || !d.groupMentionMembers?.length) {
        return undefined as string[] | undefined;
      }
      const re = /@([^\s@]+)/g;
      const ids: string[] = [];
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      let everyone = false;
      while ((m = re.exec(sendContent)) !== null) {
        const tok = m[1].replace(/[.,!?;:，。！？；：]+$/u, "");
        const lower = tok.toLowerCase();
        if (lower === "everyone" || lower === "all") {
          everyone = true;
          continue;
        }
        const hit = matchAgentByMentionToken(tok, d.groupMentionMembers);
        if (hit && !seen.has(hit.id)) {
          seen.add(hit.id);
          ids.push(hit.id);
        }
      }
      if (everyone) {
        return d.groupMentionMembers.map((a) => a.id);
      }
      // Specific @ → those d.agents. No @ → omit agent_ids so server AutoPick runs.
      // (Legacy sent all member ids here, which made the API treat the turn as
      // explicit addressing and skip AutoPick — every bot answered.)
      if (ids.length) return ids;
      return undefined;
    })();
    let sendSelection: LastActiveSelection | null = null;
    let sendHadError = false;
    let streamConvId: string | null = null;
    let gen = 0;
    let ac: AbortController | undefined;
    try {
      const conv = handoffConv ?? (await d.ensureConversation());
      streamConvId = conv.id;
      sendSelection = conv.channel_id
        ? { kind: "channel", id: conv.channel_id }
        : { kind: "agent", id: conv.agent_id };
      // Ensure buffer has optimistic messages under the real conv id (first send may create it).
      if (!d.messagesByConvRef.current.has(streamConvId) || d.conversationRef.current?.id === streamConvId) {
        d.messagesByConvRef.current.set(streamConvId, viewedMessages());
      }
      void d.refreshConversations();
      void d.refreshAgents().catch(() => {});
      let uploaded: AttachmentMeta[] = [];
      if (filesToSend.length > 0) {
        uploaded = await Promise.all(
          filesToSend.map((pf) => uploadConversationAttachment(conv.id, pf.file)),
        );
        d.patchConvMessages(streamConvId, (prev) =>
          prev.map((m) => {
            if (m.id !== userMsg.id) return m;
            for (const a of m.attachments || []) {
              if (a.url && a.url.startsWith("blob:")) {
                try {
                  URL.revokeObjectURL(a.url);
                } catch {
                  /* ignore */
                }
              }
            }
            return { ...m, attachments: uploaded };
          }),
        );
      }
      ac = new AbortController();
      gen = (d.runsRef.current.get(streamConvId)?.generation ?? 0) + 1;
      d.runsRef.current.set(streamConvId, {
        abort: ac,
        generation: gen,
        assistantId,
        runLabel: "正在思考…",
        activeTool: "",
        faceAgentId: "",
        selectionKey: selectionKeyForConv(conv),
      });
      d.bumpRunBusy();
      const isRunCurrent = () => {
        const run = d.runsRef.current.get(streamConvId!);
        // Match abort too (same as finally) so a superseded slot that somehow
        // kept the same generation cannot steal tokens from the replacement.
        return Boolean(run && run.generation === gen && run.abort === ac);
      };
      const isViewingStream = () => d.conversationRef.current?.id === streamConvId;
      const setRunLabelForStream = (label: string) => {
        const run = d.runsRef.current.get(streamConvId!);
        if (run && run.generation === gen && run.abort === ac) run.runLabel = label;
        if (isViewingStream()) setRunLabel(label);
      };
      const setActiveToolForStream = (tool: string) => {
        const run = d.runsRef.current.get(streamConvId!);
        if (run && run.generation === gen && run.abort === ac) run.activeTool = tool;
        if (isViewingStream()) setRunActiveTool(tool);
      };
      const setFaceAgentForStream = (agentId: string) => {
        const run = d.runsRef.current.get(streamConvId!);
        if (run && run.generation === gen && run.abort === ac) run.faceAgentId = agentId;
        if (isViewingStream()) setRunFaceAgentId(agentId);
      };
      if (isViewingStream()) {
        setRunActiveTool("");
        setRunFaceAgentId("");
      }
      await sendMessageStream(
        conv.id,
        sendContent,
        {
          onAgentStart: (info) => {
            if (!isRunCurrent()) return;
            const name =
              info.agent_name ||
              d.agents.find((a) => a.id === info.agent_id)?.name ||
              info.agent_id;
            setRunLabelForStream(`${name} 正在回复…`);
            if (info.agent_id) setFaceAgentForStream(info.agent_id);
            d.patchConvMessages(streamConvId!, (prev) => {
              const run = d.runsRef.current.get(streamConvId!);
              if (!run) return prev;
              if (!run.assistantIdsByAgent) run.assistantIdsByAgent = {};
              const existingId = run.assistantIdsByAgent[info.agent_id];
              if (existingId && prev.some((m) => m.id === existingId)) {
                run.assistantId = existingId;
                return prev.map((m) =>
                  m.id === existingId
                    ? { ...m, agent_id: info.agent_id, agent_name: name, streaming: true }
                    : m,
                );
              }
              const curId = run.assistantId;
              const cur = curId ? prev.find((m) => m.id === curId) : undefined;
              // First agent: stamp identity on the placeholder bubble.
              if (cur && !cur.content && !cur.agent_id) {
                run.assistantIdsByAgent[info.agent_id] = curId!;
                return prev.map((m) =>
                  m.id === curId
                    ? { ...m, agent_id: info.agent_id, agent_name: name, streaming: true }
                    : m,
                );
              }
              // Parallel candidates: add a new bubble; do NOT seal other agents' streams.
              const nextId = `local-asst-${Date.now()}-${info.index ?? 0}-${info.agent_id}`;
              run.assistantIdsByAgent[info.agent_id] = nextId;
              run.assistantId = nextId;
              return [
                ...prev,
                {
                  id: nextId,
                  role: "assistant",
                  content: "",
                  streaming: true,
                  agent_id: info.agent_id,
                  agent_name: name,
                  // Sidebar-thread send: follow-on agent bubbles stay in the panel.
                  // Mainline (incl. 「回复」): no thread_root_id.
                  ...threadStamp,
                },
              ];
            });
          },
          onToken: (text, info) => {
            if (!isRunCurrent()) return;
            const run = d.runsRef.current.get(streamConvId!);
            const agentId = info?.agent_id;
            if (agentId && !run?.faceAgentId) setFaceAgentForStream(agentId);
            const curId =
              (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
            if (!curId) return;
            d.patchConvMessages(streamConvId!, (prev) =>
              prev.map((m) => (m.id === curId ? { ...m, content: m.content + text } : m)),
            );
          },
          onMeta: (meta) => {
            if (!isRunCurrent()) return;
            if (typeof meta.request_id === "string" && meta.request_id) {
              d.lastRequestIdRef.current = meta.request_id;
            } else if (typeof meta.run_id === "string" && meta.run_id) {
              d.lastRequestIdRef.current = meta.run_id;
            }
            if (meta.waiting_approval && streamConvId && d.lastRequestIdRef.current) {
              setApprovalGate({
                conversationId: streamConvId,
                requestId: d.lastRequestIdRef.current,
              });
            }
            if (meta.phase === "cancelled") {
              d.sealStreamingMessagesForConv(streamConvId!);
              setActiveToolForStream("");
              // Do not setSending(false) here: localOnly supersede keeps d.runsRef and
              // a newer turn may already own the processing indicator. finally clears
              // sending only when this gen+abort still owns the map entry.
              if (isViewingStream()) {
                setRunLabel("正在思考…");
              }
            }
            if (meta.phase === "agent_skipped") {
              const skipId = typeof meta.agent_id === "string" ? meta.agent_id : "";
              // Server is authoritative: drop the in-flight bubble for this agent even if
              // streamed tokens were not yet classified as PASS (e.g. mid-stream / wrappers).
              d.patchConvMessages(streamConvId!, (prev) => {
                const run = d.runsRef.current.get(streamConvId!);
                const mappedId = skipId && run?.assistantIdsByAgent?.[skipId];
                return prev.filter((m) => {
                  const dropMapped = Boolean(mappedId && m.id === mappedId);
                  const dropPassForAgent =
                    Boolean(skipId) &&
                    m.agent_id === skipId &&
                    (m.streaming || isGroupPassContent(m.content || ""));
                  const drop = dropMapped || dropPassForAgent;
                  if (drop && run) {
                    if (run.assistantId === m.id) run.assistantId = "";
                    if (skipId && run.assistantIdsByAgent?.[skipId] === m.id) {
                      delete run.assistantIdsByAgent[skipId];
                    }
                  }
                  return !drop;
                });
              });
            }
            if (meta.phase === "user_saved" && typeof meta.message_id === "string") {
              d.stampUserSavedMessage(streamConvId!, meta.message_id, {
                reply_to_id: typeof meta.reply_to_id === "string" ? meta.reply_to_id : undefined,
                thread_root_id: typeof meta.thread_root_id === "string" ? meta.thread_root_id : undefined,
                // Adopt server thread_root only when we intentionally POSTed one.
                adoptThreadRoot: Boolean(sendThreadRootId),
              });
            }
            if (meta.phase === "message_saved" && typeof meta.message_id === "string") {
              d.stampSavedMessage(
                streamConvId!,
                meta.message_id,
                typeof meta.request_id === "string" ? meta.request_id : undefined,
                typeof meta.agent_id === "string" ? meta.agent_id : undefined,
              );
              if (meta.sources != null) {
                d.attachSourcesToStreaming(streamConvId!, meta.sources, meta.message_id);
              }
            } else if (meta.sources != null) {
              d.attachSourcesToStreaming(streamConvId!, meta.sources);
            }
            if (meta.phase === "task_queued") {
              d.noteTask(streamConvId!, true, "正在做…");
            }
          },
          onStatus: (data) => {
            if (!isRunCurrent()) return;
            const phase = String(data.phase || "");
            const tool = typeof data.tool === "string" ? data.tool : "";
            if (phase === "waiting_approval") {
              setActiveToolForStream("");
              setRunLabelForStream(
                typeof data.label === "string" && data.label.trim()
                  ? data.label
                  : "等待确认后继续",
              );
              const rid = d.lastRequestIdRef.current;
              if (rid && streamConvId) {
                setApprovalGate({ conversationId: streamConvId, requestId: rid });
              }
              return;
            }
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
            sendHadError = true;
            d.setStatus(`错误：${msg}`);
            setActiveToolForStream("");
            setRunLabelForStream("正在思考…");
            const run = d.runsRef.current.get(streamConvId!);
            const agentId = info?.agent_id;
            const curId =
              (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
            d.patchConvMessages(streamConvId!, (prev) =>
              prev.map((m) =>
                m.id === curId
                  ? { ...m, streaming: false, content: m.content || `（失败）${msg}` }
                  : m,
              ),
            );
          },
          onDone: (data) => {
            if (!isRunCurrent()) return;
            const doneFailed =
              data?.ok === false &&
              !data?.waiting_approval &&
              !data?.cancelled &&
              typeof data?.error === "string" &&
              Boolean((data.error as string).trim());
            const failText =
              doneFailed && typeof data?.error === "string"
                ? `（失败）${(data.error as string).trim()}`
                : "";
            const inboxQueued = Boolean(data?.inbox);
            // Parallel group: seal every streaming bubble; drop PASS silence
            // (keep empty streaming bubble when doneFailed so failure text can show).
            // Inbox queue: drop empty placeholders — no tokens will arrive on this SSE.
            d.patchConvMessages(streamConvId!, (prev) =>
              prev
                .filter((m) => {
                  if (inboxQueued && m.role === "assistant" && !(m.content || "").trim() && (m.streaming || m.id === assistantId)) {
                    return false;
                  }
                  if (!(m.streaming && isGroupPassContent(m.content || ""))) return true;
                  return Boolean(doneFailed);
                })
                .map((m) => {
                  if (!m.streaming) return m;
                  const content =
                    !(m.content || "").trim() && failText ? failText : m.content;
                  return { ...m, streaming: false, content };
                }),
            );
            setActiveToolForStream("");
            if (data?.waiting_approval && streamConvId) {
              const rid =
                (typeof data.request_id === "string" && data.request_id) ||
                d.lastRequestIdRef.current;
              if (rid) {
                setApprovalGate({ conversationId: streamConvId, requestId: rid });
                setRunLabelForStream("等待确认后继续");
              }
            } else if (!d.taskConvIdsRef.current.has(streamConvId!)) {
              setRunLabelForStream("正在思考…");
            }
            void d.refreshConversations();
          },
        },
        ac.signal,
        uploaded.length ? uploaded : undefined,
        mentionAgentIds,
        (() => {
          // Browser must not send a stale desktop machine_id from localStorage —
          // that makes the model think the user is on that Mac and invent Downloads contents.
          const tz = effectiveTimezone(readCachedUserSettings());
          if (!shouldRegisterAsHost(d.clientEnv)) {
            return { ...d.clientEnv, machine_id: undefined, machine_label: undefined, timezone: tz };
          }
          const mid = getStoredMachineId() || undefined;
          const fromList = mid ? d.machines.find((x) => x.id === mid)?.label : undefined;
          const machine_label =
            (fromList || d.deviceDisplayName || defaultMachineLabel(d.clientEnv) || "").trim() ||
            undefined;
          return { ...d.clientEnv, machine_id: mid, machine_label, timezone: tz };
        })(),
        handoffContext,
        activeReply?.id,
        sendThreadRootId || undefined,
        supersededBusy ? "replace" : undefined,
      );
      if (!sendHadError && sendSelection) {
        d.saveLastActiveSelection(sendSelection);
      }
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (aborted) {
        // d.stopCurrentRun already sealed bubbles; ignore stale aborts from interrupt-and-send.
        return;
      }
      if (streamConvId && !((d.runsRef.current.get(streamConvId)?.generation ?? 0) === gen)) return;
      const msg = err instanceof Error ? err.message : String(err);
      d.setStatus(`发送失败：${msg}`);
      if (streamConvId) {
        const curId = d.runsRef.current.get(streamConvId)?.assistantId ?? assistantId;
        d.patchConvMessages(streamConvId, (prev) =>
          prev.map((m) =>
            m.id === curId
              ? { ...m, streaming: false, content: m.content || `（失败）${msg}` }
              : m,
          ),
        );
        if (d.conversationRef.current?.id === streamConvId) {
          setRunLabel("正在思考…");
        }
      } else {
        setRunLabel("正在思考…");
      }
    } finally {
      if (streamConvId) {
        const run = d.runsRef.current.get(streamConvId);
        // Match generation AND abort controller so a superseded turn's late
        // finally cannot delete the interrupt replacement run.
        if (run && run.generation === gen && run.abort === ac) {
          d.runsRef.current.delete(streamConvId);
          d.bumpRunBusy();
          if (d.conversationRef.current?.id === streamConvId) {
            setSending(false);
          }
        }
      } else if (
        d.conversationRef.current?.id === viewedId &&
        !(viewedId && d.runsRef.current.has(viewedId))
      ) {
        // No streamConvId yet (failed before register) and no superseding run.
        setSending(false);
      }
    }
}
