import { Button, Card, Chip, ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { Agent, AgentBusMessage, AgentBusWSEvent, Channel } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

/**
 * 协作收件箱（agent-bus）。
 *
 * 对齐 Web 端 `apps/web/src/App.tsx` 的 bus 能力：看助手之间的协作消息、手动投递一条、
 * 管频道成员。
 *
 * 实时性策略与 Web 端一致 —— **WS 优先，断线回退 3 秒短轮询，连上就停掉轮询**：
 * - `GET /v1/agent-bus/ws` 由 `busHub` 按 user 广播 `{ type:"agent_message", message }`；
 * - 移动网络下 WS 握手常被中间设备掐断，单靠 WS 会静默丢消息，所以保留轮询兜底；
 * - 轮询只在 WS 未就绪时跑，避免同一条消息被两条通道重复灌入（合并时按 id 去重）。
 *
 * 注意 WS 地址是 `Promise`：`api.agentBusWebSocketUrl()` 内部要走异步的 `getToken`。
 */

/** 断线时的轮询间隔，与 Web 端一致 */
const POLL_MS = 3000;
/** WS 断开后的重连间隔；太短会在服务端重启时形成重连风暴 */
const RECONNECT_MS = 3000;

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 未读 = read_at 为空；与后端 `MarkAgentMessageRead` 的判定口径保持一致 */
function isUnread(m: AgentBusMessage): boolean {
  return !m.read_at;
}

/** 收件人一侧展示：单发是助手名，群发是频道名，都没有就标「广播」 */
function targetLabel(m: AgentBusMessage, agents: Agent[], channels: Channel[]): string {
  if (m.channel_id) {
    return channels.find((c) => c.id === m.channel_id)?.name ?? "频道";
  }
  if (m.to_agent_id) {
    return agents.find((a) => a.id === m.to_agent_id)?.name ?? "助手";
  }
  return "广播";
}

function agentName(id: string, agents: Agent[]): string {
  return agents.find((a) => a.id === id)?.name ?? id;
}

export default function CollabScreen(): JSX.Element {
  const [messages, setMessages] = useState<AgentBusMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [msg, setMsg] = useState("");

  // 发送表单
  const [fromAgent, setFromAgent] = useState("");
  const [targetKind, setTargetKind] = useState<"agent" | "channel">("agent");
  const [toAgent, setToAgent] = useState("");
  const [channelId, setChannelId] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState<string | null>(null);
  const [memberPick, setMemberPick] = useState<Record<string, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 卸载后禁止任何 setState / 重连，避免对已销毁组件排队异步回调 */
  const aliveRef = useRef(true);

  /** 合并新消息：按 id 去重并保持「priority 在前、时间倒序」，与后端列表排序一致 */
  const merge = useCallback((prev: AgentBusMessage[], incoming: AgentBusMessage[]) => {
    const map = new Map(prev.map((m) => [m.id, m]));
    for (const m of incoming) map.set(m.id, { ...map.get(m.id), ...m });
    return [...map.values()].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
    });
  }, []);

  /** 拉到未读就顺手标记已读：收件箱打开着，未读标记留着没有意义 */
  const markRead = useCallback(async (m: AgentBusMessage) => {
    if (!isUnread(m)) return;
    // 先本地消掉红点，再发请求：等网络往返会让未读标记「闪」一下
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, read_at: new Date().toISOString() } : x))
    );
    try {
      await api.markAgentBusRead(m.id);
    } catch {
      // 标记失败不影响展示：下轮轮询会再试一次
    }
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!aliveRef.current) return;
      try {
        if (!silent) setError(null);
        const [msgs, agentList, channelList] = await Promise.all([
          api.listAgentBusInbox(),
          api.listAgents(),
          api.listChannels().catch(() => [] as Channel[]),
        ]);
        if (!aliveRef.current) return;
        setMessages((prev) => merge(prev, msgs));
        setAgents(agentList);
        setChannels(channelList);
        // 首次拿到助手后给发送表单一个默认来源，省掉一次手动选择
        setFromAgent((prev) => prev || agentList[0]?.id || "");
        for (const m of msgs) {
          if (isUnread(m)) void markRead(m);
        }
      } catch (err) {
        if (!aliveRef.current) return;
        // 轮询失败保持静默：不该让一个瞬时网络抖动把整页打成错误态
        if (!silent) setError(errText(err, "加载协作收件箱失败"));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    },
    [merge, markRead]
  );

  /** WS 就绪时停轮询；断线时立刻起 3 秒轮询兜底 */
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPoll = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void load(true), POLL_MS);
  }, [load]);

  /**
   * 建立 WS 连接。用具名函数表达式自引用来安排重连，避免 `connect` ↔ `scheduleReconnect`
   * 互相依赖，也就不需要 ref 转发（写 ref.current 在 effect 里会被 react-hooks/immutability 拦）。
   */
  const connect = useCallback(
    function self(): void {
      if (!aliveRef.current) return;
      // 上一次连接可能还挂着（重连时），先收干净
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      const scheduleReconnect = (): void => {
        if (reconnectRef.current || !aliveRef.current) return;
        reconnectRef.current = setTimeout(() => {
          reconnectRef.current = null;
          self();
        }, RECONNECT_MS);
      };

      void (async () => {
        let url: string;
        try {
          url = await api.agentBusWebSocketUrl();
        } catch {
          scheduleReconnect();
          return;
        }
        if (!aliveRef.current) return;

        let ws: WebSocket;
        try {
          // 必须用全局 WebSocket：expo/fetch 只有 fetch 语义，拿不到 upgrade 握手
          ws = new WebSocket(url);
        } catch {
          scheduleReconnect();
          return;
        }
        wsRef.current = ws;

        ws.onopen = () => {
          if (!aliveRef.current) return;
          setLive(true);
          // 连上就停轮询，避免同一条消息被两条通道重复推送
          stopPoll();
        };

        ws.onmessage = (event) => {
          if (!aliveRef.current) return;
          const raw = typeof event.data === "string" ? event.data : "";
          if (!raw) return;
          let parsed: AgentBusWSEvent;
          try {
            parsed = JSON.parse(raw) as AgentBusWSEvent;
          } catch {
            return;
          }
          if (parsed.type === "agent_message" && parsed.message) {
            const incoming = parsed.message;
            setMessages((prev) => merge(prev, [incoming]));
            if (isUnread(incoming)) void markRead(incoming);
          }
        };

        ws.onerror = () => {
          // onerror 之后一定会走 onclose，重连逻辑统一放在 onclose 里
        };

        ws.onclose = () => {
          if (wsRef.current === ws) wsRef.current = null;
          if (!aliveRef.current) return;
          setLive(false);
          // 断线：立刻起轮询兜底，同时安排重连
          startPoll();
          scheduleReconnect();
        };
      })();
    },
    [markRead, merge, startPoll, stopPoll]
  );

  useEffect(() => {
    aliveRef.current = true;

    // 首屏：先拉一次拿历史，再建立实时通道
    void load();
    connect();

    return () => {
      aliveRef.current = false;
      stopPoll();
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      const ws = wsRef.current;
      if (ws) {
        // 置空处理器，避免 close 触发的 onclose 又去起定时器
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
        wsRef.current = null;
      }
    };
  }, [connect, load, stopPoll]);

  async function send(): Promise<void> {
    const text = body.trim();
    if (!text) {
      setFormError("请填写消息内容");
      return;
    }
    const to = targetKind === "agent" ? toAgent : channelId;
    if (!to) {
      setFormError(targetKind === "agent" ? "请选择接收的助手" : "请选择接收的频道");
      return;
    }
    // from 留空时后端会回退到「第一个助手」，但显式带上更可控
    const from = fromAgent || undefined;

    setFormError(null);
    setSending(true);
    setMsg("");
    try {
      await api.postAgentBusMessage({
        from_agent_id: from,
        body: text,
        priority,
        ...(targetKind === "channel" ? { channel_id: channelId } : { to_agent_id: toAgent }),
      });
      setBody("");
      // priority 只在服务端异步唤醒助手，发完立刻拉一次让用户看到自己的消息
      setMsg(priority ? "已投递，正在唤醒对方助手…" : "已投递");
      await load(true);
    } catch (err) {
      setMsg(errText(err, "投递失败"));
    } finally {
      setSending(false);
    }
  }

  async function addMember(channelIdToAdd: string): Promise<void> {
    const agentId = memberPick[channelIdToAdd] ?? "";
    if (!agentId) {
      setMsg("请先选择要加入的助手");
      return;
    }
    setAddingMember(channelIdToAdd);
    setMsg("");
    try {
      await api.addChannelMember(channelIdToAdd, agentId);
      setMemberPick((prev) => ({ ...prev, [channelIdToAdd]: "" }));
      setMsg("已加入成员");
      await load(true);
    } catch (err) {
      setMsg(errText(err, "添加成员失败"));
    } finally {
      setAddingMember(null);
    }
  }

  const unreadCount = useMemo(() => messages.filter(isUnread).length, [messages]);

  return (
    <ScreenScaffold
      title="协作"
      subtitle={live ? "实时连接中" : "连接中断，正在轮询"}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      headerRight={
        <Button size="sm" variant="secondary" onPress={() => void load()}>
          <Button.Label>刷新</Button.Label>
        </Button>
      }
      empty={
        messages.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title="还没有协作消息" hint="在下方选一个助手，往总线上投递一条消息" />
        ) : undefined
      }
    >
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <SectionTitle>收件箱{messages.length > 0 ? ` · ${messages.length}` : ""}</SectionTitle>
          {unreadCount > 0 ? (
            <Chip size="sm" variant="soft" color="accent">
              <Chip.Label>{unreadCount} 条未读</Chip.Label>
            </Chip>
          ) : null}
        </View>

        {messages.length === 0 ? (
          <Typography.Paragraph color="muted">暂无消息。</Typography.Paragraph>
        ) : (
          <ListGroup>
            {messages.map((m) => {
              const toName = targetLabel(m, agents, channels);
              const fromName = agentName(m.from_agent_id, agents);
              return (
                <ListGroup.Item key={m.id}>
                  <ListGroup.ItemPrefix>
                    <AgentAvatar id={m.from_agent_id} name={fromName} />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <View className="flex-row items-center gap-2">
                      <ListGroup.ItemTitle numberOfLines={1}>
                        {fromName} → {toName}
                      </ListGroup.ItemTitle>
                      {m.priority ? (
                        <Chip size="sm" variant="soft" color="warning">
                          <Chip.Label>优先</Chip.Label>
                        </Chip>
                      ) : null}
                    </View>
                    <ListGroup.ItemDescription numberOfLines={3}>
                      {m.body}
                    </ListGroup.ItemDescription>
                    <Typography.Paragraph type="body-xs" color="muted">
                      {formatRelativeTime(m.created_at)} · {formatDateTime(m.created_at)}
                      {m.reply_to_id ? " · 回复" : ""}
                    </Typography.Paragraph>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    {isUnread(m) ? (
                      <Chip size="sm" variant="soft" color="accent">
                        <Chip.Label>未读</Chip.Label>
                      </Chip>
                    ) : null}
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        )}
      </View>

      <View className="gap-3">
        <SectionTitle>投递消息</SectionTitle>

        <View className="gap-2">
          <Typography.Paragraph color="muted">目标类型</Typography.Paragraph>
          <View className="flex-row gap-2">
            <Button
              size="sm"
              variant={targetKind === "agent" ? "primary" : "secondary"}
              onPress={() => setTargetKind("agent")}
            >
              <Button.Label>发给助手</Button.Label>
            </Button>
            <Button
              size="sm"
              variant={targetKind === "channel" ? "primary" : "secondary"}
              onPress={() => setTargetKind("channel")}
            >
              <Button.Label>发到频道</Button.Label>
            </Button>
          </View>
        </View>

        <FormField
          label="来源助手"
          value={agents.find((a) => a.id === fromAgent)?.name ?? fromAgent}
          onChangeText={(name) => {
            const hit = agents.find((a) => a.name === name);
            if (hit) setFromAgent(hit.id);
          }}
          placeholder={fromAgent ? "输入助手名以切换" : "默认使用第一个助手"}
          hint="消息在总线上的署名来源。留空时后端回退到第一个助手"
        />

        {targetKind === "agent" ? (
          <FormField
            label="接收助手"
            required
            value={agents.find((a) => a.id === toAgent)?.name ?? toAgent}
            onChangeText={(name) => {
              const hit = agents.find((a) => a.name === name);
              if (hit) setToAgent(hit.id);
            }}
            error={formError === "请选择接收的助手" ? formError : null}
            placeholder="输入助手名"
          />
        ) : (
          <FormField
            label="接收频道"
            required
            value={channels.find((c) => c.id === channelId)?.name ?? channelId}
            onChangeText={(name) => {
              const hit = channels.find((c) => c.name === name);
              if (hit) setChannelId(hit.id);
            }}
            error={formError === "请选择接收的频道" ? formError : null}
            placeholder="输入频道名"
            hint={channels.length === 0 ? "还没有频道，可先在首页新建群聊" : undefined}
          />
        )}

        <FormField
          label="消息内容"
          required
          multiline
          value={body}
          onChangeText={setBody}
          placeholder="要交给对方助手处理的内容"
          error={formError === "请填写消息内容" ? formError : null}
        />

        {/* priority 会让后端在后台真的把目标助手跑起来（最多 8 分钟），
            并把它的回复自动发回总线，所以默认关闭、且必须在 UI 上说明代价。 */}
        <SwitchRow
          label="优先（唤醒对方）"
          description="开启后服务端会立刻异步唤醒接收方跑一轮，并把回复自动回传总线；频道最多唤醒 3 位成员，耗时可达数分钟。"
          value={priority}
          onValueChange={setPriority}
          disabled={sending}
        />

        <Button size="sm" className="self-start" isDisabled={sending} onPress={() => void send()}>
          <Button.Label>{sending ? "投递中…" : "投递"}</Button.Label>
        </Button>
      </View>

      <View className="gap-3">
        <SectionTitle>频道成员（{channels.length}）</SectionTitle>

        {channels.length === 0 ? (
          <Card>
            <Card.Body>
              <Typography.Paragraph color="muted">
                还没有频道。回到首页，在「群聊」分区点右上角的加号创建一个。
              </Typography.Paragraph>
            </Card.Body>
          </Card>
        ) : (
          <ListGroup>
            {channels.map((c) => {
              const picked = memberPick[c.id] ?? "";
              return (
                <ListGroup.Item key={c.id}>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{c.name}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {c.members?.length ?? 0} 位成员
                    </ListGroup.ItemDescription>
                    <View className="mt-2 flex-row flex-wrap items-center gap-2">
                      <FormField
                        label="新成员"
                        value={agents.find((a) => a.id === picked)?.name ?? picked}
                        onChangeText={(name) => {
                          const hit = agents.find((a) => a.name === name);
                          setMemberPick((prev) => ({ ...prev, [c.id]: hit?.id ?? "" }));
                        }}
                        placeholder="输入助手名"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={addingMember === c.id}
                        onPress={() => void addMember(c.id)}
                      >
                        <Button.Label>加入</Button.Label>
                      </Button>
                    </View>
                  </ListGroup.ItemContent>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        )}
      </View>

      {msg ? (
        <Typography.Paragraph color="muted" className="text-xs">
          {msg}
        </Typography.Paragraph>
      ) : null}
    </ScreenScaffold>
  );
}
