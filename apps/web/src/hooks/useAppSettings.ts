import {
  useCallback,
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
import type { Agent, BotSecretRequest, Machine } from "../api";
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
  useSkillsSettings,
} from "./settings";
import type { SettingsTab } from "../types/app-ui";

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
  const [secretPrompt, setSecretPrompt] = useState<BotSecretRequest | null>(null);

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
  const secrets = useSecretsSettings({ secretPrompt, setSecretPrompt });
  const review = useReviewSettings(userId);

  const defaultLLM = useMemo(
    () => llm.llms.find((c) => c.is_default) ?? llm.llms[0],
    [llm.llms],
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

  machinesSyncRef.current = {
    machines: machinesHook.machines,
    setMachines: machinesHook.setMachines,
    deviceDisplayName: machinesHook.deviceDisplayName,
    setCurrentMachineDraft: machinesHook.setCurrentMachineDraft,
  };

  return {
    showSettings,
    setShowSettings,
    settingsTab,
    setSettingsTab,
    emailCopied,
    secretPrompt,
    setSecretPrompt,
    defaultLLM,
    prefetchSettingsTab,
    selectSettingsTab,
    openSettings,
    closeSettings,
    onCopyEmail,
    clearLlmsOnLogout: llm.clearLlms,
    machinesSyncRef,
    llm,
    skills,
    compact,
    mcp,
    routines,
    sandbox,
    machines: machinesHook,
    secrets,
    review,
    clientEnv,
    hostMachineId,
  };
}

export type AppSettingsBundle = ReturnType<typeof useAppSettings>;
