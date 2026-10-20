import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import * as api from "@/api";
import { isAbortError } from "@/api/http";
import { useQueryClient } from "@tanstack/react-query";

import { useAgents, useMessages } from "@/queries";
import { qk } from "@/queries/client";
import type { Agent, AttachmentMeta, Channel, Message, ReactionUpdatedEvent } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { BotOnboarding } from "@/components/BotOnboarding";
import { Composer } from "@/components/Composer";
import { GroupMembersSheet } from "@/components/GroupMembersSheet";
import { Icon } from "@/components/Icon";
import { MessageBubble, type UiMessage } from "@/components/MessageBubble";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { FeedbackModal } from "@/components/chat/FeedbackModal";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { RunStatus } from "@/components/RunStatus";
import { ScreenHeader } from "@/components/ScreenScaffold";
import { ErrorAlert, MessageSkeleton } from "@/components/states";
import { makeKey, type PickedFile } from "@/lib/attachments";
import { toolNameLooksLikeSearch } from "@/lib/avatar";
import {
  firstAttachmentIssue,
  mentionMembersOf,
  resolveMentionedAgents,
  shouldShowOnboarding,
} from "@/lib/chat";
import {
  avatarPropsForMessage,
  buildStreamHandlers,
  mergeVisibleMessages,
  toUiMessage,
  type StreamingByAgent,
} from "@/lib/conversationRun";
import {
  getOnboardingCustomFallbackId,
  onboardingStorageKey,
  setOnboardingDismissed,
  type OnboardingOption,
} from "@/lib/onboarding";
import { friendlyOpenError, parseSandboxHref, previewTitleFromPath } from "@/lib/workspace";
import { OpenUiHostProvider, type OpenUiHost } from "@/openui/host";
import { useRealtimeEvents } from "@/providers/realtime";
import { useSession } from "@/providers/session";
import { useSecretPrompt } from "@/providers/secretPrompt";
import { useAgentOnline, useAgentPresence } from "@/stores/realtime";
import { runWithFinally } from "@/lib/finally";
import { hitSlopFor } from "@/theme/tokens";

/** 距底部多少像素内视为「贴底」，用于隐藏滚到底按钮。 */
const NEAR_BOTTOM_PX = 96;

/** 稳定空数组引用，避免 `?? []` 让下游 memo 每次都失效。 */
const EMPTY_AGENTS: Agent[] = [];

export default function ChatScreen(): JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id ?? "");
  const { user } = useSession();
  const { refresh: refreshSecrets } = useSecretPrompt();

  const [pendingBubbles, setPendingBubbles] = useState<UiMessage[]>([]);
  const [title, setTitle] = useState("");
  const [memberIds, setMemberIds] = useState<string[] | undefined>();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [streamingByAgent, setStreamingByAgent] = useState<StreamingByAgent | null>(null);
  const [sending, setSending] = useState(false);
  const [runLabel, setRunLabel] = useState("");
  /** 当前工具名，用于 working→searching 头像动画。 */
  const [runActiveTool, setRunActiveTool] = useState<string | null>(null);
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
  /** 当前路由会话 id；发消息 catch 里用来区分「本页停止」和「已切走会话」。 */
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const scrollRef = useRef<ScrollView>(null);
  /** 用户是否贴着底部；离开底部时显示「滚到底」浮钮。 */
  const [nearBottom, setNearBottom] = useState(true);
  /**
   * 键盘弹起时 home indicator 已被键盘盖住，不能再叠 pb-safe，
   * 否则会和 KeyboardAvoidingView 的 padding 叠成一大块空白。
   */
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  /** 长按打开操作面板的目标消息 */
  const [sheetMessage, setSheetMessage] = useState<UiMessage | null>(null);
  /** 反馈弹窗的目标消息 */
  const [feedbackMessage, setFeedbackMessage] = useState<UiMessage | null>(null);
  /** 反馈来源：面板主动打开 vs 负表情联动 */
  const [feedbackSource, setFeedbackSource] = useState<"feedback_menu" | "reaction_followup">(
    "feedback_menu"
  );
  /** 引用回复的目标；非空时作曲卡内嵌引用条 */
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

  /** 当前驱动 RunStatus / 动态头像的助手（群聊取正在流式的那个）。 */
  const runFaceAgent = useMemo(() => {
    if (streamingByAgent) {
      const ids = Object.keys(streamingByAgent).filter((k) => k && k !== "_");
      if (ids.length === 1) {
        const hit = agents.find((a) => a.id === ids[0]);
        if (hit) return hit;
      }
    }
    return primaryAgent;
  }, [streamingByAgent, agents, primaryAgent]);

  const runPresence = useAgentPresence(runFaceAgent?.id, user?.id ?? null);
  const headerOnline = useAgentOnline(primaryAgent?.id, user?.id ?? null);
  const searchingHint = toolNameLooksLikeSearch(runActiveTool) || toolNameLooksLikeSearch(runLabel);

  const headerSubtitle = useMemo(() => {
    if (channel) {
      const n = channel.members?.length ?? 0;
      return n > 0 ? `${n} 位成员` : "群聊";
    }
    if (!primaryAgent) return undefined;
    return headerOnline ? "在线" : undefined;
  }, [channel, primaryAgent, headerOnline]);

  const replyQuote = useMemo(() => {
    if (!replyTo) return null;
    return {
      id: replyTo.id,
      role: replyTo.role,
      content: replyTo.content,
      ...(replyTo.role !== "user"
        ? {
            agentName:
              replyTo.agent_name ||
              agents.find((a) => a.id === replyTo.agent_id)?.name ||
              primaryAgent?.name ||
              "助手",
          }
        : {}),
    };
  }, [replyTo, agents, primaryAgent]);

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
  // 只用 refetch（TanStack Query 保证稳定），不要依赖整个 messagesQuery ——
  // 查询结果对象每次渲染都是新引用，会让 reload 身份变化，进而触发下方 effect
  // cleanup 把进行中的 send AbortController 掐掉（表现为 fetch aborted）。
  const refetchMessages = messagesQuery.refetch;
  const refreshMessages = useCallback(async (): Promise<{ runActive: boolean }> => {
    const { data } = await refetchMessages();
    setPendingBubbles([]);
    return { runActive: Boolean(data?.run_active) };
  }, [refetchMessages]);

  const reload = useCallback(async () => {
    // 用 refetch 的返回值，而不是闭包里的 messagesQuery.data ——
    // 那是本次渲染时的旧值，refetch 完不会自己更新。
    const { runActive } = await refreshMessages();
    if (!runActive) return;

    // 服务端还有 run 在跑（App 被杀掉后重开）→ 重新挂回流
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSending(true);
    setRunLabel("正在思考…");
    setRunActiveTool(null);
    api
      .subscribeConversationEvents(
        conversationId,
        buildStreamHandlers({
          setStreamingByAgent,
          setRunLabel,
          setRunActiveTool,
          setError,
          setSending,
          onDone: () => {
            void refreshMessages().then(() => undefined);
          },
        }),
        ctrl.signal
      )
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setError(err instanceof Error ? err.message : "订阅中断");
        }
      })
      .finally(() => {
        if (abortRef.current === ctrl) abortRef.current = null;
      });
  }, [conversationId, refreshMessages]);

  // 始终读最新 reload，但 effect 只跟会话 id 走 —— 避免 reload 身份抖动时
  // cleanup 误 abort 正在发送的 SSE。
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!conversationId) return;
    // 豁免 react-hooks/set-state-in-effect：reload 及其 then 链里的所有
    // setState 都发生在 `await` 网络往返之后，不是渲染期同步写状态。
    // 规则无法跨 async 边界证明这点，只能在此显式说明。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadRef
      .current()
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
            const ch = channelList.find((c) => c.id === conv.channel_id) ?? null;
            setChannel(ch);
            setMemberIds(ch?.members);
          } else {
            setChannel(null);
            setMemberIds(undefined);
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
  }, [conversationId]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardOpen(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

  // 流式输出时跟随底部；用户上滑离开底部后不抢滚动，由浮钮自行回底
  useEffect(() => {
    if (!nearBottom) return;
    const parts = streamingByAgent ? Object.values(streamingByAgent) : [];
    if (parts.some((p) => p.text)) scrollRef.current?.scrollToEnd({ animated: true });
  }, [streamingByAgent, nearBottom]);

  const visible = useMemo(
    () => mergeVisibleMessages(messages, streamingByAgent, threadRootId),
    [messages, streamingByAgent, threadRootId]
  );

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
    async (overrideText?: string, opts?: { onboarding?: boolean }): Promise<void> => {
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
      setStreamingByAgent({});
      setRunLabel("正在思考…");
      setRunActiveTool(null);

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

      await runWithFinally(
        async () => {
          try {
            await api.sendMessageStream(
              conversationId,
              content,
              buildStreamHandlers({
                setStreamingByAgent,
                setRunLabel,
                setRunActiveTool,
                setError,
                setSending,
                withSendMeta: true,
                onDone: () => {
                  // 以服务端落库结果为准，避免本地拼的消息缺 id / 时间戳
                  void reload().catch(() => undefined);
                  void refreshSecrets();
                },
              }),
              ctrl.signal,
              {
                ...(uploaded.length ? { attachments: uploaded } : {}),
                ...(mentioned.length ? { agentIds: mentioned.map((a) => a.id) } : {}),
                ...(replyTo ? { replyToId: replyTo.id } : {}),
                // 在线程里回复时沿用根消息，否则这条会掉回主时间线
                ...(threadRootId ? { threadRootId } : {}),
                ...(opts?.onboarding ? { onboarding: true } : {}),
              }
            );
          } catch (err) {
            if (isAbortError(err)) {
              // 用户点停止：服务端 run 可能仍在收尾，补拉一次；已切走会话则别再 reload
              setStreamingByAgent(null);
              setSending(false);
              setRunLabel("");
              setRunActiveTool(null);
              if (conversationIdRef.current === conversationId) {
                void reload().catch(() => undefined);
              }
            } else {
              setError(err instanceof Error ? err.message : "发送失败");
              setSending(false);
              setStreamingByAgent(null);
              setRunActiveTool(null);
            }
          }
        },
        () => {
          if (abortRef.current === ctrl) abortRef.current = null;
        }
      );
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

  /** OpenUI 组件里的点击 / 表单提交 → 以用户身份发一条消息；链接走系统浏览器。 */
  const openUiHost = useMemo<OpenUiHost>(
    () => ({
      send: (text) => void send(text),
      openUrl: (url) => void Linking.openURL(url),
      readonly: sending,
    }),
    [send, sending]
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
   * 结果用户在手机上选的岗位方向根本没写进 Bot 的岗位描述 / 人设 / 默认技能，
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
            await api.applyAgentOnboarding(primaryAgent.id, { focus: opt.id || opt.letter });
            await refreshAgentsAfterOnboarding();
          } catch (err) {
            setError(err instanceof Error ? err.message : "初始化助手失败");
          }
        }
        await send(opt.prompt, { onboarding: true });
      })();
    },
    [primaryAgent, refreshAgentsAfterOnboarding, send]
  );

  /** 自定义方向走 custom_fallback（默认 E）：把原文写进岗位描述。 */
  const onOnboardingCustom = useCallback(
    (text: string) => {
      void (async () => {
        if (primaryAgent) {
          try {
            await api.applyAgentOnboarding(primaryAgent.id, {
              focus: getOnboardingCustomFallbackId(),
              description: text.slice(0, 400),
              system_prompt: `用户自定义方向：${text}`,
            });
            await refreshAgentsAfterOnboarding();
          } catch (err) {
            setError(err instanceof Error ? err.message : "初始化助手失败");
          }
        }
        await send(text, { onboarding: true });
      })();
    },
    [primaryAgent, refreshAgentsAfterOnboarding, send]
  );

  /**
   * 引导卡是否该出现 —— 渲染期直接派生。
   *
   * 之前是 `useState` + `useEffect` 判定：首屏先渲染 false，等 effect 跑完
   * 才变 true，闪现一次。`shouldShowOnboarding` 换成同步读本地偏好之后，
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
      // ScreenHeader 在本 View 内部，不要再加 top inset，否则会多顶出一整块空白
      keyboardVerticalOffset={0}
    >
      <ScreenHeader
        title={title || primaryAgent?.name || "对话"}
        {...(headerSubtitle ? { subtitle: headerSubtitle } : {})}
        leading={
          primaryAgent && !channel ? (
            <AgentAvatar
              id={primaryAgent.id}
              name={primaryAgent.name}
              size={32}
              shape={primaryAgent.avatar_shape}
              color={primaryAgent.avatar_color}
              online={headerOnline}
            />
          ) : null
        }
        right={
          channel ? (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              accessibilityLabel="群成员"
              onPress={() => setMembersOpen(true)}
            >
              <Icon name="people-outline" size={22} tone="foreground" />
            </Button>
          ) : null
        }
      />

      <View className="relative flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-3.5 px-4 pt-4 pb-5"
          onContentSizeChange={() => {
            if (nearBottom) scrollRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const dist = contentSize.height - layoutMeasurement.height - contentOffset.y;
            setNearBottom(dist <= NEAR_BOTTOM_PX);
          }}
          scrollEventThrottle={100}
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

          <OpenUiHostProvider value={openUiHost}>
            {visible.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                conversationId={conversationId}
                onSandboxLink={openSandboxLink}
                // 只有群聊需要逐条标注发言者；单聊里每条都是同一个助手，标了是噪音
                showAgentName={Boolean(memberIds?.length)}
                {...(primaryAgent?.id ? { ownerAgentId: primaryAgent.id } : {})}
                {...(m.reply_to_id && messageById.get(m.reply_to_id)
                  ? { quoted: messageById.get(m.reply_to_id) as UiMessage }
                  : {})}
                {...(threadCounts[m.id] ? { threadCount: threadCounts[m.id] } : {})}
                onOpenThread={(rootId) =>
                  setThreadRootId((cur) => (cur === rootId ? null : rootId))
                }
                onLongPress={() => setSheetMessage(m)}
                onReply={() => startReply(m)}
                onReactionChange={onReactionChange}
                onRequestFeedback={(id) => openFeedback(id, "reaction_followup")}
                {...(primaryAgent ? { fallbackAgentId: primaryAgent.id } : {})}
                {...(primaryAgent ? { fallbackAgentName: primaryAgent.name } : {})}
                {...avatarPropsForMessage(m, agents, primaryAgent)}
              />
            ))}
          </OpenUiHostProvider>

          {sending && runLabel ? (
            <RunStatus
              label={runLabel}
              agentId={runFaceAgent?.id}
              agentName={runFaceAgent?.name ?? "助手"}
              shape={runFaceAgent?.avatar_shape}
              avatarColor={runFaceAgent?.avatar_color}
              status={runPresence === "idle" ? "thinking" : runPresence}
              searchingHint={searchingHint}
            />
          ) : null}

          {error ? <ErrorAlert title="发送失败" description={error} /> : null}
        </ScrollView>

        {!nearBottom && !loading ? (
          <Pressable
            onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}
            accessibilityRole="button"
            accessibilityLabel="滚到最新消息"
            hitSlop={hitSlopFor(36)}
            className="absolute right-4 bottom-3 z-10 size-9 items-center justify-center rounded-full border border-border bg-surface"
          >
            <Icon name="chevron-down" size={20} tone="muted" />
          </Pressable>
        ) : null}
      </View>

      <View className={`bg-background ${keyboardOpen ? "pb-2" : "pb-safe-offset-6"}`}>
        {threadRootId ? (
          <View className="mx-3 mt-2 flex-row items-center justify-between rounded-xl bg-accent-soft px-3 py-2">
            <Typography.Paragraph className="text-xs text-accent-soft-foreground">
              线程 · {threadCounts[threadRootId] ?? 0} 条回复
            </Typography.Paragraph>
            <Button size="sm" variant="ghost" onPress={() => setThreadRootId(null)}>
              <Button.Label className="text-accent-soft-foreground">返回</Button.Label>
            </Button>
          </View>
        ) : null}
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
          replyTo={replyQuote}
          onClearReply={() => setReplyTo(null)}
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
          {...(primaryAgent ? { agentIdForTrain: primaryAgent.id } : {})}
          onSubmitted={() => setFeedbackMessage(null)}
        />
      ) : null}

      <GroupMembersSheet
        visible={membersOpen}
        channel={channel}
        agents={agents}
        onClose={() => setMembersOpen(false)}
        onChanged={(ch) => {
          setChannel(ch);
          setMemberIds(ch.members);
        }}
      />

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
