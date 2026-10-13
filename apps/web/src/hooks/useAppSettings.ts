import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { LAYOUT_NARROW_MQ, POINTER_COARSE_MQ, TOUCH_UI_WIDTH_MQ } from "../components/useIsTouchUi";
import { patchShell } from "../stores/shell";

function readSheetForm(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const touch =
    window.matchMedia(POINTER_COARSE_MQ).matches || window.matchMedia(TOUCH_UI_WIDTH_MQ).matches;
  return touch || window.matchMedia(LAYOUT_NARROW_MQ).matches;
}
import type { Agent, Machine } from "../api";
import { refreshSettingsForTab, type SettingsRefreshApi } from "../lib/app/settingsRefresh";
import { detectClientContext } from "../lib/clientEnv";
import { setHostExecMachinePolicy } from "../lib/hostExec";
import type { MachineExecPolicy } from "../lib/userSettings";
import {
  useCompactSettings,
  useLlmSettings,
  useMachinesSettings,
  useMcpSettings,
  useReviewSettings,
  useRoutinesSettings,
  useSandboxSettings,
  useSecretsSettings,
  useIntegrationsSettings,
  useSkillsSettings,
} from "./settings";
import type { ChatSettingsSlice, SettingsShell } from "./settings/types";
import type { SettingsTab } from "../types/app-ui";

export type { ChatSettingsSlice, SettingsShell } from "./settings/types";

type ClientEnv = ReturnType<typeof detectClientContext>;

type ConfirmFn = (opts: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  message?: string;
}) => Promise<boolean>;

export type UseAppSettingsOptions = {
  confirm: ConfirmFn;
  agentId: string;
  conversationId: string | undefined;
  agents: Agent[];
  userId: string | undefined;
  refreshAgents: () => Promise<unknown>;
  clientEnv: ClientEnv;
  hostMachineId: string | null;
  setHostMachineId: (id: string | null) => void;
  setHostExecPolicy: (policy: MachineExecPolicy) => void;
  setHostWritesOn: (v: boolean) => void;
};

export function useAppSettings(opts: UseAppSettingsOptions) {
  const {
    confirm,
    agentId,
    conversationId,
    agents,
    userId,
    refreshAgents,
    clientEnv,
    hostMachineId,
    setHostMachineId,
    setHostExecPolicy,
    setHostWritesOn,
  } = opts;

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [emailCopied, setEmailCopied] = useState(false);
  const llm = useLlmSettings();
  const skills = useSkillsSettings(confirm);
  const compact = useCompactSettings();
  const mcp = useMcpSettings(confirm);
  const routines = useRoutinesSettings({
    agentId,
    conversationId,
    confirm,
  });
  const sandbox = useSandboxSettings({
    agentId,
    computerMode: agents.find((a) => a.id === agentId)?.computer_mode,
    confirm,
  });
  const machinesHook = useMachinesSettings({
    clientEnv,
    hostMachineId,
    setHostMachineId,
    setHostExecPolicy,
    setHostExecMachinePolicy,
    setHostWritesOn,
  });
  const secrets = useSecretsSettings();
  const integrations = useIntegrationsSettings();
  const review = useReviewSettings(userId);

  const defaultLLM = useMemo(
    () => llm.llms.find((c) => c.is_default) ?? llm.llms[0] ?? llm.effectiveLLM ?? undefined,
    [llm.llms, llm.effectiveLLM],
  );

  const settingsRefreshApi = useMemo<SettingsRefreshApi>(
    () => ({
      refreshLLMs: llm.refreshLLMs,
      refreshAgents,
      refreshSkills: skills.refreshSkills,
      refreshCompact: compact.refreshCompact,
      refreshMCP: mcp.refreshMCP,
      refreshRoutines: routines.refreshRoutines,
      refreshSandbox: sandbox.refreshSandbox,
      refreshMachines: machinesHook.refreshMachines,
      refreshSecrets: secrets.refreshSecrets,
      refreshIntegrations: integrations.refresh,
      refreshToolAllowlist: review.refreshToolAllowlist,
    }),
    [
      llm.refreshLLMs,
      refreshAgents,
      skills.refreshSkills,
      compact.refreshCompact,
      mcp.refreshMCP,
      routines.refreshRoutines,
      sandbox.refreshSandbox,
      machinesHook.refreshMachines,
      secrets.refreshSecrets,
      integrations.refresh,
      review.refreshToolAllowlist,
    ],
  );

  const settingsRefreshErrors = useMemo(
    () => ({
      onLLMError: llm.setLLMMsg,
      onSkillsError: skills.setSkillsMsg,
      onMcpError: mcp.setMcpMsg,
      onRoutinesError: routines.setRoutinesMsg,
      onSandboxError: sandbox.setSandboxMsg,
      onMachinesError: machinesHook.setMachinesMsg,
    }),
    [
      llm.setLLMMsg,
      skills.setSkillsMsg,
      mcp.setMcpMsg,
      routines.setRoutinesMsg,
      sandbox.setSandboxMsg,
      machinesHook.setMachinesMsg,
    ],
  );

  const prefetchSettingsTab = useCallback(
    (tab: SettingsTab) => {
      void refreshSettingsForTab(tab, settingsRefreshApi, settingsRefreshErrors);
    },
    [settingsRefreshApi, settingsRefreshErrors],
  );

  const selectSettingsTab = useCallback(
    (tab: SettingsTab) => {
      setSettingsTab(tab);
      prefetchSettingsTab(tab);
    },
    [prefetchSettingsTab],
  );

  const openSettings = useCallback(
    (tab: SettingsTab = "llm") => {
      const sheetForm = readSheetForm();
      setShowSettings(true);
      patchShell({
        settingsShellHub: Boolean(sheetForm && tab === "general"),
        ...(tab === "general" ? { settingsGeneralPane: "account" as const } : {}),
      });
      setSettingsTab(tab);
      llm.setLLMMsg("");
      skills.setSkillsMsg("");
      mcp.setMcpMsg("");
      mcp.setMcpTestResult("");
      routines.setRoutinesMsg("");
      sandbox.setSandboxMsg("");
      prefetchSettingsTab(tab);
    },
    [
      prefetchSettingsTab,
      llm.setLLMMsg,
      skills.setSkillsMsg,
      mcp.setMcpMsg,
      mcp.setMcpTestResult,
      routines.setRoutinesMsg,
      sandbox.setSandboxMsg,
    ],
  );

  const closeSettings = useCallback(() => setShowSettings(false), []);

  // OAuth return: /?open_settings=integrations&gmail_connected=1
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("open_settings");
    if (!tab) return;
    const allowed: SettingsTab[] = [
      "general",
      "bot",
      "llm",
      "skills",
      "mcp",
      "compact",
      "routines",
      "sandbox",
      "machines",
      "secrets",
      "integrations",
      "review",
    ];
    if (!allowed.includes(tab as SettingsTab)) return;
    openSettings(tab as SettingsTab);
    if (tab === "integrations") {
      if (params.get("gmail_connected") === "1") {
        integrations.setMsg("Gmail 已连接");
      }
      const err = params.get("gmail_error");
      if (err) {
        const hints: Record<string, string> = {
          token_exchange_network:
            "无法访问 Google 换票接口（多为未走代理）。请在仓库根 .env 设置 HTTPS_PROXY=http://127.0.0.1:端口（Clash/Surge 等），重启 API 后再连",
          redirect_uri_mismatch:
            "redirect_uri 与 Google Cloud 凭据不一致，请核对 GOOGLE_OAUTH_REDIRECT_URI",
          invalid_client: "Client ID/Secret 无效，请核对 GOOGLE_OAUTH_CLIENT_*",
          invalid_grant: "授权码无效或已使用，请再点一次「连接 Gmail」",
          token_exchange_failed: "换取 token 失败，请查看 API 日志中的 gmail oauth 行",
          missing_gmail_send_scope:
            "未获得 gmail.send 发送权限。请确认 Google Cloud 同意屏幕已添加该范围，重新连接时在授权页勾选发送邮件",
        };
        integrations.setMsg("Gmail 连接失败：" + (hints[err] ?? err));
      }
      void integrations.refresh();
    }
    params.delete("open_settings");
    params.delete("gmail_connected");
    params.delete("gmail_error");
    const q = params.toString();
    const next = window.location.pathname + (q ? `?${q}` : "") + window.location.hash;
    window.history.replaceState({}, "", next);
  }, [openSettings, integrations]);


  const onCopyEmail = useCallback((email: string) => {
    void navigator.clipboard.writeText(email || "").then(() => {
      setEmailCopied(true);
      window.setTimeout(() => setEmailCopied(false), 1200);
    });
  }, []);

  const machinesSyncRef = useRef({
    machines: [] as Machine[],
    setMachines: ((_action) => {}) as Dispatch<SetStateAction<Machine[]>>,
    deviceDisplayName: "",
    setCurrentMachineDraft: (_name: string) => {},
  });

  useLayoutEffect(() => {
    machinesSyncRef.current = {
      machines: machinesHook.machines,
      setMachines: machinesHook.setMachines,
      deviceDisplayName: machinesHook.deviceDisplayName,
      setCurrentMachineDraft: machinesHook.setCurrentMachineDraft,
    };
  });

  const shell = useMemo<SettingsShell>(
    () => ({
      show: showSettings,
      setShow: setShowSettings,
      tab: settingsTab,
      setTab: setSettingsTab,
      selectTab: selectSettingsTab,
      prefetch: prefetchSettingsTab,
      open: openSettings,
      close: closeSettings,
      emailCopied,
      onCopyEmail,
      secretPrompt: secrets.secretPrompt,
      setSecretPrompt: secrets.setSecretPrompt,
    }),
    [
      showSettings,
      settingsTab,
      selectSettingsTab,
      prefetchSettingsTab,
      openSettings,
      closeSettings,
      emailCopied,
      onCopyEmail,
      secrets.secretPrompt,
      secrets.setSecretPrompt,
    ],
  );

  const chatSlice = useMemo<ChatSettingsSlice>(
    () => ({
      toolAllowEntries: review.toolAllowEntries,
      setToolAllowEntries: review.setToolAllowEntries,
      machines: machinesHook.machines,
      deviceDisplayName: machinesHook.deviceDisplayName,
      refreshLLMs: llm.refreshLLMs,
    }),
    [
      review.toolAllowEntries,
      review.setToolAllowEntries,
      machinesHook.machines,
      machinesHook.deviceDisplayName,
      llm.refreshLLMs,
    ],
  );

  return {
    /** Dialog open/close/tab/prefetch + secret prompt shell state. */
    shell,
    /** Narrow host/review/llm pieces for chat — not the full settings bag. */
    chatSlice,
    defaultLLM,
    clearLlmsOnLogout: llm.clearLlms,
    machinesSyncRef,
    /** Tab-owned deep hooks (panel consumes these; chat should use chatSlice). */
    llm,
    skills,
    compact,
    mcp,
    routines,
    sandbox,
    machines: machinesHook,
    secrets,
    integrations,
    review,
    clientEnv,
    hostMachineId,
  };
}

export type AppSettingsBundle = ReturnType<typeof useAppSettings>;
