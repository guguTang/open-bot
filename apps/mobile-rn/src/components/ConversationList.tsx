import { Button, ListGroup, Menu, Separator, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { Agent, Conversation } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { Icon } from "@/components/Icon";
import { useConfirm } from "@/components/ConfirmDialog";
import { EmptyState, ErrorAlert, ListSkeleton } from "@/components/states";
import { formatRelativeTime } from "@/lib/format";

/**
 * 会话列表。
 *
 * 覆盖 `apps/web` 侧边栏里 `deleteConversation` 的那部分能力：列出会话、点进去继续聊、
 * 删掉（破坏性操作必须先 `confirm`）。Web 端把删除挂在行内的小 × 上，RN 同理，
 * 但收进行尾的溢出菜单而不是常驻按钮 —— 每行一个红字按钮既抢视线又容易误触。
 *
 * 两种用法：
 * - 不传 `conversations`：组件自己拉 `GET /v1/conversations`，适合独立页面；
 * - 传 `conversations`：受控模式，父组件负责数据与刷新，组件只负责渲染和删除动作。
 *
 * 两种模式下删除后这一行都会立刻从本地消失：受控模式下父组件的重新拉取有网络延迟，
 * 等它回来会让用户看到一条「点了删除还在」的残留行，比多一次请求更糟。
 */

type ConversationListProps = {
  /** 不传则组件自己拉 `/v1/conversations` */
  conversations?: Conversation[];
  /** 传入后列表里显示助手名而不是裸 `agent_id` */
  agents?: Agent[];
  /** 受控模式下的加载态；自管模式下忽略 */
  loading?: boolean;
  /** 不传则默认 `router.push('/chats/{id}')` */
  onOpen?: (conversation: Conversation) => void;
  /** 删除成功后通知父组件（父组件通常借此刷新自己的数据源） */
  onDeleted?: (conversation: Conversation) => void;
  empty?: ReactNode;
};

/** 会话摘要：后端只在列表里回传 messages，最后一条最能说明这条会话在聊什么。 */
function summaryOf(conversation: Conversation): string {
  const msgs = conversation.messages;
  if (msgs && msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    const text = (last?.content ?? "").trim();
    if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  }
  return "还没有消息";
}

/** 活跃度排序：有 updated_at 用它，否则退回 created_at，最新的排最前。 */
function byActivity(a: Conversation, b: Conversation): number {
  const at = Date.parse(a.updated_at || a.created_at || "") || 0;
  const bt = Date.parse(b.updated_at || b.created_at || "") || 0;
  return bt - at;
}

export function ConversationList({
  conversations,
  agents,
  loading = false,
  onOpen,
  onDeleted,
  empty,
}: ConversationListProps): JSX.Element {
  const router = useRouter();
  const { confirm } = useConfirm();

  /** 自管模式下的数据源；受控模式下始终为空数组，不会被用到 */
  const [owned, setOwned] = useState<Conversation[]>([]);
  const [internalLoading, setInternalLoading] = useState(conversations === undefined);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * 已被本地移除的会话 id。受控模式下父组件的刷新有延迟，先记下来把这一行遮掉，
   * 免得删除成功后列表还杵着一条点不动的死行。
   */
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const selfManaged = conversations === undefined;

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      setOwned(await api.listConversations());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "加载会话失败");
    } finally {
      setInternalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selfManaged) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [selfManaged, load]);

  const rows = useMemo(() => {
    const source = conversations ?? owned;
    return source.filter((c) => !hidden.has(c.id)).sort(byActivity);
  }, [conversations, owned, hidden]);

  const agentName = useCallback(
    (agentId: string): string => agents?.find((a) => a.id === agentId)?.name ?? agentId,
    [agents]
  );

  const open = useCallback(
    (conversation: Conversation): void => {
      if (onOpen) {
        onOpen(conversation);
        return;
      }
      router.push(`/chats/${conversation.id}`);
    },
    [onOpen, router]
  );

  const remove = useCallback(
    async (conversation: Conversation): Promise<void> => {
      const ok = await confirm({
        title: `删除会话「${conversation.title || "未命名"}」？`,
        message: "该会话的全部消息会一并删除，且无法恢复。",
        confirmLabel: "删除",
        destructive: true,
      });
      if (!ok) return;

      setBusyId(conversation.id);
      try {
        await api.deleteConversation(conversation.id);
        setHidden((prev) => {
          const next = new Set(prev);
          next.add(conversation.id);
          return next;
        });
        if (selfManaged) {
          setOwned((prev) => prev.filter((c) => c.id !== conversation.id));
        }
        onDeleted?.(conversation);
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : "删除失败");
      } finally {
        setBusyId(null);
      }
    },
    [confirm, onDeleted, selfManaged]
  );

  const isLoading = selfManaged ? internalLoading : loading;

  if (isLoading) {
    return <ListSkeleton rows={4} />;
  }

  return (
    <View className="gap-3">
      {error ? <ErrorAlert title="加载失败" description={error} onRetry={() => void load()} /> : null}

      {rows.length === 0 ? (
        (empty ?? (
          <EmptyState
            icon="chatbubbles-outline"
            title="还没有会话"
            hint="在助手列表里点一个助手即可开始"
          />
        ))
      ) : (
        <ListGroup>
          {rows.map((c, index) => {
            const count = c.messages?.length ?? 0;
            return (
              <View key={c.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <View className="flex-row items-center pr-1">
                  <ListGroup.Item
                    className="flex-1"
                    accessibilityRole="button"
                    accessibilityLabel={`打开会话 ${c.title || "未命名"}`}
                    onPress={() => open(c)}
                    disabled={busyId !== null}
                  >
                    <ListGroup.ItemPrefix>
                      <AgentAvatar id={c.agent_id} name={agentName(c.agent_id)} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>
                        {c.title || "未命名会话"}
                      </ListGroup.ItemTitle>
                      <ListGroup.ItemDescription numberOfLines={1}>
                        {summaryOf(c)}
                        {count > 0 ? ` · ${count} 条` : ""}
                      </ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Typography.Paragraph type="body-sm" color="muted">
                        {formatRelativeTime(c.updated_at || c.created_at)}
                      </Typography.Paragraph>
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>

                  {/* 删除收进行尾菜单。原先每行常驻一个红色「删除」按钮：
                      既把危险动作摆在最容易误触的位置，也让整列都是噪音。 */}
                  <Menu>
                    {/* asChild：避免 trigger 与 Button 两个 Pressable 叠加 */}
                    <Menu.Trigger asChild isDisabled={busyId !== null}>
                      <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        accessibilityLabel={`管理会话 ${c.title || "未命名"}`}
                      >
                        <Icon name="ellipsis-horizontal" size={18} tone="muted" />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Overlay closeOnPress />
                      <Menu.Content presentation="popover" width={150}>
                        <Menu.Item variant="danger" onPress={() => void remove(c)}>
                          <Menu.ItemTitle>删除会话</Menu.ItemTitle>
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                </View>
              </View>
            );
          })}
        </ListGroup>
      )}
    </View>
  );
}
