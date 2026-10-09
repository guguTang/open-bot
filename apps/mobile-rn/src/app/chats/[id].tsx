import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as api from "@/api";
import { useQueryClient } from "@tanstack/react-query";

import { useAgents, useMessages } from "@/queries";
import { qk } from "@/queries/client";
import type { Agent, AttachmentMeta, Message, ReactionUpdatedEvent } from "@/api/types";
import { BotOnboarding } from "@/components/BotOnboarding";
import { Composer } from "@/components/Composer";
import { MessageBubble, type UiMessage } from "@/components/MessageBubble";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { FeedbackModal } from "@/components/chat/FeedbackModal";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { QuoteBar } from "@/components/chat/QuoteBar";
import { RunStatus, deriveRunLabel } from "@/components/RunStatus";
import { ScreenHeader } from "@/components/ScreenScaffold";
import { ErrorAlert, MessageSkeleton } from "@/components/states";
import { makeKey, type PickedFile } from "@/lib/attachments";
import {
  firstAttachmentIssue,
  mentionMembersOf,
  resolveMentionedAgents,
  shouldShowOnboarding,
} from "@/lib/chat";
import {
  onboardingStorageKey,
  setOnboardingDismissed,
  type OnboardingOption,
} from "@/lib/onboarding";
import { friendlyOpenError, parseSandboxHref, previewTitleFromPath } from "@/lib/workspace";
import { useRealtimeEvents } from "@/providers/realtime";
import { useSecretPrompt } from "@/providers/secretPrompt";

const STREAMING_ID = "__streaming__";

/** 稳定空数组引用，避免 `?? []` 让下游 memo 每次都失效。 */
const EMPTY_AGENTS: Agent[] = [];

type Streaming = { text: string; agentId?: string; agentName?: string };

/**
 * 服务端消息 → 气泡用的形状。
 *
 * 单独抽出来是因为消息会在三处进来：首屏加载、发送后重新拉取、WS 事件补拉。
 * 三处各写一遍字段映射，迟早会漏掉一个（漏 `reactions` 就表现为「点了没反应」）。
 */
function toUiMessage(m: Message): UiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(m.agent_id ? { agent_id: m.agent_id } : {}),
    ...(m.reactions?.length ? { reactions: m.reactions } : {}),
    ...(m.request_id ? { request_id: m.request_id } : {}),
    ...(m.reply_to_id ? { reply_to_id: m.reply_to_id } : {}),
    ...(m.thread_root_id ? { thread_root_id: m.thread_root_id } : {}),
    ...(m.handoff ? { handoff: m.handoff } : {}),
    ...(m.host_confirm ? { host_confirm: m.host_confirm } : {}),
  };
}

export default function ChatScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id ?? "");
  const { refresh: refreshSecrets } = useSecretPrompt();

  const [pendingBubbles, setPendingBubbles] = useState<UiMessage[]>([]);
  const [title, setTitle] = useState("");
  const [memberIds, setMemberIds] = useState<string[] | undefined>();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [sending, setSending] = useState(false);
  const [runLabel, setRunLabel] = useState("");
  /** 已经完成首次加载的会话 id。loading 由它派生，避免在 effect 里同步 setState。 */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== conversationId;
  const [error, setError] = useState<string | null>(null);
  /** 用户在本会话里主动关掉引导卡（选了方向、发过消息、或点了关闭）。 */
  const [onboardingOff, setOnboardingOff] = useState(false);
  const [filePreview, setFilePreview] = useState<{
    open: boolean;
    title: string;
    content: string | null;
    loading: boolean;
    error: string | null;
  }>({ open: false, title: "", content: null, loading: false, error: null });

  const queryClient = useQueryClient();
  const messagesQuery = useMessages(conversationId);
  const agentsQuery = useAgents();

  /**
   * 三个来源拼成最终要渲染的列表：服务端已落库 + 本地乐观气泡 + 正在流式的那条。
   * 顺序即时间顺序 —— 乐观气泡发出去就在最末尾，流式块也追加在最末尾。
   */
  const messages = useMemo<UiMessage[]>(() => {
    const server = (messagesQuery.data?.messages ?? []).map(toUiMessage);
    return [...server, ...pendingBubbles];
  }, [messagesQuery.data, pendingBubbles]);

  const agents = useMemo(() => agentsQuery.data ?? EMPTY_AGENTS, [agentsQuery.data]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /** 长按打开操作面板的目标消息 */
  const [sheetMessage, setSheetMessage] = useState<UiMessage | null>(null);
  /** 反馈弹窗的目标消息 */
  const [feedbackMessage, setFeedbackMessage] = useState<UiMessage | null>(null);
  /** 反馈来源：面板主动打开 vs 负表情联动 */
  const [feedbackSource, setFeedbackSource] = useState<"feedback_menu" | "reaction_followup">(
    "feedback_menu"
  );
  /** 引用回复的目标；非空时作曲框上方显示引用条 */
  const [replyTo, setReplyTo] = useState<UiMessage | null>(null);
  /** 展开的线程根消息 id */
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  /** 作曲框补全用的数据源：/ 技能、@routine:、@mcp: */
  const [agentSkills, setAgentSkills] = useState<{ name: string; description?: string }[]>([]);
  const [routines, setRoutines] = useState<{ name: string }[]>([]);
  const [mcpNames, setMcpNames] = useState<{ name: string }[]>([]);

  const primaryAgent = useMemo(() => {
    if (memberIds?.length) return null;
    const last = messages.find((m) => m.role === "assistant" && m.agent_id);
    const fromMsg = last ? agents.find((a) => a.id === last.agent_id) : undefined;
    return fromMsg ?? agents[0] ?? null;
  }, [agents, memberIds, messages]);

  /**
   * 消息本体是服务端状态，交给 TanStack Query。
   *
   * 保留在本地 state 的只有两类**服务端还不知道的东西**：
   * - `pendingBubbles`：刚发出去、还没落库的用户消息（乐观气泡）
   * - `streaming`：正在流式输出的助手回复
   * 两者都会在拿到服务端结果后清掉。分成这三份而不是混在一个数组里，
   * 是为了让「哪些是真相」一目了然 —— 否则重取时很容易把流式内容一起冲掉。
   */
  /**
   * 重新拉消息并清掉乐观气泡。
   *
   * 单独抽出来是因为 `reload` 自己内部也要用它（重新接管 run 流结束时）。
   * 如果在 `reload` 的函数体里直接引用 `reload`，会构成自引用 ——
   * 回调闭包里的 `reload` 指向的是当次渲染的那个实例，
   * 依赖一变（比如切了会话）就可能拿着旧的。
   */
  const refreshMessages = useCallback(async (): Promise<{ runActive: boolean }> => {
    const { data } = await messagesQuery.refetch();
    setPendingBubbles([]);
    return { runActive: Boolean(data?.run_active) };
  }, [messagesQuery]);

  const reload = useCallback(async () => {
    // 用 refetch 的返回值，而不是闭包里的 messagesQuery.data ——
    // 那是本次渲染时的旧值，refetch 完不会自己更新。
    const { runActive } = await refreshMessages();
    if (!runActive) return;

    // 服务端还有 run 在跑（App 被杀掉后重开）→ 重新挂回流
    const ctrl = new AbortController();
    setSending(true);
    setRunLabel("正在思考…");
    api
      .subscribeConversationEvents(
        conversationId,
        {
          onAgentStart: (info) =>
            setStreaming({ text: "", agentId: info.agent_id, agentName: info.agent_name }),
          onToken: (t) =>
            setStreaming((prev) => ({ ...(prev ?? { text: "" }), text: (prev?.text ?? "") + t })),
          onDone: () => {
            setStreaming(null);
            setSending(false);
            setRunLabel("");
            void refreshMessages().then(() => undefined);
          },
          onError: (m) => setError(m),
        },
        ctrl.signal
      )
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "订阅中断");
        }
      });
  }, [conversationId, refreshMessages]);

  useEffect(() => {
    if (!conversationId) return;
    // 豁免 react-hooks/set-state-in-effect：reload 及其 then 链里的所有
    // setState 都发生在 `await` 网络往返之后，不是渲染期同步写状态。
    // 规则无法跨 async 边界证明这点，只能在此显式说明。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
      .then(async () => {
        // 消息由 useMessages 自己管；这里只补会话元信息（标题、是否群聊）
        const [convList, channelList] = await Promise.all([
          api.listConversations().catch(() => []),
          api.listChannels().catch(() => []),
        ]);
        const conv = convList.find((c) => c.id === conversationId);
        if (conv) {
          setTitle(conv.title);
          if (conv.channel_id) {
            setMemberIds(channelList.find((c) => c.id === conv.channel_id)?.members);
          }
        }
        setLoadedFor(conversationId);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "加载失败");
        // 失败也要标记已加载，否则 loading 永远转不下去，用户看到的是死转圈
        setLoadedFor(conversationId);
      });
    return () => abortRef.current?.abort();
  }, [conversationId, reload]);

  /**
   * 作曲框的补全数据源。
   *
   * 技能是 per-bot 的，换会话（换一个助手）就得换一份，所以跟着 primaryAgent 走。
   * 例行任务和插件是账号级的，不会变，挂在助手下面一起拉省一次请求。
   * 三者都拉不到也不能影响聊天 —— 补全只是锦上添花，失败就当没有。
   */
  useEffect(() => {
    const agentId = primaryAgent?.id;
    if (!agentId) return;
    let cancelled = false;
    void (async () => {
      const [skills, routineList, mcpList] = await Promise.all([
        api.listAgentSkills(agentId).catch(() => []),
        api.listRoutines().catch(() => []),
        api.listMCPServers().catch(() => []),
      ]);
      if (cancelled) return;
      setAgentSkills(skills.map((s) => ({ name: s.name, description: s.description })));
      setRoutines(routineList.map((r) => ({ name: r.name })));
      setMcpNames(mcpList.map((m) => ({ name: m.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryAgent?.id]);

  // 流式输出时贴着底部
  useEffect(() => {
    if (streaming?.text) scrollRef.current?.scrollToEnd({ animated: true });
  }, [streaming?.text]);

  const visible = useMemo(() => {
    // 主时间线只留没有 thread_root_id 的消息，以及当前展开的那条线程的全部内容。
    // 与 Web 端一致：线程回复挂在根消息下面，不平铺进主时间线。
    const mainline = messages.filter((m) => {
      if (threadRootId) return true;
      return !m.thread_root_id;
    });
    const base = threadRootId
      ? messages.filter((m) => m.id === threadRootId || m.thread_root_id === threadRootId)
      : mainline;
    if (!streaming) return base;
    const isSummary = streaming.text === "";
    if (isSummary && base.length > 0) return base;
    return [
      ...base,
      {
        id: STREAMING_ID,
        role: "assistant",
        content: streaming.text,
        streaming: true,
        ...(streaming.agentId ? { agent_id: streaming.agentId } : {}),
        ...(streaming.agentName ? { agent_name: streaming.agentName } : {}),
      },
    ];
  }, [messages, streaming, threadRootId]);

  /** 每条根消息下面挂了几条线程回复，用来渲染「N 条回复」。 */
  const threadCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of messages) {
      if (m.thread_root_id) out[m.thread_root_id] = (out[m.thread_root_id] ?? 0) + 1;
    }
    return out;
  }, [messages]);

  const messageById = useMemo(() => {
    const map = new Map<string, UiMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  /**
   * 表情变化以服务端返回的 count / me 为准写回本地。
   * 乐观值只是让点击手感不拖沓，拿到权威值后必须替换，否则多端同时点表情会一直不一致。
   */
  /**
   * 表情变化以服务端返回的 count / me 为准。
   *
   * 写的是 **query 缓存**而不是本地 state：消息本体归 TanStack Query 管，
   * 只有还没落库的乐观气泡才在 `pendingBubbles` 里。所以这里必须改缓存，
   * 否则点表情会「没反应」——缓存没变，下次重取又回到旧值。
   */
  const onReactionChange = useCallback(
    (messageId: string, evt: { emoji: string; count: number; me: boolean; action: string }) => {
      queryClient.setQueryData<{ messages: Message[]; run_active?: boolean }>(
        qk.messages(conversationId),
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.map((m) => {
              if (m.id !== messageId) return m;
              const rest = (m.reactions ?? []).filter((r) => r.emoji !== evt.emoji);
              const next =
                evt.count > 0
                  ? [...rest, { emoji: evt.emoji, count: evt.count, me: evt.me }]
                  : rest;
              return { ...m, reactions: next };
            }),
          };
        }
      );
    },
    [conversationId, queryClient]
  );

  /**
   * 跨端表情同步：另一台设备（或 Web 端）给当前会话的消息点了表情，
   * 服务端通过全局 WS 推过来，这里按事件里的权威值写回本地。
   * 没有它就会出现「在这台设备点了没反应、在另一台又不同步」。
   */
  useRealtimeEvents(
    useCallback(
      (evt) => {
        if (evt.type !== "reaction_updated") return;
        const e = evt as ReactionUpdatedEvent;
        if (e.conversation_id !== conversationId) return;
        onReactionChange(e.message_id, e);
      },
      [conversationId, onReactionChange]
    )
  );

  const openFeedback = useCallback(
    (messageId: string, source: "feedback_menu" | "reaction_followup") => {
      setSheetMessage(null);
      setFeedbackSource(source);
      setFeedbackMessage(messageById.get(messageId) ?? null);
    },
    [messageById]
  );

  const startReply = useCallback((message: UiMessage) => {
    setSheetMessage(null);
    setReplyTo(message);
  }, []);

  const submitReaction = useCallback(
    async (message: UiMessage, emoji: string) => {
      try {
        const already = (message.reactions ?? []).find((r) => r.emoji === emoji)?.me ?? false;
        const evt = already
          ? await api.deleteReaction(message.id, emoji)
          : await api.toggleReaction(message.id, emoji);
        onReactionChange(message.id, evt);
        // 只有「新增负表情」才追问原因；取消表情不打扰用户。
        if (!already && api.NEGATIVE_REACTION_EMOJIS.includes(emoji as never)) {
          openFeedback(message.id, "reaction_followup");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "表情操作失败");
      }
    },
    [onReactionChange, openFeedback]
  );

  const requestAttach = useCallback(async (source: "files" | "images" | "camera") => {
    const picked: PickedFile[] = [];
    if (source === "files") {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      picked.push(
        ...res.assets.map((a) => ({
          key: makeKey(a.name ?? "file"),
          uri: a.uri,
          name: a.name ?? "file",
          mime: a.mimeType ?? "application/octet-stream",
          ...(a.size != null ? { size: a.size } : {}),
        }))
      );
    } else if (source === "images") {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
      });
      if (res.canceled) return;
      picked.push(
        ...res.assets.map((a) => ({
          key: makeKey(a.fileName ?? `photo-${a.assetId ?? Date.now()}.jpg`),
          uri: a.uri,
          name: a.fileName ?? `photo-${a.assetId ?? Date.now()}.jpg`,
          mime: a.mimeType ?? "image/jpeg",
          ...(a.fileSize != null ? { size: a.fileSize } : {}),
        }))
      );
    } else {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError("没有相机权限，无法拍照");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"] });
      if (res.canceled) return;
      const a = res.assets[0];
      picked.push({
        key: makeKey(a.fileName ?? `photo-${a.assetId ?? Date.now()}.jpg`),
        uri: a.uri,
        name: a.fileName ?? `photo-${a.assetId ?? Date.now()}.jpg`,
        mime: a.mimeType ?? "image/jpeg",
        ...(a.fileSize != null ? { size: a.fileSize } : {}),
      });
    }
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
  }, []);

  const send = useCallback(
    async (overrideText?: string): Promise<void> => {
      const content = (overrideText ?? draft).trim();
      if (sending || uploading || !conversationId) return;

      const issue = firstAttachmentIssue(files);
      if (issue) {
        setError(issue);
        return;
      }
      if (!content && files.length === 0) return;

      setError(null);
      setOnboardingOff(true);

      // 附件先上传拿到 AttachmentMeta，再随消息体一起提交
      let uploaded: AttachmentMeta[] = [];
      if (files.length) {
        setUploading(true);
        try {
          for (const f of files) {
            uploaded.push(await api.uploadConversationAttachment(conversationId, f));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "附件上传失败");
          setUploading(false);
          return;
        }
        setUploading(false);
      }

      setDraft("");
      setFiles([]);
      // 引用和线程目标只作用于这一条消息，发完就清掉，
      // 否则下一条会莫名其妙继续挂在上一段对话下面。
      setReplyTo(null);
      setSending(true);
      setStreaming({ text: "" });
      setRunLabel("正在思考…");

      // 本地先插一条，拿到即时的视觉反馈
      const optimistic: UiMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        content,
        ...(uploaded.length ? { attachments: uploaded } : {}),
      };
      setPendingBubbles((prev) => [...prev, optimistic]);
      scrollRef.current?.scrollToEnd({ animated: true });

      const mentioned = resolveMentionedAgents(content, agents);
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        await api.sendMessageStream(
          conversationId,
          content,
          {
            onAgentStart: (info) =>
              setStreaming({ text: "", agentId: info.agent_id, agentName: info.agent_name }),
            onToken: (t) =>
              setStreaming((prev) => ({ ...(prev ?? { text: "" }), text: (prev?.text ?? "") + t })),
            onStatus: (data) => setRunLabel((cur) => deriveRunLabel(data, cur || "正在思考…")),
            onMeta: (meta) => {
              if (meta.phase === "cancelled") setRunLabel("已停止");
            },
            onError: (m) => setError(m),
            onDone: () => {
              setStreaming(null);
              setSending(false);
              setRunLabel("");
              // 以服务端落库结果为准，避免本地拼的消息缺 id / 时间戳
              void reload().catch(() => undefined);
              void refreshSecrets();
            },
          },
          ctrl.signal,
          {
            ...(uploaded.length ? { attachments: uploaded } : {}),
            ...(mentioned.length ? { agentIds: mentioned.map((a) => a.id) } : {}),
            ...(replyTo ? { replyToId: replyTo.id } : {}),
            // 在线程里回复时沿用根消息，否则这条会掉回主时间线
            ...(threadRootId ? { threadRootId } : {}),
          }
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // 用户主动停止：服务端 run 仍在跑，重新拉一次拿最终结果
          setStreaming(null);
          setSending(false);
          setRunLabel("");
          void reload().catch(() => undefined);
        } else {
          setError(err instanceof Error ? err.message : "发送失败");
          setSending(false);
          setStreaming(null);
        }
      } finally {
        abortRef.current = null;
      }
    },
    [
      conversationId,
      draft,
      files,
      sending,
      uploading,
      agents,
      reload,
      refreshSecrets,
      replyTo,
      threadRootId,
    ]
  );

  const stop = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    await api.cancelConversationRun(conversationId).catch(() => undefined);
  }, [conversationId]);

  const dismissOnboarding = useCallback((): void => {
    if (!primaryAgent) return;
    setOnboardingOff(true);
    setOnboardingDismissed(onboardingStorageKey(conversationId, primaryAgent.id));
  }, [conversationId, primaryAgent]);

  /**
   * 引导卡必须**先落库再发消息**。
   *
   * 早期版本这里只 `send(opt.prompt)`，从没调过 `applyAgentOnboarding`，
   * 结果用户在手机上选的 A–E 方向根本没写进 Bot 的岗位描述 / 人设 / 默认技能，
   * 选完等于白选。Web 端一直是对的（apps/web/src/App.tsx 先 apply 再 send），
   * RN 跟随时补上。落库失败按 Web 的做法：提示但不阻断发送。
   */
  // 引导卡会改写 Bot 的岗位描述 / 人设 / 默认技能，所以要重取助手列表
  const refreshAgentsAfterOnboarding = useCallback(async (): Promise<void> => {
    await agentsQuery.refetch();
  }, [agentsQuery]);

  const onOnboardingOption = useCallback(
    (opt: OnboardingOption) => {
      void (async () => {
        if (primaryAgent) {
          try {
            await api.applyAgentOnboarding(primaryAgent.id, { focus: opt.letter });
            await refreshAgentsAfterOnboarding();
          } catch (err) {
            setError(err instanceof Error ? err.message : "初始化助手失败");
          }
        }
        await send(opt.prompt);
      })();
    },
    [primaryAgent, refreshAgentsAfterOnboarding, send]
  );

  /** 自定义方向走 focus E：后端按「用户自定义」处理，同时把原文写进岗位描述。 */
  const onOnboardingCustom = useCallback(
    (text: string) => {
      void (async () => {
        if (primaryAgent) {
          try {
            await api.applyAgentOnboarding(primaryAgent.id, {
              focus: "E",
              description: text.slice(0, 400),
              system_prompt: `用户自定义方向：${text}`,
            });
            await refreshAgentsAfterOnboarding();
          } catch (err) {
            setError(err instanceof Error ? err.message : "初始化助手失败");
          }
        }
        await send(text);
      })();
    },
    [primaryAgent, refreshAgentsAfterOnboarding, send]
  );

  /**
   * 引导卡是否该出现 —— 渲染期直接派生。
   *
   * 之前是 `useState` + `useEffect` 判定：首屏先渲染 false，等 effect 跑完
   * 才变 true，闪现一次。`shouldShowOnboarding` 换成 MMKV 同步读之后，
   * 这里可以纯派生，不用存也不用等。
   */
  const showOnboarding =
    !onboardingOff &&
    messages.length === 0 &&
    !loading &&
    Boolean(primaryAgent) &&
    shouldShowOnboarding(conversationId, primaryAgent?.id ?? "", messages.length);

  const mentionMembers = useMemo(() => mentionMembersOf(agents, memberIds), [agents, memberIds]);

  /** 正文里的 `sandbox:` 链接 → 读文件并弹预览。和产物卡片走同一条路。 */
  const openSandboxLink = useCallback(async (href: string): Promise<void> => {
    const path = parseSandboxHref(href);
    if (!path) return;
    const title = previewTitleFromPath(path);
    setFilePreview({ open: true, title, content: null, loading: true, error: null });
    try {
      const res = await api.readSandboxFile(path);
      setFilePreview({
        open: true,
        title,
        content: res.content || "",
        loading: false,
        error: null,
      });
    } catch (err) {
      setFilePreview({
        open: true,
        title,
        content: null,
        loading: false,
        error: friendlyOpenError(err),
      });
    }
  }, []);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <ScreenHeader title={title || "对话"} />

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pt-5 pb-6"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? <MessageSkeleton /> : null}

        {/* 显隐走上面派生的 showOnboarding。以前这里写的是
            `!loading && messages.length === 0 && !streaming`，
            绕过了 showOnboarding —— 结果「关过引导」这个状态算了却没用上，
            点了关闭下次进来照样弹。 */}
        {showOnboarding ? (
          <BotOnboarding
            onSelectOption={onOnboardingOption}
            onCustomSubmit={onOnboardingCustom}
            onDismiss={dismissOnboarding}
          />
        ) : null}

        {visible.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            conversationId={conversationId}
            onSandboxLink={openSandboxLink}
            // 只有群聊需要逐条标注发言者；单聊里每条都是同一个助手，标了是噪音
            showAgentName={Boolean(memberIds?.length)}
            {...(m.reply_to_id && messageById.get(m.reply_to_id)
              ? { quoted: messageById.get(m.reply_to_id) as UiMessage }
              : {})}
            {...(threadCounts[m.id] ? { threadCount: threadCounts[m.id] } : {})}
            onOpenThread={(rootId) => setThreadRootId((cur) => (cur === rootId ? null : rootId))}
            onLongPress={() => setSheetMessage(m)}
            onReply={() => startReply(m)}
            onReactionChange={onReactionChange}
            onRequestFeedback={(id) => openFeedback(id, "reaction_followup")}
            {...(primaryAgent ? { fallbackAgentId: primaryAgent.id } : {})}
            {...(primaryAgent ? { fallbackAgentName: primaryAgent.name } : {})}
          />
        ))}

        {sending && runLabel ? <RunStatus label={runLabel} /> : null}

        {error ? <ErrorAlert title="发送失败" description={error} /> : null}
      </ScrollView>

      <View className="border-t border-border bg-background pb-safe-offset-8">
        {threadRootId ? (
          <View className="flex-row items-center justify-between px-5 pt-2">
            <Typography.Paragraph className="text-xs text-accent-foreground">
              正在查看线程 · {threadCounts[threadRootId] ?? 0} 条回复
            </Typography.Paragraph>
            <Button size="sm" variant="ghost" onPress={() => setThreadRootId(null)}>
              <Button.Label>返回主时间线</Button.Label>
            </Button>
          </View>
        ) : null}
        <QuoteBar replyTo={replyTo} onClose={() => setReplyTo(null)} />
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          onStop={() => void stop()}
          onRequestAttach={(s) => void requestAttach(s)}
          onRemoveFile={(key) => setFiles((prev) => prev.filter((f) => f.key !== key))}
          files={files}
          sending={sending}
          busy={uploading}
          {...(primaryAgent ? { agentName: primaryAgent.name } : {})}
          mentionMembers={mentionMembers}
          allowEveryone={Boolean(memberIds?.length)}
          dmCandidates={memberIds?.length ? [] : agents}
          {...(agentSkills.length ? { skills: agentSkills } : {})}
          {...(routines.length ? { routines } : {})}
          {...(mcpNames.length ? { mcpServers: mcpNames } : {})}
        />
      </View>

      {sheetMessage ? (
        <MessageActionSheet
          visible
          onClose={() => setSheetMessage(null)}
          message={sheetMessage as never}
          onReact={(emoji: string) => void submitReaction(sheetMessage, emoji)}
          onReply={() => startReply(sheetMessage)}
          onFeedback={() => openFeedback(sheetMessage.id, "feedback_menu")}
        />
      ) : null}

      {feedbackMessage ? (
        <FeedbackModal
          visible
          onClose={() => setFeedbackMessage(null)}
          message={feedbackMessage as never}
          source={feedbackSource}
          conversationId={conversationId}
          {...(primaryAgent ? { agentName: primaryAgent.name } : {})}
          onSubmitted={() => setFeedbackMessage(null)}
        />
      ) : null}

      <FilePreviewModal
        open={filePreview.open}
        title={filePreview.title}
        content={filePreview.content}
        loading={filePreview.loading}
        error={filePreview.error}
        onClose={() =>
          setFilePreview({ open: false, title: "", content: null, loading: false, error: null })
        }
      />
    </KeyboardAvoidingView>
  );
}
