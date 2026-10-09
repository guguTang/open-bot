import { Avatar, Button, Dialog, Menu, Separator, Spinner, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";

import * as api from "@/api";
import type { Agent, Channel } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentEditor } from "@/components/AgentEditor";
import { Icon } from "@/components/Icon";
import { FormField } from "@/components/FormField";
import { EmptyState, ErrorAlert, ListSkeleton } from "@/components/states";
import { useConfirm } from "@/components/ConfirmDialog";
import { errText } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
import { useSession } from "@/providers/session";
import { useAgentMutations, useAgents, useChannels, useChannelMutations } from "@/queries";
import { useListPrefs, type ListPrefsState } from "@/stores/client";

/** 稳定的空数组引用，避免 `?? []` 破坏下游 memo。 */
const EMPTY_AGENTS: Agent[] = [];
const EMPTY_CHANNELS: Channel[] = [];

type Row =
  | {
      kind: "agent";
      id: string;
      title: string;
      subtitle: string;
      time?: string;
      shape?: string;
      color?: string;
      online?: boolean;
      busy?: boolean;
    }
  | { kind: "channel"; id: string; title: string; subtitle: string; time?: string };

/** 搜索命中范围与 Web 端侧边栏一致：助手看名称/描述/摘要，频道看名称。 */
function matchQuery(query: string, fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/**
 * 首页：助手列表 + 群聊频道。
 *
 * 与 Web 端侧边栏的主结构一致 —— 主导航是「助手 / 群聊」而不是「会话」，
 * 每个助手固定一条主线程（`GET /v1/agents/{id}/conversation` 取不到就建）。
 *
 * 版式上的两个决定：
 * - 列表用 `ListGroup` 而不是「一行一张 Card」。原来 20 个助手就是 20 张浮起来的
 *   卡片，容器之间只隔 4px，卡片贴着卡片 —— 表面层级越多，页面越碎。
 *   现在每个分区只有一个 surface，行与行之间是分隔线。
 * - 用 ScrollView 而不是 SectionList：这个列表长度等于「我建了几个助手」，
 *   不会长到需要虚拟化，换来的是能把 ListGroup 的开合放在同一个 JSX 里。
 */
export default function ChatsScreen(): JSX.Element {
  const router = useRouter();
  const { user, signOut } = useSession();
  const { confirm } = useConfirm();

  // 服务端状态交给 TanStack Query：加载态、错误、重取、缓存都在那边，
  // 这里只声明「要哪份数据」和「写完之后让哪份失效」。
  const agentsQuery = useAgents();
  const channelsQuery = useChannels();
  const agentMutations = useAgentMutations();
  const channelMutations = useChannelMutations();

  // 兜底数组用模块级常量：`?? []` 每次渲染都是新引用，
  // 会让下游所有 useMemo / useCallback 的依赖每次都变（等于缓存失效）
  const agents = agentsQuery.data ?? EMPTY_AGENTS;
  const channels = channelsQuery.data ?? EMPTY_CHANNELS;
  const loading = agentsQuery.isLoading;
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  /** 两个查询里任一失败都要能显示出来；群聊拉不到不该拖垮助手列表。 */
  const queryError = agentsQuery.error
    ? errText(agentsQuery.error, "加载助手失败")
    : channelsQuery.error
      ? errText(channelsQuery.error, "加载群聊失败")
      : null;

  /**
   * 「打开会话失败」「删除失败」这类**单次操作**的错误单独放。
   * 和 queryError 分开是因为它们不是一回事：查询错误会随重取自愈，
   * 操作错误必须等用户下一次操作，不该被后台刷新悄悄抹掉。
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? queryError;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 折叠状态与「上次打开」放在全局 store：列表页要读，设置页和聊天页
  // 也会用到「上次打开」这个概念。持久化由 zustand/middleware 写进 MMKV。
  const collapsedMap = useListPrefs((s) => s.collapsed);
  const lastOpened = useListPrefs((s) => s.lastOpened);
  const setLastOpened = useListPrefs((s) => s.setLastOpened);
  const toggleSection = useListPrefs((s) => s.toggleSection);

  const load = useCallback(async (): Promise<void> => {
    await Promise.all([agentsQuery.refetch(), channelsQuery.refetch()]);
    setRefreshing(false);
  }, [agentsQuery, channelsQuery]);

  const openAgent = useCallback(
    async (agentId: string): Promise<void> => {
      if (openingId) return;
      setOpeningId(agentId);
      try {
        const conversation = await api.openPrimaryConversation(agentId);
        const agent = agents.find((a) => a.id === agentId);
        const record: NonNullable<ListPrefsState["lastOpened"]> = {
          kind: "agent",
          id: agentId,
          name: agent?.name ?? "助手",
          conversation_id: conversation.id,
        };
        setLastOpened(record);
        router.push(`/chats/${conversation.id}`);
      } catch (err) {
        setActionError(errText(err, "打开会话失败"));
      } finally {
        setOpeningId(null);
      }
    },
    [agents, openingId, router, setLastOpened]
  );

  const openChannel = useCallback(
    async (channelId: string): Promise<void> => {
      if (openingId) return;
      setOpeningId(channelId);
      try {
        const { conversation } = await api.openChannelConversation(channelId);
        const channel = channels.find((c) => c.id === channelId);
        const record: NonNullable<ListPrefsState["lastOpened"]> = {
          kind: "channel",
          id: channelId,
          name: channel?.name ?? "群聊",
          conversation_id: conversation.id,
        };
        setLastOpened(record);
        router.push(`/chats/${conversation.id}`);
      } catch (err) {
        setActionError(errText(err, "打开群聊失败"));
      } finally {
        setOpeningId(null);
      }
    },
    [channels, openingId, router, setLastOpened]
  );

  /** 「继续上次」：直接回到上次那个会话，不重新走 openPrimaryConversation。 */
  const resumeLast = useCallback(async (): Promise<void> => {
    if (!lastOpened || openingId) return;
    if (lastOpened.conversation_id) {
      setOpeningId(lastOpened.id);
      router.push(`/chats/${lastOpened.conversation_id}`);
      setOpeningId(null);
      return;
    }
    if (lastOpened.kind === "agent") await openAgent(lastOpened.id);
    else await openChannel(lastOpened.id);
  }, [lastOpened, openingId, openAgent, openChannel, router]);

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
        // 走 mutation：删除成功后由 onSuccess 精确失效 agents 缓存，
        // 不用再手动 load() 把整页重打一遍
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

  const agentRows = useMemo<Row[]>(
    () =>
      agents.map((a) => ({
        kind: "agent",
        id: a.id,
        title: a.name,
        subtitle: a.last_message || a.description || "还没有对话",
        ...(a.conversation_updated_at ? { time: a.conversation_updated_at } : {}),
        ...(a.avatar_shape ? { shape: a.avatar_shape } : {}),
        ...(a.avatar_color ? { color: a.avatar_color } : {}),
        ...(a.online !== undefined ? { online: a.online } : {}),
        ...(a.task_active ? { busy: true } : {}),
      })),
    [agents]
  );

  const channelRows = useMemo<Row[]>(
    () =>
      channels.map((c) => ({
        kind: "channel",
        id: c.id,
        title: c.name,
        subtitle: `${c.members?.length ?? 0} 位成员 · @ 点名让特定助手回复`,
        ...(c.created_at ? { time: c.created_at } : {}),
      })),
    [channels]
  );

  const visibleAgents = useMemo(
    () =>
      agentRows.filter((r) =>
        matchQuery(query, [r.title, r.subtitle, agents.find((a) => a.id === r.id)?.description])
      ),
    [agentRows, agents, query]
  );

  const visibleChannels = useMemo(
    () =>
      channelRows.filter((r) =>
        matchQuery(query, [r.title, channels.find((c) => c.id === r.id)?.name])
      ),
    [channelRows, channels, query]
  );

  const searching = query.trim().length > 0;
  const openNewAgent = (): void => {
    setEditingAgent(null);
    setEditorOpen(true);
  };

  return (
    <View className="flex-1 bg-background">
      {/* 顶栏：品牌标题 + 唯一主操作（新建助手）+ 账号菜单。
          原来的「协作 / ＋助手 / 账号」三个同权重按钮没有任何主次，
          现在次要动作收进头像菜单，主操作独占一个实心按钮。 */}
      <View className="flex-row items-center justify-between border-b border-border bg-background px-5 pt-safe-offset-12 pb-3">
        <Typography.Heading type="h2">Open Bot</Typography.Heading>

        <View className="flex-row items-center gap-1">
          <Button isIconOnly onPress={openNewAgent} accessibilityLabel="新建助手">
            <Icon name="add" size={22} tone="accent-foreground" />
          </Button>

          <Menu>
            <Menu.Trigger>
              <Avatar className="ml-1">
                <Avatar.Fallback>
                  <Typography.Paragraph weight="medium">
                    {user?.username?.[0] ?? "?"}
                  </Typography.Paragraph>
                </Avatar.Fallback>
              </Avatar>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Overlay closeOnPress />
              <Menu.Content presentation="popover" width={232}>
                <Menu.Label>{user?.username ?? "未登录"}</Menu.Label>
                <Menu.Item onPress={() => router.push("/collab")}>
                  <Menu.ItemTitle>协作收件箱</Menu.ItemTitle>
                  <Menu.ItemDescription>处理待你确认的请求</Menu.ItemDescription>
                </Menu.Item>
                <Menu.Item onPress={() => router.push("/settings")}>
                  <Menu.ItemTitle>设置</Menu.ItemTitle>
                  <Menu.ItemDescription>模型、密钥、运行环境</Menu.ItemDescription>
                </Menu.Item>
                <Menu.Item variant="danger" onPress={() => void signOut()}>
                  <Menu.ItemTitle>退出登录</Menu.ItemTitle>
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

        {/* 搜索。助手看名称 / 描述 / 最后一条摘要，群聊看名称 —— 与 Web 端侧边栏一致。 */}
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

        {/* 继续上次。Web 端会直接恢复上次选中的会话；手机上首页是列表，
            所以改成一条显式入口 —— 既保留了「接着聊」的路径，又不会替用户做选择。 */}
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
                shape={agents.find((a) => a.id === lastOpened.id)?.avatar_shape}
                color={agents.find((a) => a.id === lastOpened.id)?.avatar_color}
                online={agents.find((a) => a.id === lastOpened.id)?.online}
              />
            ) : (
              <Avatar>
                <Avatar.Fallback>
                  <Icon name="people" size={18} tone="muted" />
                </Avatar.Fallback>
              </Avatar>
            )}
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph type="body-sm" color="muted">
                继续上次
              </Typography.Paragraph>
              <Typography.Paragraph weight="medium" numberOfLines={1}>
                {lastOpened.name}
              </Typography.Paragraph>
            </View>
            <Icon name="chevron-forward" size={18} tone="muted" />
          </Pressable>
        ) : null}

        {loading ? (
          <ListSkeleton rows={5} />
        ) : searching && visibleAgents.length === 0 && visibleChannels.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="没有匹配的结果"
            hint="换个关键词，或者清空搜索看看全部助手。"
          />
        ) : (
          <>
            <View className="gap-3">
              <SectionLabel
                label="助手"
                count={visibleAgents.length}
                collapsible={collapsedMap.agents === true}
                onToggle={() => toggleSection("agents")}
              />

              {visibleAgents.length === 0 ? (
                searching ? (
                  <Typography.Paragraph color="muted" className="px-1 text-sm">
                    没有匹配的助手。
                  </Typography.Paragraph>
                ) : (
                  <EmptyState
                    icon="hardware-chip-outline"
                    title="还没有助手"
                    hint="创建一个助手，它会有自己的记忆、工具和密钥。"
                    action={
                      <Button onPress={openNewAgent}>
                        <Icon name="add" size={18} tone="accent-foreground" />
                        <Button.Label>新建助手</Button.Label>
                      </Button>
                    }
                  />
                )
              ) : collapsedMap.agents === true ? null : (
                <RowGroup
                  rows={visibleAgents}
                  busyId={openingId}
                  onOpen={(item) =>
                    void (item.kind === "channel" ? openChannel(item.id) : openAgent(item.id))
                  }
                  onEdit={(item) => {
                    const target = agents.find((a) => a.id === item.id);
                    if (!target) return;
                    setEditingAgent(target);
                    setEditorOpen(true);
                  }}
                  onDelete={(item) => {
                    if (item.kind === "channel") {
                      const target = channels.find((c) => c.id === item.id);
                      if (target) void removeChannel(target);
                    } else {
                      const target = agents.find((a) => a.id === item.id);
                      if (target) void removeAgent(target);
                    }
                  }}
                />
              )}
            </View>

            {visibleChannels.length > 0 || !loading ? (
              <View className="gap-3">
                <SectionLabel
                  label="群聊"
                  count={visibleChannels.length}
                  collapsible={collapsedMap.channels === true}
                  onToggle={() => toggleSection("channels")}
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      onPress={() => setChannelOpen(true)}
                      accessibilityLabel="新建群聊"
                    >
                      <Icon name="add" size={20} tone="muted" />
                    </Button>
                  }
                />

                {visibleChannels.length === 0 ? (
                  searching ? null : (
                    <Typography.Paragraph color="muted" className="px-1 text-sm">
                      还没有群聊。建一个让多个助手一起回答，用 @ 点名。
                    </Typography.Paragraph>
                  )
                ) : collapsedMap.channels === true ? null : (
                  <RowGroup
                    rows={visibleChannels}
                    busyId={openingId}
                    onOpen={(item) => void openChannel(item.id)}
                    onDelete={(item) => {
                      const target = channels.find((c) => c.id === item.id);
                      if (target) void removeChannel(target);
                    }}
                  />
                )}
              </View>
            ) : null}
          </>
        )}

        {/* 列表底部留白：uniwind 没有 h-safe-*，用外边距等价表达「安全区 + 24」 */}
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

      <ChannelEditor open={channelOpen} onClose={() => setChannelOpen(false)} onSaved={load} />
    </View>
  );
}

/**
 * 分区小标题。标题本身承载信息，右侧只放该分区的动作，不混别的东西。
 *
 * 折叠状态由调用方持有（持久化在 SecureStore），这里只渲染箭头与点击区。
 */
function SectionLabel({
  label,
  count,
  action,
  collapsible,
  onToggle,
}: {
  label: string;
  count?: number;
  action?: ReactNode;
  collapsible?: boolean;
  onToggle?: () => void;
}): JSX.Element {
  const body = (
    <>
      <Typography.Paragraph color="muted" className="text-sm">
        {label}
        {count ? ` · ${count}` : ""}
      </Typography.Paragraph>
      {collapsible !== undefined ? (
        <Icon name={collapsible ? "chevron-down" : "chevron-up"} size={16} tone="muted" />
      ) : null}
    </>
  );

  return (
    <View className="flex-row items-center justify-between px-1">
      {collapsible !== undefined && onToggle ? (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${collapsible ? "展开" : "折叠"}${label}`}
          accessibilityState={{ expanded: !collapsible }}
          className="flex-1 flex-row items-center justify-between"
        >
          {body}
        </Pressable>
      ) : (
        <View className="flex-1 flex-row items-center justify-between">{body}</View>
      )}
      {action}
    </View>
  );
}

/**
 * 一个分区 = 一个 surface。
 *
 * 管理动作收进行尾的溢出菜单：原来的实现是「长按整行直接弹删除确认」，
 * 既没有任何可发现的入口，也意味着一次误触长按就站在了破坏性操作的门口。
 */
function RowGroup({
  rows,
  busyId,
  onOpen,
  onEdit,
  onDelete,
}: {
  rows: Row[];
  busyId: string | null;
  onOpen: (item: Row) => void;
  onEdit?: (item: Row) => void;
  onDelete: (item: Row) => void;
}): JSX.Element {
  return (
    <View className="overflow-hidden rounded-3xl bg-surface">
      {rows.map((item, index) => {
        const busy = busyId === item.id;
        return (
          <View key={`${item.kind}:${item.id}`}>
            {index > 0 ? <Separator className="mx-4" /> : null}
            <RowItem
              item={item}
              busy={busy}
              locked={busyId !== null}
              onOpen={() => onOpen(item)}
              {...(onEdit ? { onEdit: () => onEdit(item) } : {})}
              onDelete={() => onDelete(item)}
            />
          </View>
        );
      })}
    </View>
  );
}

function RowItem({
  item,
  busy,
  locked,
  onOpen,
  onEdit,
  onDelete,
}: {
  item: Row;
  busy: boolean;
  locked: boolean;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}): JSX.Element {
  const isChannel = item.kind === "channel";

  return (
    <View className="flex-row items-center pl-4 pr-1">
      <Pressable
        className="flex-1 flex-row items-center gap-3 py-3"
        accessibilityRole="button"
        accessibilityLabel={`打开 ${item.title}`}
        accessibilityState={{ busy }}
        disabled={locked}
        onPress={onOpen}
      >
        {isChannel ? (
          <Avatar>
            <Avatar.Fallback>
              <Icon name="people" size={18} tone="muted" />
            </Avatar.Fallback>
          </Avatar>
        ) : (
          <AgentAvatar
            id={item.id}
            name={item.title}
            shape={item.shape}
            color={item.color}
            online={item.online}
            busy={item.busy}
          />
        )}

        <View className="flex-1 gap-0.5">
          <Typography.Paragraph weight="medium" numberOfLines={1}>
            {item.title}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-sm" color="muted" numberOfLines={1}>
            {item.subtitle}
          </Typography.Paragraph>
        </View>

        {item.time ? (
          <Typography.Paragraph type="body-sm" color="muted">
            {formatRelativeTime(item.time)}
          </Typography.Paragraph>
        ) : null}
        {busy ? <Spinner size="sm" /> : null}
      </Pressable>

      <Menu>
        {/* asChild：让 Button 自己变成 trigger。如果不这么做，trigger 和 Button
            就是两个叠在一起的 Pressable，一次点击可能既开菜单又触发按钮。 */}
        <Menu.Trigger asChild isDisabled={locked}>
          <Button size="sm" variant="ghost" isIconOnly accessibilityLabel={`管理 ${item.title}`}>
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
            <Menu.Item variant="danger" onPress={onDelete}>
              <Menu.ItemTitle>删除</Menu.ItemTitle>
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </View>
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
