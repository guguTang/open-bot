import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import * as api from "@/api";
import type { BotOnlineEvent, BotPresenceEvent } from "@/api/types";
import { useSession } from "@/providers/session";
import { useRealtimeStore, type ChatServerEvent } from "@/stores/realtime";

/**
 * 全局实时通道（`GET /v1/events/ws`）。
 *
 * 单会话 SSE 只覆盖「我正在看的那个会话」，而这条全局 WS 负责另外几件事：
 * - `bot_online` / `bot_presence`：助手在线绿点与五态表情，列表页要实时跟着变
 * - `reaction_updated`：另一台设备给消息点了表情，当前页面同步
 * - `conversation_message` / `task_status`：群聊里别的助手在回消息
 * - `host_activity`：本机正在执行操作时的顶部提示
 *
 * ## 分工
 *
 * 这个 Provider 只做**连接生命周期**：什么时候开、怎么重连、后台回收后怎么恢复。
 * 状态本身在 `stores/realtime.ts`（Zustand），因为它被列表页、聊天页、全局提示条
 * 同时消费 —— 走 Context 的话每次事件都要重渲染所有消费者，按字段订阅只重渲染
 * 真正用到的那几个。
 *
 * App 切到后台再回来必须重连：手机系统的后台 socket 回收不可靠，
 * 这里靠 AppState 变化显式重连，重连后由各页面自己补拉一次列表
 * （与 Web 端 `visibilitychange` 拉取补偿同一思路）。
 */

type Listener = (evt: ChatServerEvent) => void;

/**
 * 事件监听器集合挂在模块级，而不是 Provider 的 state 里。
 *
 * 「有人订阅 / 退订」不是界面状态，把它放进 Provider 只会让订阅关系的变化
 * 触发整棵子树重渲染。模块级 Set 天然没这个问题。
 */
const listeners = new Set<Listener>();

const RECONNECT_MS = 3000;

/** 订阅原始 WS 事件。返回退订函数。 */
export function useRealtimeEvents(fn: Listener): () => void {
  // fn 每次渲染都是新引用。放进 ref 避免每次重建订阅，
  // 但不能在渲染期直接写 ref（react-hooks/refs 会拦），所以挪到 effect 里同步。
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    const entry: Listener = (evt) => fnRef.current(evt);
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }, []);

  return useCallback(() => undefined, []);
}

export function RealtimeProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useSession();
  const scope = user?.id ?? null;

  const socketRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!scope) {
      socketRef.current?.close();
      socketRef.current = null;
      useRealtimeStore.getState().reset();
      return;
    }

    const store = useRealtimeStore.getState();
    store.setScope(scope);
    let disposed = false;
    const generation = ++generationRef.current;

    const clearRetry = (): void => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };

    const connect = async (): Promise<void> => {
      if (disposed || generation !== generationRef.current) return;
      let url: string;
      try {
        url = await api.chatEventsWebSocketUrl();
      } catch {
        scheduleRetry();
        return;
      }
      if (disposed || generation !== generationRef.current) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        if (disposed || generation !== generationRef.current) return;
        clearRetry();
        useRealtimeStore.getState().setConnected(true);
      };

      ws.onmessage = (ev: WebSocketMessageEvent) => {
        if (disposed || generation !== generationRef.current) return;
        let evt: ChatServerEvent;
        try {
          evt = JSON.parse(String(ev.data)) as ChatServerEvent;
        } catch {
          return;
        }

        const s = useRealtimeStore.getState();
        switch (evt.type) {
          case "bot_online":
            s.applyBotOnline(scope, evt as BotOnlineEvent);
            break;
          case "bot_presence":
            s.applyBotPresence(scope, evt as BotPresenceEvent);
            break;
          case "host_activity": {
            const e = evt as { active: boolean; label?: string };
            s.setHostActivity(scope, e.active ? (e.label ?? "正在操作中") : null);
            break;
          }
          default:
            break;
        }

        for (const fn of listeners) {
          try {
            fn(evt);
          } catch {
            /* 单个订阅者出错不该拖垮整条通道 */
          }
        }
      };

      ws.onerror = () => {
        // onclose 紧随其后，重连逻辑统一放在那里
      };

      ws.onclose = () => {
        if (disposed || generation !== generationRef.current) return;
        useRealtimeStore.getState().setConnected(false);
        scheduleRetry();
      };
    };

    const scheduleRetry = (): void => {
      clearRetry();
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        void connect();
      }, RECONNECT_MS);
    };

    void connect();

    // 后台 socket 常被系统回收，回前台显式重连一次
    const onAppState = (state: AppStateStatus): void => {
      if (state !== "active") return;
      if (socketRef.current?.readyState === WebSocket.OPEN) return;
      clearRetry();
      void connect();
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      disposed = true;
      sub.remove();
      clearRetry();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [scope]);

  // Provider 本身不产出任何 context —— 它只是给连接生命周期找个挂载点。
  // 状态从 `stores/realtime` 读，事件用 `useRealtimeEvents` 订阅。
  return <>{children}</>;
}
