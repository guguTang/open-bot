import { Avatar, Button, Dialog, Menu, Separator, Spinner, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import * as api from "@/api";
import type { Agent, Channel } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentEditor } from "@/components/AgentEditor";
import { Icon } from "@/components/Icon";
import { FormField } from "@/components/FormField";
import { EmptyState, ErrorAlert, ListSkeleton } from "@/components/states";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatRelativeTime } from "@/lib/format";
import { useSession } from "@/providers/session";

type Row =
  | { kind: "agent"; id: string; title: string; subtitle: string; time?: string }
  | { kind: "channel"; id: string; title: string; subtitle: string; time?: string };

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

  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [agentList, channelList] = await Promise.all([
        api.listAgents(),
        api.listChannels().catch(() => [] as Channel[]),
      ]);
      setAgents(agentList);
      setChannels(channelList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openAgent = useCallback(
    async (agentId: string): Promise<void> => {
      if (openingId) return;
      setOpeningId(agentId);
      try {
        const conversation = await api.openPrimaryConversation(agentId);
        router.push(`/chats/${conversation.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "打开会话失败");
      } finally {
        setOpeningId(null);
      }
    },
    [openingId, router]
  );

  const openChannel = useCallback(
    async (channelId: string): Promise<void> => {
      if (openingId) return;
      setOpeningId(channelId);
      try {
        const { conversation } = await api.openChannelConversation(channelId);
        router.push(`/chats/${conversation.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "打开群聊失败");
      } finally {
        setOpeningId(null);
      }
    },
    [openingId, router]
  );

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
        await api.deleteAgent(agent.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除失败");
      }
    },
    [confirm, load]
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
        await api.deleteChannel(channel.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除失败");
      }
    },
    [confirm, load]
  );

  const agentRows = useMemo<Row[]>(
    () =>
      agents.map((a) => ({
        kind: "agent",
        id: a.id,
        title: a.name,
        subtitle: a.last_message || a.description || "还没有对话",
        ...(a.conversation_updated_at ? { time: a.conversation_updated_at } : {}),
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
                  <Typography.Paragraph weight="medium">{user?.username?.[0] ?? "?"}</Typography.Paragraph>
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
        {error ? <ErrorAlert title="出了点问题" description={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <ListSkeleton rows={5} />
        ) : (
          <>
            <View className="gap-3">
              <SectionLabel label="助手" count={agentRows.length} />

              {agentRows.length === 0 ? (
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
              ) : (
                <RowGroup
                  rows={agentRows}
                  busyId={openingId}
                  onOpen={(item) => void (item.kind === "channel" ? openChannel(item.id) : openAgent(item.id))}
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

            {channelRows.length > 0 || !loading ? (
              <View className="gap-3">
                <SectionLabel
                  label="群聊"
                  count={channelRows.length}
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

                {channelRows.length === 0 ? (
                  <Typography.Paragraph color="muted" className="px-1 text-sm">
                    还没有群聊。建一个让多个助手一起回答，用 @ 点名。
                  </Typography.Paragraph>
                ) : (
                  <RowGroup
                    rows={channelRows}
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

/** 分区小标题。标题本身承载信息，右侧只放该分区的动作，不混别的东西。 */
function SectionLabel({
  label,
  count,
  action,
}: {
  label: string;
  count?: number;
  action?: ReactNode;
}): JSX.Element {
  return (
    <View className="flex-row items-center justify-between px-1">
      <Typography.Paragraph color="muted" className="text-sm">
        {label}
        {count ? ` · ${count}` : ""}
      </Typography.Paragraph>
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
          <AgentAvatar id={item.id} name={item.title} />
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