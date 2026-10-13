import { Avatar, Button, Dialog, Menu, Separator, Spinner, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { InteractionManager, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { useShallow } from "zustand/react/shallow";

import * as api from "@/api";
import type { Agent, Channel } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentEditor } from "@/components/AgentEditor";
import { CloneAgentSheet } from "@/components/CloneAgentSheet";
import { Icon } from "@/components/Icon";
import { FormField } from "@/components/FormField";
import { EmptyState, ErrorAlert, ListSkeleton } from "@/components/states";
import { useConfirm } from "@/components/ConfirmDialog";
import { errText } from "@/lib/errors";
import { avatarInitials } from "@/lib/avatar";
import { formatRelativeTime } from "@/lib/format";
import { useSession } from "@/providers/session";
import { useAgentMutations, useAgents, useChannels, useChannelMutations } from "@/queries";
import { useCurrentBot, useListPrefs, type ListPrefsState } from "@/stores/client";
import { useRealtimeStore } from "@/stores/realtime";

/** 稳定的空数组引用，避免 `?? []` 破坏下游 memo。 */
const EMPTY_AGENTS: Agent[] = [];
const EMPTY_CHANNELS: Channel[] = [];

type ConvListItem =
  | { kind: "agent"; agent: Agent; sortAt: number }
  | { kind: "channel"; channel: Channel; sortAt: number };

type MemberFace = {
  agent_id: string;
  name: string;
  avatar_shape?: string;
  avatar_color?: string;
  online?: boolean;
};

function itemSortAt(iso?: string | null): number {
  return Date.parse(iso || "") || 0;
}

function channelMemberFaces(channel: Channel, agents: Agent[], nameById: Map<string, string>): MemberFace[] {
  return (channel.members || []).map((id) => {
    const agent = agents.find((a) => a.id === id);
    const profile = channel.member_profiles?.find((p) => p.agent_id === id);
    return {
      agent_id: id,
      name: agent?.name || profile?.name || nameById.get(id) || id,
      ...(agent?.avatar_shape || profile?.avatar_shape
        ? { avatar_shape: agent?.avatar_shape || profile?.avatar_shape }
        : {}),
      ...(agent?.avatar_color || profile?.avatar_color
        ? { avatar_color: agent?.avatar_color || profile?.avatar_color }
        : {}),
      online: agent?.online ?? profile?.online,
    };
  });
}

/**
 * 首页：助手 + 群聊合并为一条按最近活跃排序的会话列表（对齐 Web AppSidebar）。
 */
export default function ChatsScreen(): JSX.Element {
  const router = useRouter();
  const { user, signOut } = useSession();
  const { confirm } = useConfirm();

  const agentsQuery = useAgents();
  const channelsQuery = useChannels();
  const agentMutations = useAgentMutations();
  const channelMutations = useChannelMutations();

  const agents = agentsQuery.data ?? EMPTY_AGENTS;
  const channels = channelsQuery.data ?? EMPTY_CHANNELS;
  const loading = agentsQuery.isLoading;
  const [refreshing, setRefreshing] = useState(false);
  /** 仅冷打开（无缓存 conversation_id、需等网络）时显示行内 Spinner；热路径用 ref 防连点，避免先刷列表。 */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingLockRef = useRef(false);

  const queryError = agentsQuery.error
    ? errText(agentsQuery.error, "加载助手失败")
    : channelsQuery.error
      ? errText(channelsQuery.error, "加载群聊失败")
      : null;

  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? queryError;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [cloneAgent, setCloneAgent] = useState<Agent | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const setCurrentBot = useCurrentBot((s) => s.setBot);
  const lastOpened = useListPrefs((s) => s.lastOpened);
  const setLastOpened = useListPrefs((s) => s.setLastOpened);

  const userId = user?.id ?? null;
  const { presenceByAgent, onlineByAgent, realtimeScope } = useRealtimeStore(
    useShallow((s) => ({
      presenceByAgent: s.presence,
      onlineByAgent: s.online,
      realtimeScope: s.scope,
    }))
  );
  const liveOk = realtimeScope === userId;

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

  const load = useCallback(async (): Promise<void> => {
    await Promise.all([agentsQuery.refetch(), channelsQuery.refetch()]);
    setRefreshing(false);
  }, [agentsQuery, channelsQuery]);

  /**
   * 转场开始后再写偏好 / 清 busy。
   * 否则 push 前 setState 会先刷列表一帧，看起来像「列表闪一下才进页」。
   */
  const afterNavigate = useCallback((record?: NonNullable<ListPrefsState["lastOpened"]>) => {
    InteractionManager.runAfterInteractions(() => {
      if (record) setLastOpened(record);
      openingLockRef.current = false;
      setOpeningId(null);
    });
  }, [setLastOpened]);

  const openAgent = useCallback(
    async (agentId: string): Promise<void> => {
      if (openingLockRef.current) return;
      openingLockRef.current = true;
      const agent = agents.find((a) => a.id === agentId);
      const fromList = (agent?.conversation_id || "").trim();
      const fromPrefs =
        lastOpened?.kind === "agent" && lastOpened.id === agentId
          ? (lastOpened.conversation_id || "").trim()
          : "";
      let conversationId = fromList || fromPrefs;

      try {
        if (!conversationId) {
          setOpeningId(agentId);
          const conversation = await api.openPrimaryConversation(agentId);
          conversationId = conversation.id;
        }
        const record: NonNullable<ListPrefsState["lastOpened"]> = {
          kind: "agent",
          id: agentId,
          name: agent?.name ?? "助手",
          conversation_id: conversationId,
        };
        router.push(`/chats/${conversationId}`);
        afterNavigate(record);
      } catch (err) {
        openingLockRef.current = false;
        setOpeningId(null);
        setActionError(errText(err, "打开会话失败"));
      }
    },
    [afterNavigate, agents, lastOpened, router]
  );

  const openChannel = useCallback(
    async (channelId: string): Promise<void> => {
      if (openingLockRef.current) return;
      openingLockRef.current = true;
      const channel = channels.find((c) => c.id === channelId);
      const fromList = (channel?.conversation_id || "").trim();
      const fromPrefs =
        lastOpened?.kind === "channel" && lastOpened.id === channelId
          ? (lastOpened.conversation_id || "").trim()
          : "";
      let conversationId = fromList || fromPrefs;

      try {
        if (!conversationId) {
          setOpeningId(channelId);
          const { conversation } = await api.openChannelConversation(channelId);
          conversationId = conversation.id;
        }
        const record: NonNullable<ListPrefsState["lastOpened"]> = {
          kind: "channel",
          id: channelId,
          name: channel?.name ?? "群聊",
          conversation_id: conversationId,
        };
        router.push(`/chats/${conversationId}`);
        afterNavigate(record);
      } catch (err) {
        openingLockRef.current = false;
        setOpeningId(null);
        setActionError(errText(err, "打开群聊失败"));
      }
    },
    [afterNavigate, channels, lastOpened, router]
  );

  const resumeLast = useCallback(async (): Promise<void> => {
    if (!lastOpened || openingLockRef.current) return;
    if (lastOpened.conversation_id) {
      openingLockRef.current = true;
      router.push(`/chats/${lastOpened.conversation_id}`);
      afterNavigate();
      return;
    }
    if (lastOpened.kind === "agent") await openAgent(lastOpened.id);
    else await openChannel(lastOpened.id);
  }, [afterNavigate, lastOpened, openAgent, openChannel, router]);

  const removeAgent = useCallback(
    async (agent: Agent): Promise<void> => {
      const ok = await confirm({
        title: `删除助手「${agent.name}」？`,
        message: "该助手的主会话会一并删除，且无法恢复。",
        confirmLabel: "删除",
        destructive: true,
      });
      if (!ok) return;
      try {
        await agentMutations.remove.mutateAsync(agent.id);
        setActionError(null);
      } catch (err) {
        setActionError(errText(err, "删除失败"));
      }
    },
    [agentMutations.remove, confirm]
  );

  const removeChannel = useCallback(
    async (channel: Channel): Promise<void> => {
      const ok = await confirm({
        title: `删除群聊「${channel.name}」？`,
        message: "群聊及其会话会一并删除，且无法恢复。",
        confirmLabel: "删除",
        destructive: true,
      });
      if (!ok) return;
      try {
        await channelMutations.remove.mutateAsync(channel.id);
        setActionError(null);
      } catch (err) {
        setActionError(errText(err, "删除失败"));
      }
    },
    [channelMutations.remove, confirm]
  );

  /** 助手 + 群聊合并、按最近更新排序（对齐 Web convItems）。 */
  const convItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items: ConvListItem[] = [];
    for (const a of agents) {
      if (q) {
        const hay = `${a.name} ${a.description || ""} ${a.id} ${a.last_message || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      items.push({
        kind: "agent",
        agent: a,
        sortAt: itemSortAt(a.conversation_updated_at || a.updated_at || a.created_at),
      });
    }
    for (const ch of channels) {
      if (q) {
        const memberNames = (ch.members || []).map((id) => agentNameById.get(id) || id).join(" ");
        const hay = `${ch.name} ${memberNames}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      items.push({
        kind: "channel",
        channel: ch,
        sortAt: itemSortAt(ch.created_at),
      });
    }
    items.sort((a, b) => b.sortAt - a.sortAt || a.kind.localeCompare(b.kind));
    return items;
  }, [agents, channels, query, agentNameById]);

  const searching = query.trim().length > 0;
  const openNewAgent = (): void => {
    setEditingAgent(null);
    setEditorOpen(true);
  };

  const isBotOnline = (id: string, snapshot?: boolean): boolean => {
    if (liveOk && onlineByAgent[id] !== undefined) return Boolean(onlineByAgent[id]);
    return Boolean(snapshot);
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between border-b border-border bg-background px-5 pt-safe-offset-12 pb-3">
        <Typography.Heading type="h2">Open Bot</Typography.Heading>

        <View className="flex-row items-center gap-1">
          <Menu>
            <Menu.Trigger asChild>
              <Button isIconOnly accessibilityLabel="新建">
                <Icon name="add" size={22} tone="accent-foreground" />
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Overlay closeOnPress />
              <Menu.Content presentation="popover" width={200}>
                <Menu.Item onPress={openNewAgent}>
                  <Menu.ItemTitle>新建助手</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setChannelOpen(true)}>
                  <Menu.ItemTitle>新建群聊</Menu.ItemTitle>
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>

          <Menu>
            <Menu.Trigger>
              <Avatar className="ml-1" accessibilityLabel="账户菜单">
                <Avatar.Fallback>
                  <Typography.Paragraph weight="medium" className="text-xs">
                    {avatarInitials(user?.username ?? "")}
                  </Typography.Paragraph>
                </Avatar.Fallback>
              </Avatar>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Overlay closeOnPress />
              <Menu.Content presentation="popover" width={260}>
                <Menu.Label>{user?.username ?? "未登录"}</Menu.Label>
                <Menu.Item className="items-center gap-3" onPress={() => router.push("/collab")}>
                  <View className="size-6 items-center justify-center">
                    <Icon name="mail-unread-outline" size={22} tone="muted" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Menu.ItemTitle className="font-semibold">协作收件箱</Menu.ItemTitle>
                    <Menu.ItemDescription>处理待你确认的请求</Menu.ItemDescription>
                  </View>
                </Menu.Item>
                <Menu.Item
                  className="items-center gap-3"
                  onPress={() => {
                    const id = agents[0]?.id;
                    router.push(
                      (id ? `/train?agentId=${encodeURIComponent(id)}` : "/train") as never
                    );
                  }}
                >
                  <View className="size-6 items-center justify-center">
                    <Icon name="school-outline" size={22} tone="muted" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Menu.ItemTitle className="font-semibold">训练</Menu.ItemTitle>
                    <Menu.ItemDescription>待确认与已生效的经验</Menu.ItemDescription>
                  </View>
                </Menu.Item>
                <Menu.Item className="items-center gap-3" onPress={() => router.push("/settings")}>
                  <View className="size-6 items-center justify-center">
                    <Icon name="settings-outline" size={22} tone="muted" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Menu.ItemTitle className="font-semibold">设置</Menu.ItemTitle>
                    <Menu.ItemDescription>模型、密钥、运行环境</Menu.ItemDescription>
                  </View>
                </Menu.Item>
                <Separator className="my-1" />
                <Menu.Item className="items-center gap-3" variant="danger" onPress={() => void signOut()}>
                  <View className="size-6 items-center justify-center">
                    <Icon name="log-out-outline" size={22} tone="danger" />
                  </View>
                  <Menu.ItemTitle className="font-semibold">退出登录</Menu.ItemTitle>
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-5"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {error ? (
          <ErrorAlert title="出了点问题" description={error} onRetry={() => void load()} />
        ) : null}

        <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3">
          <Icon name="search" size={18} tone="muted" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索助手或群聊"
            placeholderTextColor="hsl(0 0% 60%)"
            className="flex-1 py-3 text-base"
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel="搜索助手或群聊"
          />
          {query.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              onPress={() => setQuery("")}
              accessibilityLabel="清除搜索"
            >
              <Icon name="close-circle" size={18} tone="muted" />
            </Button>
          ) : null}
        </View>

        {!searching && lastOpened ? (
          <Pressable
            onPress={() => void resumeLast()}
            accessibilityRole="button"
            accessibilityLabel={`继续与 ${lastOpened.name} 的对话`}
            className="flex-row items-center gap-3 rounded-3xl bg-surface px-4 py-3"
          >
            {lastOpened.kind === "agent" ? (
              <AgentAvatar
                id={lastOpened.id}
                name={lastOpened.name}
                size={48}
                shape={agents.find((a) => a.id === lastOpened.id)?.avatar_shape}
                color={agents.find((a) => a.id === lastOpened.id)?.avatar_color}
                status={liveOk ? presenceByAgent[lastOpened.id] || "idle" : "idle"}
                online={isBotOnline(
                  lastOpened.id,
                  agents.find((a) => a.id === lastOpened.id)?.online
                )}
              />
            ) : (
              <ChannelAvatarStack
                faces={channelMemberFaces(
                  channels.find((c) => c.id === lastOpened.id) || {
                    id: lastOpened.id,
                    user_id: "",
                    name: lastOpened.name,
                    created_at: "",
                    members: [],
                  },
                  agents,
                  agentNameById
                )}
                isBotOnline={isBotOnline}
                size={40}
              />
            )}
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph type="body-sm" color="muted">
                继续上次
              </Typography.Paragraph>
              <Typography.Paragraph weight="medium" numberOfLines={1} className="text-lg">
                {lastOpened.name}
              </Typography.Paragraph>
            </View>
            <Icon name="chevron-forward" size={18} tone="muted" />
          </Pressable>
        ) : null}

        {loading ? (
          <ListSkeleton rows={5} />
        ) : searching && convItems.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="没有匹配的结果"
            hint="换个关键词，或者清空搜索看看全部会话。"
          />
        ) : agents.length === 0 && channels.length === 0 ? (
          <EmptyState
            icon="hardware-chip-outline"
            title="还没有会话"
            hint="创建一个助手，或建一个群聊让多个助手一起回答。"
            action={
              <View className="flex-row gap-2">
                <Button onPress={openNewAgent}>
                  <Icon name="add" size={18} tone="accent-foreground" />
                  <Button.Label>新建助手</Button.Label>
                </Button>
                <Button variant="secondary" onPress={() => setChannelOpen(true)}>
                  <Button.Label>新建群聊</Button.Label>
                </Button>
              </View>
            }
          />
        ) : (
          <View className="gap-3">
            <View className="flex-row items-center justify-between px-1">
              <Typography.Paragraph color="muted" className="text-sm">
                会话{convItems.length ? ` · ${convItems.length}` : ""}
              </Typography.Paragraph>
            </View>
            <View className="overflow-hidden rounded-3xl bg-surface">
              {convItems.map((item, index) => {
                const rowKey =
                  item.kind === "agent" ? `agent:${item.agent.id}` : `channel:${item.channel.id}`;
                const busyId =
                  item.kind === "agent"
                    ? openingId === item.agent.id
                    : openingId === item.channel.id;
                return (
                  <View key={rowKey}>
                    {index > 0 ? <Separator className="mx-4" /> : null}
                    {item.kind === "agent" ? (
                      <AgentRow
                        agent={item.agent}
                        busy={busyId}
                        locked={openingId !== null}
                        status={liveOk ? presenceByAgent[item.agent.id] || "idle" : "idle"}
                        online={isBotOnline(item.agent.id, item.agent.online)}
                        onOpen={() => void openAgent(item.agent.id)}
                        onEdit={() => {
                          setEditingAgent(item.agent);
                          setEditorOpen(true);
                        }}
                        onClone={() => setCloneAgent(item.agent)}
                        onDelete={() => void removeAgent(item.agent)}
                      />
                    ) : (
                      <ChannelRow
                        channel={item.channel}
                        faces={channelMemberFaces(item.channel, agents, agentNameById)}
                        busy={busyId}
                        locked={openingId !== null}
                        isBotOnline={isBotOnline}
                        onOpen={() => void openChannel(item.channel.id)}
                        onDelete={() => void removeChannel(item.channel)}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View className="mb-safe-offset-6" />
      </ScrollView>

      <AgentEditor
        agent={editingAgent}
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingAgent(null);
        }}
        onSaved={load}
      />

      <CloneAgentSheet
        agent={cloneAgent}
        visible={Boolean(cloneAgent)}
        onClose={() => setCloneAgent(null)}
        onCloned={(res) => {
          setCurrentBot({ id: res.agent.id, name: res.agent.name });
          void load();
        }}
      />

      <ChannelEditor open={channelOpen} onClose={() => setChannelOpen(false)} onSaved={load} />
    </View>
  );
}

function ChannelAvatarStack({
  faces,
  isBotOnline,
  size = 28,
}: {
  faces: MemberFace[];
  isBotOnline: (id: string, snapshot?: boolean) => boolean;
  size?: number;
}): JSX.Element {
  const shown = faces.slice(0, 3);
  if (shown.length === 0) {
    return (
      <Avatar>
        <Avatar.Fallback>
          <Icon name="people" size={18} tone="muted" />
        </Avatar.Fallback>
      </Avatar>
    );
  }
  return (
    <View className="flex-row items-center" style={{ width: size + (shown.length - 1) * (size * 0.55) }}>
      {shown.map((p, i) => (
        <View
          key={p.agent_id}
          style={{ marginLeft: i === 0 ? 0 : -size * 0.45, zIndex: shown.length - i }}
        >
          <AgentAvatar
            id={p.agent_id}
            name={p.name}
            size={size}
            shape={p.avatar_shape}
            color={p.avatar_color}
            online={isBotOnline(p.agent_id, p.online)}
          />
        </View>
      ))}
    </View>
  );
}

function AgentRow({
  agent,
  busy,
  locked,
  status,
  online,
  onOpen,
  onEdit,
  onClone,
  onDelete,
}: {
  agent: Agent;
  busy: boolean;
  locked: boolean;
  status: string;
  online: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}): JSX.Element {
  const snippet = (agent.last_message || agent.description || "").trim() || "尚未开始对话";
  return (
    <View className="flex-row items-center gap-3 py-3 pl-4 pr-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开 ${agent.name}`}
        accessibilityState={{ busy }}
        disabled={locked}
        onPress={onOpen}
      >
        <AgentAvatar
          id={agent.id}
          name={agent.name}
          size={48}
          shape={agent.avatar_shape}
          color={agent.avatar_color}
          status={status}
          online={online}
        />
      </Pressable>

      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1">
          <Pressable
            className="min-w-0 flex-1 flex-row items-center gap-1.5"
            accessibilityRole="button"
            accessibilityLabel={`打开 ${agent.name}`}
            accessibilityState={{ busy }}
            disabled={locked}
            onPress={onOpen}
          >
            <Typography.Paragraph
              weight="medium"
              numberOfLines={1}
              className="min-w-0 shrink text-lg"
            >
              {agent.name}
            </Typography.Paragraph>
            {agent.task_active ? (
              <View className="h-1.5 w-1.5 rounded-full bg-success" accessibilityLabel="回复中" />
            ) : null}
            <View className="flex-1" />
            {agent.conversation_updated_at ? (
              <Typography.Paragraph type="body-sm" color="muted" className="shrink-0">
                {formatRelativeTime(agent.conversation_updated_at)}
              </Typography.Paragraph>
            ) : null}
            {busy ? <Spinner size="sm" /> : null}
          </Pressable>
          <RowMenu
            title={agent.name}
            locked={locked}
            onEdit={onEdit}
            onClone={onClone}
            onDelete={onDelete}
          />
        </View>
        <Pressable disabled={locked} onPress={onOpen}>
          <Typography.Paragraph type="body-sm" color="muted" numberOfLines={1} className="mt-0.5">
            {snippet}
          </Typography.Paragraph>
        </Pressable>
      </View>
    </View>
  );
}

function ChannelRow({
  channel,
  faces,
  busy,
  locked,
  isBotOnline,
  onOpen,
  onDelete,
}: {
  channel: Channel;
  faces: MemberFace[];
  busy: boolean;
  locked: boolean;
  isBotOnline: (id: string, snapshot?: boolean) => boolean;
  onOpen: () => void;
  onDelete: () => void;
}): JSX.Element {
  const memberNames = faces.map((f) => f.name).join("、") || "无成员";
  return (
    <View className="flex-row items-center gap-3 py-3 pl-4 pr-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`打开群聊 ${channel.name}`}
        accessibilityState={{ busy }}
        disabled={locked}
        onPress={onOpen}
      >
        <ChannelAvatarStack faces={faces} isBotOnline={isBotOnline} size={40} />
      </Pressable>

      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1">
          <Pressable
            className="min-w-0 flex-1 flex-row items-center gap-1.5"
            accessibilityRole="button"
            accessibilityLabel={`打开群聊 ${channel.name}`}
            accessibilityState={{ busy }}
            disabled={locked}
            onPress={onOpen}
          >
            <Typography.Paragraph
              weight="medium"
              numberOfLines={1}
              className="min-w-0 shrink text-lg"
            >
              {channel.name}
            </Typography.Paragraph>
            {channel.task_active ? (
              <View className="h-1.5 w-1.5 rounded-full bg-success" accessibilityLabel="回复中" />
            ) : null}
            <View className="flex-1" />
            {channel.created_at ? (
              <Typography.Paragraph type="body-sm" color="muted" className="shrink-0">
                {formatRelativeTime(channel.created_at)}
              </Typography.Paragraph>
            ) : null}
            {busy ? <Spinner size="sm" /> : null}
          </Pressable>
          <RowMenu title={channel.name} locked={locked} onDelete={onDelete} />
        </View>
        <Pressable disabled={locked} onPress={onOpen}>
          <Typography.Paragraph type="body-sm" color="muted" numberOfLines={1} className="mt-0.5">
            {memberNames}
          </Typography.Paragraph>
        </Pressable>
      </View>
    </View>
  );
}

function RowMenu({
  title,
  locked,
  onEdit,
  onClone,
  onDelete,
}: {
  title: string;
  locked: boolean;
  onEdit?: () => void;
  onClone?: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <Menu>
      <Menu.Trigger asChild isDisabled={locked}>
        <Button size="sm" variant="ghost" isIconOnly accessibilityLabel={`管理 ${title}`}>
          <Icon name="ellipsis-horizontal" size={18} tone="muted" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay closeOnPress />
        <Menu.Content presentation="popover" width={180}>
          {onEdit ? (
            <Menu.Item onPress={onEdit}>
              <Menu.ItemTitle>编辑</Menu.ItemTitle>
            </Menu.Item>
          ) : null}
          {onClone ? (
            <Menu.Item onPress={onClone}>
              <Menu.ItemTitle>复制助手</Menu.ItemTitle>
            </Menu.Item>
          ) : null}
          <Menu.Item variant="danger" onPress={onDelete}>
            <Menu.ItemTitle>删除</Menu.ItemTitle>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

function ChannelEditor({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setError(null);
  }, []);

  async function submit(): Promise<void> {
    if (!name.trim()) {
      setError("请填写群聊名称");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createChannel(name.trim());
      reset();
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog isOpen={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress>
          <Dialog.Content>
            <Dialog.Title>新建群聊</Dialog.Title>
            <View className="mt-4">
              <FormField
                label="名称"
                value={name}
                onChangeText={setName}
                placeholder="项目讨论组"
                error={error}
                required
              />
              <Typography.Paragraph color="muted" className="mt-2 text-xs">
                创建后可在群聊里 @ 助手名字点名回复；成员在设置里调整。
              </Typography.Paragraph>
            </View>
            <View className="mt-5 flex-row justify-end gap-3">
              <Button
                variant="secondary"
                onPress={() => {
                  reset();
                  onClose();
                }}
              >
                <Button.Label>取消</Button.Label>
              </Button>
              <Button isDisabled={busy} onPress={() => void submit()}>
                {busy ? <Spinner size="sm" /> : null}
                <Button.Label>创建</Button.Label>
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}
