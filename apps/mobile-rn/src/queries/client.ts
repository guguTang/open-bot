import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@/api/http";

/**
 * 服务端状态交给 TanStack Query。
 *
 * 2026 年 RN 社区的分工是明确的：服务端状态（列表、会话、设置页数据）和
 * 客户端状态（当前选了谁、界面偏好）分给两套工具。后者在 `stores/`，
 * 前者在这里。这么分的理由不是"时髦"，是这两类数据失败的方式不同：
 * 服务端状态会过期、会重取、需要在后台刷新、会因为写操作而失效；
 * 客户端状态不会。把它们塞进一个 store，缓存失效逻辑就会写成一团。
 *
 * ## 参数是怎么定的
 *
 * `staleTime` 偏长是针对这个产品的形态：个人助理，不是内容流。
 * 助手列表、模型连接这些数据在一次会话里几乎不变，用户也不会盯着它刷新。
 * 设成 0 会让每次进页面都打一轮网络，白花流量也白闪一下。
 *
 * `retry` 对 4xx 不重试：那是请求本身错了（没权限、参数不合法），重试只会
 * 把同一个错误重复三次再抛出来，界面上的报错还延迟了。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        // 401 交给 session provider 统一处理登出，不要在这里无脑重试
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // 写操作失败不该自动重放：比如「删除助手」重放两次等于删两遍
      retry: false,
    },
  },
});

/** 查询键工厂。集中在一处，避免各处手写字符串导致的缓存串味。 */
export const qk = {
  agents: ["agents"] as const,
  channels: ["channels"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
  messages: (id: string) => ["messages", id] as const,
  agentSkills: (agentId: string) => ["agent-skills", agentId] as const,
  routines: ["routines"] as const,
  mcpServers: ["mcp-servers"] as const,
  llmConnections: ["llm-connections"] as const,
  skills: ["skills"] as const,
  machines: ["machines"] as const,
  sandbox: ["sandbox"] as const,
  botSecrets: (agentId?: string) => ["bot-secrets", agentId ?? "all"] as const,
  secretRequests: ["secret-requests"] as const,
  inboundHooks: ["inbound-hooks"] as const,
  userSettings: ["user-settings"] as const,
  compactConfig: ["compact-config"] as const,
  agentLessons: (agentId: string) => ["agent-lessons", agentId] as const,
  inbox: ["agent-bus-inbox"] as const,
} as const;
