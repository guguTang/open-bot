/**
 * 服务端状态的查询 hooks。
 *
 * 每个 hook 只做三件事：调 API、给查询键、声明失效关系。
 * 页面只管从 hook 拿 `{data, isLoading, error, refetch}` 和调 mutation，
 * 不再自己管 loading / error / 竞态 / 缓存 —— 那些是 TanStack Query 的活。
 *
 * 写操作一律走 `useMutation` 并在 `onSuccess` 里精确失效相关键，
 * 不做「全量 invalidate」。全量失效会让每个页面都重打一轮接口，
 * 在移动网络上代价很实在。
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import * as api from "@/api";
import { clearStoredMachineId, getStoredMachineId, setStoredMachineId } from "@/api/client";
import type {
  Agent,
  AgentInput,
  AgentSkill,
  BotSecretResolveInput,
  Channel,
  LLMConnection,
  LLMInput,
  Machine,
  MCPServer,
  MCPServerInput,
  Routine,
  RoutineInput,
  Sandbox,
  Skill,
} from "@/api/types";
import { qk } from "@/queries/client";

/* ------------------------------------------------------------------ 助手 / 群聊 */

export function useAgents(): UseQueryResult<Agent[]> {
  return useQuery({ queryKey: qk.agents, queryFn: api.listAgents });
}

export function useChannels(): UseQueryResult<Channel[]> {
  return useQuery({ queryKey: qk.channels, queryFn: api.listChannels });
}

/** 助手增删改。任何一个都会让列表失效 —— 列表是它的直接投影。 */
export function useAgentMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.agents });
  };
  return {
    create: useMutation({ mutationFn: api.createAgent, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: AgentInput }) => api.updateAgent(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteAgent, onSuccess: invalidate }),
  };
}

export function useChannelMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.channels });
  };
  return {
    create: useMutation({
      mutationFn: ({ name, memberIds }: { name: string; memberIds?: string[] }) =>
        api.createChannel(name, memberIds),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteChannel, onSuccess: invalidate }),
    addMember: useMutation({
      mutationFn: ({ channelId, agentId }: { channelId: string; agentId: string }) =>
        api.addChannelMember(channelId, agentId),
      onSuccess: invalidate,
    }),
  };
}

/* ------------------------------------------------------------------ 会话与消息 */

export function useMessages(conversationId: string) {
  return useQuery({
    queryKey: qk.messages(conversationId),
    queryFn: () => api.listMessagesWithStatus(conversationId),
    enabled: Boolean(conversationId),
    // 聊天页自己管流式状态，这里只在重新进入 / 下拉刷新时取一次
    refetchOnMount: "always",
  });
}

/** 手动刷新（发送完成、停止后重新接管 run 都会用到）。 */
export function useRefreshMessages(conversationId: string): () => Promise<void> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.messages(conversationId) });
}

/* ------------------------------------------------------------------ 补全数据源 */

export function useAgentSkills(agentId: string | undefined) {
  return useQuery({
    queryKey: qk.agentSkills(agentId ?? "none"),
    queryFn: () => api.listAgentSkills(agentId as string),
    enabled: Boolean(agentId),
  });
}

export function useRoutines(): UseQueryResult<Routine[]> {
  return useQuery({ queryKey: qk.routines, queryFn: api.listRoutines });
}

export function useMcpServers(): UseQueryResult<MCPServer[]> {
  return useQuery({ queryKey: qk.mcpServers, queryFn: api.listMCPServers });
}

/* ------------------------------------------------------------------ 设置页 */

export function useLlmConnections(): UseQueryResult<LLMConnection[]> {
  return useQuery({ queryKey: qk.llmConnections, queryFn: api.listLLMConnections });
}

export function useSkills(): UseQueryResult<Skill[]> {
  return useQuery({ queryKey: qk.skills, queryFn: api.listSkills });
}

export function useMachines(): UseQueryResult<Machine[]> {
  return useQuery({ queryKey: qk.machines, queryFn: api.listMachines });
}

export function useUserSettings() {
  return useQuery({ queryKey: qk.userSettings, queryFn: api.fetchUserSettings });
}

export function useInboundHooks() {
  return useQuery({ queryKey: qk.inboundHooks, queryFn: api.listInboundHooks });
}

export function useAgentLessons(agentId: string) {
  return useQuery({
    queryKey: qk.agentLessons(agentId),
    queryFn: () => api.listAgentLessons(agentId),
    enabled: Boolean(agentId),
  });
}

/* ------------------------------------------------------------------ 设置页的写操作 */

/** 系统选择器选中的 zip（本地 uri + 元信息，与 uploadSkillPackage 的入参一致）。 */
type PickedZip = { uri: string; name: string; mime: string };

/**
 * 本机登记 id 的查询键。
 *
 * 它存的是本机（SecureStore），不是服务端，但仍然走 useQuery：读取是异步的，
 * 而且登记 / 移除本机之后需要一个能直接改写的缓存入口。放在这里而不是
 * `qk` 里，是因为它只被这两个 hook 用，不必让所有页面都看见这把键。
 */
export const qkMachineSelfId = ["machine-self-id"] as const;

/**
 * 把一组 mutation 的 pending 合成一个 `busy`。
 *
 * 设置页原本就是「整页共用一个 busy」（保存、删除、切策略期间所有按钮一起禁用），
 * 这个 hook 只是把那个布尔值的来源从 useState 换成 mutation 状态，
 * 交互不变，也省掉每页各维护一份 loading state。
 */
export function useBusy(...mutations: { isPending: boolean }[]): boolean {
  return mutations.some((m) => m.isPending);
}

/* ------------------------------------------------------------------ 模型连接 */

/**
 * 模型连接的写操作。四个都只改「连接列表」这一份数据，
 * 所以只失效 `llmConnections`，不动别的键。
 *
 * `invalidate` 直接返回 promise（不 void 掉）：调用方 `await mutateAsync()`
 * 之后拿到的就是刷新过的列表 —— llm 页新建完要知道「列表里还有几条」来决定
 * 表单是否勾「设为默认」，等一次重取比再猜一次可靠。
 */
export function useLlmMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.llmConnections });
  return {
    create: useMutation({ mutationFn: api.createLLMConnection, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<LLMInput> }) =>
        api.updateLLMConnection(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteLLMConnection, onSuccess: invalidate }),
    setDefault: useMutation({ mutationFn: api.setDefaultLLMConnection, onSuccess: invalidate }),
  };
}

/* ------------------------------------------------------------------ Skills */

/** 技能开关 / 上传 / 删除。三者共享同一个列表失效。 */
export function useSkillMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.skills });
  return {
    setEnabled: useMutation({
      mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
        api.setSkillEnabled(name, enabled),
      onSuccess: invalidate,
    }),
    /** 正文 Markdown 与 zip 包落在同一个列表里，所以合并成一个 mutation，两条路共用一次失效。 */
    upload: useMutation({
      mutationFn: (
        input: { name: string; description: string; body_markdown: string } | { zip: PickedZip }
      ) => ("zip" in input ? api.uploadSkillPackage(input.zip) : api.uploadSkill(input)),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteSkill, onSuccess: invalidate }),
  };
}

/* ------------------------------------------------------------------ MCP */

export function useMcpMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.mcpServers });
  return {
    create: useMutation({ mutationFn: api.createMCPServer, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<MCPServerInput> }) =>
        api.updateMCPServer(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteMCPServer, onSuccess: invalidate }),
    /**
     * 「测试连接」和「手动调用工具」都是 POST，但不改服务端状态：
     * 结果只回显在当前面板里，所以没有任何键需要失效。
     * 仍然包成 mutation，是为了拿到 pending 去禁用按钮。
     */
    test: useMutation({ mutationFn: api.testMCPServer }),
    callTool: useMutation({ mutationFn: api.mcpCallTool }),
  };
}

/* ------------------------------------------------------------------ 例行任务 */

export function useRoutineMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.routines });
  return {
    create: useMutation({ mutationFn: api.createRoutine, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Partial<RoutineInput> }) =>
        api.updateRoutine(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteRoutine, onSuccess: invalidate }),
    /** 「立即运行」会写一条运行记录（列表里的 last_run 随之变化），所以同样失效列表。 */
    run: useMutation({ mutationFn: api.runRoutine, onSuccess: invalidate }),
  };
}

/** 入站 Webhook 的创建 / 删除。例行任务页和它们同屏，但键是分开的。 */
export function useInboundHookMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.inboundHooks });
  return {
    create: useMutation({ mutationFn: api.createInboundHook, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: api.deleteInboundHook, onSuccess: invalidate }),
  };
}

/* ------------------------------------------------------------------ 本机登记 */

/**
 * 本机在服务端记录里的 id。
 *
 * 注意它不来自服务端而是本机存储，但仍然是一把 query：
 * 登记完 / 移除本机之后要能就地改写（setQueryData），否则还得等一次重取。
 */
export function useStoredMachineId() {
  return useQuery({
    queryKey: qkMachineSelfId,
    queryFn: getStoredMachineId,
    staleTime: Infinity,
  });
}

export function useMachineMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.machines });
  return {
    register: useMutation({
      mutationFn: api.registerMachine,
      onSuccess: async (machine) => {
        await invalidate();
        await setStoredMachineId(machine.id);
        // 这把键 staleTime 是 Infinity，不显式写回的话下次进页面还是「未登记」
        qc.setQueryData(qkMachineSelfId, machine.id);
      },
    }),
    heartbeat: useMutation({ mutationFn: api.heartbeatMachine, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({
        id,
        body,
      }: {
        id: string;
        body: { label?: string; exec_policy?: "allow" | "ask" | "deny" | string };
      }) => api.updateMachine(id, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: api.deleteMachine,
      onSuccess: async (_result, id) => {
        await invalidate();
        // 删掉的正是本机时清掉本地缓存，否则下次打开还会以为自己已登记
        if (id && (await getStoredMachineId()) === id) {
          await clearStoredMachineId();
          qc.setQueryData(qkMachineSelfId, null);
        }
      },
    }),
  };
}

/* ------------------------------------------------------------------ 沙箱 */

/**
 * 运行环境状态。
 *
 * 不带 `ensure`：单纯打开页面不应该有「把运行环境拉起来」的副作用，
 * 启动必须是用户显式点的动作。
 */
export function useSandbox(): UseQueryResult<Sandbox> {
  return useQuery({ queryKey: qk.sandbox, queryFn: () => api.getSandbox() });
}

/**
 * 运行环境的状态变更。
 *
 * 这些接口全都把**最新的 Sandbox 原样返回**，所以直接写缓存即可 ——
 * 既不会漏字段，也省掉一次 GET（在移动网络上这一下是实打实的）。
 */
export function useSandboxMutations() {
  const qc = useQueryClient();
  const write = (sandbox: Sandbox) => qc.setQueryData(qk.sandbox, sandbox);
  return {
    ensure: useMutation({
      mutationFn: (opts?: { desktop?: boolean }) => api.ensureSandbox(opts),
      onSuccess: write,
    }),
    stop: useMutation({ mutationFn: api.stopSandbox, onSuccess: write }),
    checkpoint: useMutation({
      mutationFn: api.checkpointSandbox,
      onSuccess: (res) => write(res.sandbox),
    }),
    reset: useMutation({ mutationFn: api.resetSandbox, onSuccess: (res) => write(res.sandbox) }),
  };
}

/* ------------------------------------------------------------------ 密钥 */

export function useBotSecrets() {
  return useQuery({ queryKey: qk.botSecrets(), queryFn: () => api.listBotSecrets() });
}

/** 待授权请求的轮询间隔：助手随时可能发起新的请求，这把键得主动盯着（与 Web 端同频 8s）。 */
const SECRET_REQUEST_POLL_MS = 8000;

export function useSecretRequests() {
  return useQuery({
    queryKey: qk.secretRequests,
    queryFn: api.listBotSecretRequests,
    refetchInterval: SECRET_REQUEST_POLL_MS,
    // 回到前台立刻取一次：请求可能早就发出来了，别让用户盯着旧列表等满一个轮询周期。
    refetchOnMount: "always",
  });
}

/**
 * 密钥的写操作：新增 / 删除，以及待授权请求的「授权 / 忽略」。
 *
 * 这里同时失效**两把键**（而不是一把）：授权一条请求会把凭据落库，
 * 「已保存」列表跟着变；只失效请求列表会让列表少一条，看着像密钥丢了。
 * 这仍然是精确失效，不是全量。
 */
export function useBotSecretMutations() {
  const qc = useQueryClient();
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.botSecrets() }),
      qc.invalidateQueries({ queryKey: qk.secretRequests }),
    ]).then(() => undefined);
  return {
    create: useMutation({ mutationFn: api.createBotSecret, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: api.deleteBotSecret, onSuccess: invalidate }),
    resolve: useMutation({
      mutationFn: ({ id, body }: { id: string; body: BotSecretResolveInput }) =>
        api.resolveBotSecretRequest(id, body),
      onSuccess: invalidate,
    }),
  };
}

/* ------------------------------------------------------------------ 压缩 */

/**
 * 压缩阈值（只读展示）。
 *
 * `fetchCompactConfig` 内部已经把失败兜底成 null（不抛），所以这把键永远不会进错误态：
 * 「读不到」和「服务端没配」都表现为 data 为 null，页面据此走空态提示。
 */
export function useCompactConfig() {
  return useQuery({ queryKey: qk.compactConfig, queryFn: api.fetchCompactConfig });
}

/* ------------------------------------------------------------------ 用户设置 */

/**
 * 用户设置（时区 / 自动审核 / 审核规则）的写操作。
 *
 * `PUT /v1/me/settings` 整份返回最新设置，所以直接写缓存：
 * 页面上「改即存」连续点好几次时，每次都以服务端回读的那份为准，
 * 不会出现本地 state 和另一端的并发修改互相覆盖。
 */
export function useUserSettingsMutations() {
  const qc = useQueryClient();
  return {
    update: useMutation({
      mutationFn: api.updateUserSettings,
      onSuccess: (next) => qc.setQueryData(qk.userSettings, next),
    }),
  };
}

/* ------------------------------------------------------------------ 助手技能 */

/**
 * 单个技能的启停。响应就是被改的那一行，直接替换缓存里对应项 ——
 * 比整把键重取省一次请求，也和原来的「就地更新这一行」完全一致。
 */
export function useAgentSkillMutations() {
  const qc = useQueryClient();
  return {
    setEnabled: useMutation({
      mutationFn: ({
        agentId,
        name,
        enabled,
      }: {
        agentId: string;
        name: string;
        enabled: boolean;
      }) => api.setAgentSkill(agentId, name, enabled),
      onSuccess: (next, vars) => {
        qc.setQueryData<AgentSkill[]>(qk.agentSkills(vars.agentId), (prev) =>
          prev?.map((s) => (s.name === next.name ? next : s))
        );
      },
    }),
  };
}
