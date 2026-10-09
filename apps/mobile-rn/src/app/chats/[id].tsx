import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as api from "@/api";
import type { Agent, AttachmentMeta, Message } from "@/api/types";
import { BotOnboarding } from "@/components/BotOnboarding";
import { Composer } from "@/components/Composer";
import { MessageBubble, type UiMessage } from "@/components/MessageBubble";
import { FilePreviewModal } from "@/components/FilePreviewModal";
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
import { useSecretPrompt } from "@/providers/secretPrompt";

const STREAMING_ID = "__streaming__";

type Streaming = { text: string; agentId?: string; agentName?: string };

export default function ChatScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id ?? "");
  const { refresh: refreshSecrets } = useSecretPrompt();

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
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
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [filePreview, setFilePreview] = useState<{
    open: boolean;
    title: string;
    content: string | null;
    loading: boolean;
    error: string | null;
  }>({ open: false, title: "", content: null, loading: false, error: null });

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const primaryAgent = useMemo(() => {
    if (memberIds?.length) return null;
    const last = messages.find((m) => m.role === "assistant" && m.agent_id);
    const fromMsg = last ? agents.find((a) => a.id === last.agent_id) : undefined;
    return fromMsg ?? agents[0] ?? null;
  }, [agents, memberIds, messages]);

  const fetchMessages = useCallback(async (): Promise<{ runActive: boolean }> => {
    const res = await api.listMessagesWithStatus(conversationId);
    const list: UiMessage[] = res.messages.map((m: Message) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      ...(m.agent_id ? { agent_id: m.agent_id } : {}),
    }));
    setMessages(list);
    return { runActive: Boolean(res.run_active) };
  }, [conversationId]);

  const reload = useCallback(async () => {
    const { runActive } = await fetchMessages();
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
            void fetchMessages();
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
  }, [conversationId, fetchMessages]);

  useEffect(() => {
    if (!conversationId) return;
    // 豁免 react-hooks/set-state-in-effect：reload 内的所有 setState 都在
    // `await fetchMessages()` 之后才发生（网络往返完成才更新），不是渲染期同步写状态。
    // 规则无法跨 async 边界证明这点，只能在此显式说明。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
      .then(async () => {
        const [agentList, convList] = await Promise.all([
          api.listAgents().catch(() => [] as Agent[]),
          api.listConversations().catch(() => []),
        ]);
        setAgents(agentList);
        const conv = convList.find((c) => c.id === conversationId);
        if (conv) {
          setTitle(conv.title);
          if (conv.channel_id) {
            const channels = await api.listChannels().catch(() => []);
            setMemberIds(channels.find((c) => c.id === conv.channel_id)?.members);
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

  useEffect(() => {
    if (!showOnboarding || !primaryAgent) return;
    void shouldShowOnboarding(conversationId, primaryAgent.id, messages.length).then(
      setShowOnboarding
    );
    // 只在会话就绪时判定一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, primaryAgent?.id]);

  // 流式输出时贴着底部
  useEffect(() => {
    if (streaming?.text) scrollRef.current?.scrollToEnd({ animated: true });
  }, [streaming?.text]);

  const visible = useMemo(() => {
    const base = messages;
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
  }, [messages, streaming]);

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
      setShowOnboarding(false);

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
      setMessages((prev) => [...prev, optimistic]);
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
    [conversationId, draft, files, sending, uploading, agents, reload, refreshSecrets]
  );

  const stop = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    await api.cancelConversationRun(conversationId).catch(() => undefined);
  }, [conversationId]);

  const dismissOnboarding = useCallback(async (): Promise<void> => {
    if (!primaryAgent) return;
    setShowOnboarding(false);
    await setOnboardingDismissed(onboardingStorageKey(conversationId, primaryAgent.id));
  }, [conversationId, primaryAgent]);

  const onOnboardingOption = useCallback((opt: OnboardingOption) => void send(opt.prompt), [send]);

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

        {!loading && messages.length === 0 && !streaming ? (
          <BotOnboarding
            onSelectOption={onOnboardingOption}
            onCustomSubmit={(t) => void send(t)}
            onDismiss={() => void dismissOnboarding()}
          />
        ) : null}

        {visible.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onSandboxLink={openSandboxLink}
            // 只有群聊需要逐条标注发言者；单聊里每条都是同一个助手，标了是噪音
            showAgentName={Boolean(memberIds?.length)}
            {...(primaryAgent ? { fallbackAgentId: primaryAgent.id } : {})}
            {...(primaryAgent ? { fallbackAgentName: primaryAgent.name } : {})}
          />
        ))}

        {sending && runLabel ? <RunStatus label={runLabel} /> : null}

        {error ? <ErrorAlert title="发送失败" description={error} /> : null}
      </ScrollView>

      <View className="border-t border-border bg-background pb-safe-offset-8">
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
        />
      </View>

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
