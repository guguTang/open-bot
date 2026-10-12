import {
  FormEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useConfirm, useDismissConfirm } from "./components/ConfirmProvider";
import {
  Agent,
  Channel,
  CompactConfig,
  Conversation,
  LLMConnection,
  LLMInput,
  Message,
  normalizeMessageSources,
  Skill,
  User,
  clearSession,
  createAgent,
  createChannel,
  openPrimaryConversation,
  createLLMConnection,
  createMCPServer,
  deleteAgent,
  deleteChannel,
  deleteLLMConnection,
  deleteMCPServer,
  fetchCompactConfig,
  getStoredUser,
  getToken,
  listAgents,
  listAgentSkills,
  listChannels,
  listLLMConnections,
  listMCPServers,
  listMessages,
  listMessagesWithStatus,
  getConversationRunStatus,
  listSkills,
  uploadSkill,
  uploadSkillPackage,
  deleteSkill,
  applyAgentOnboarding,
  formatLLMPromptCacheProbe,
  formatLLMToolsProbe,
  listLLMModels,
  probeLLMPromptCache,
  probeLLMTools,
  login,
  mcpCallTool,
  register,
  fetchOIDCConfig,
  startOIDCLogin,
  sendMessageStream,
  persistConversationMessage,
  toggleReaction,
  createMessageFeedback,
  type ReactionUpdatedEvent,
  type BotPresenceEvent,
  type BotOnlineEvent,
  type BotPresenceStatus,
  updateAgent,
  subscribeConversationEvents,
  cancelConversationRun,
  approveConversationRun,
  approveConversation,
  listToolAllowlist,
  revokeToolAllowlistEntry,
  type ApprovalDecision,
  chatEventsWebSocketUrl,
  mergeIncomingMessage,
  isStopMarkerContent,
  createHostConfirm,
  decideHostConfirm,
  uploadConversationAttachment,
  AttachmentMeta,
  setDefaultLLMConnection,
  setSession,
  setSkillEnabled,
  testMCPServer,
  updateLLMConnection,
  updateMCPServer,
  MCPServer,
  MCPServerInput,
  Routine,
  RoutineInput,
  listRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  runRoutine,
  listInboundHooks,
  createInboundHook,
  deleteInboundHook,
  type InboundHook,
  Sandbox,
  getSandbox,
  ensureSandbox,
  openChannelConversation,
  sandboxDesktopURL,
  stopSandbox,
  resetSandbox,
  execSandbox,
  listSandbox,
  readSandboxFile,
  writeSandboxFile,
  listBotSecrets,
  createBotSecret,
  deleteBotSecret,
  listBotSecretRequests,
  checkpointSandbox,
  listMachines,
  registerMachine,
  heartbeatMachine,
  updateMachine,
  fetchUserSettings,
  deleteMachine,
  type Machine,
  type BotSecretMeta,
  type BotSecretRequest,
  getApiBase,
} from "./api";
import {
  detectClientContext,
  shouldRegisterAsHost,
  resolveMachineKey,
  resolveClientDeviceType,
  isLoginOnlyMachine,
  machineIsOnline,
  getStoredMachineId,
  setStoredMachineId,
  clearStoredMachineId,
  defaultMachineLabel,
  resolveDefaultMachineLabel,
} from "./lib/clientEnv";
import { installSafeAreaInsets } from "./lib/safeAreaInsets";
import {
  EXIT_TOAST_COPY,
  LIST_ROOT_EXIT_WINDOW_MS,
  handleSystemBack,
  installCapacitorBackButton,
  notifySystemBackOverlays,
  type SystemBackResult,
} from "./lib/mobileSystemBack";
import {
  effectiveTimezone,
  normalizeMachineExecPolicy,
  MACHINE_EXEC_POLICY_OPTIONS,
  readCachedUserSettings,
  type MachineExecPolicy,
} from "./lib/userSettings";
import { startHostExecSession, hostWritesEnabled, setHostWritesEnabled, classifyHostExecReview, setHostExecUserSettings, setHostExecMachinePolicy, type HostExecRequest } from "./lib/hostExec";
import { parseHostConfirm } from "./components/HostConfirmCard";
import {
  ALWAYS_ALLOW_TOAST,
  REVIEW_EMPTY_COPY,
  grantToolFamilyAlwaysAllow,
  isToolFamilyAlwaysAllowed,
  listToolAllowEntries,
  revokeToolFamilyAlwaysAllow,
  toolFamilyForHostOp,
  toolFamilyLabel,
  toolLabelForHostOp,
  type ToolAllowEntry,
  type ToolFamilyId,
} from "./lib/toolAllowlist";
import {
  SettingsPage,
  SettingsHint,
  SettingsSection,
  SettingsCard,
  SettingsEmpty,
} from "./components/SettingsLayout";
import { FeedbackModal, type FeedbackTarget } from "./components/FeedbackModal";
import { TrainPanel } from "./components/TrainPanel";
import { NewChatPopover, type CreateBotInput, type NewChatMode } from "./components/NewChatPopover";
import { normalizePresenceStatus } from "./components/avatarColor";
import { BotAvatarSettings } from "./components/BotAvatarSettings";
import { ConvActionSheet } from "./components/ConvActionSheet";
import { CreateActionSheet } from "./components/CreateActionSheet";
import { MobileSettingsHub, type SettingsHubNav } from "./components/MobileSettingsHub";
import { ApiServerField } from "./components/ApiServerField";
import { LAYOUT_NARROW_MQ, useIsTouchUi, useSheetFormUi } from "./components/useIsTouchUi";
import { BotSettingsPanel } from "./components/BotSettingsPanel";
import { GeneralBotSettings } from "./components/GeneralBotSettings";
import { SecretPromptModal } from "./components/SecretPromptModal";
import { CloneAgentModal } from "./components/CloneAgentModal";
import { GroupMembersSettings } from "./components/GroupMembersSettings";
import { PendingFile, type ComposerMentionItem, type ComposerSkillOption } from "./components/Composer";
import {
  isOnboardingDismissed,
  onboardingStorageKey,
  setOnboardingDismissed,
  type OnboardingOption,
} from "./components/BotOnboardingCard";
import { AuthPage } from "./components/app/AuthPage";
import { AppSidebar } from "./components/app/AppSidebar";
import { ChatMain } from "./components/app/ChatMain";
import { accountInitials } from "./components/app/accountInitials";
import { SettingsGlyph } from "./components/app/SettingsGlyph";
import { emptyLLMForm } from "./lib/app/constants";
import { buildHandoffContext } from "./lib/app/handoff";
import { isGroupPassContent } from "./lib/app/groupPass";
import { firstMentionedAgent, matchAgentByMentionToken, stripLeadingAtAgent } from "./lib/app/mentions";
import {
  readLastActiveSelection,
  readListFoldState,
  writeLastActiveSelection,
  writeListFoldState,
} from "./lib/app/storage";
import { refreshSettingsForTab, type SettingsRefreshApi } from "./lib/app/settingsRefresh";
import type { ConvRunState, LastActiveSelection, SettingsTab, UiMessage } from "./types/app-ui";
import { SETTINGS_TITLE } from "./types/app-ui";
import {
  chatScrollRef,
  chatState,
  pinChatScroll,
  replyTargetRef,
  resetChatSession,
  setApprovalGate,
  setChatSwitchPending,
  setInput,
  setMessages,
  setPendingFiles,
  setReplyTarget,
  setRunActiveTool,
  setRunFaceAgentId,
  setRunLabel,
  setSending,
  setTaskBusy,
  viewedMessages,
  writeOpenThreadRootId,
} from "./stores/chat";
import { usePresenceStore } from "./stores/presence";

export default function App() {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  /** Sync mirror of the thread panel so async send / stamp see the latest panel state. */
  const openThreadRootIdRef = useRef<string | null>(null);
  const setOpenThreadRootId = useCallback((id: string | null) => {
    const next = (id || "").trim() || null;
    openThreadRootIdRef.current = next;
    writeOpenThreadRootId(next);
  }, []);
  const localUserIdRef = useRef<string | null>(null);
  const [taskConvIds, setTaskConvIds] = useState<Set<string>>(() => new Set());
  const taskConvIdsRef = useRef(taskConvIds);
  taskConvIdsRef.current = taskConvIds;
  const [, setStatus] = useState(""); // chat chrome status bar removed; keep setter for clear/error paths
  const lastRequestIdRef = useRef<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [newChatInitialMode, setNewChatInitialMode] = useState<NewChatMode>("list");
  /** Narrow panes: list = sidebar only, chat = main only. Wide layout ignores this (CSS). */
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  /** Mobile settings hub (C-2); true = Grok-style grouped home. */
  const [settingsShellHub, setSettingsShellHub] = useState(true);
  /** Mobile: `general` tab splits into account-only vs review/timezone-only. */
  const [settingsGeneralPane, setSettingsGeneralPane] = useState<"account" | "server" | "review">("account");
  /** #6 shell list fold — default both expanded; persisted per user. */
  const [assistantsCollapsed, setAssistantsCollapsed] = useState(false);
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [isNarrowLayout, setIsNarrowLayout] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(LAYOUT_NARROW_MQ).matches
      : false,
  );
  const [onboardingDismissed, setOnboardingDismissedState] = useState(false);
  const newChatBtnRef = useRef<HTMLButtonElement>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [emailCopied, setEmailCopied] = useState(false);

  const [llms, setLlms] = useState<LLMConnection[]>([]);
  const [llmForm, setLLMForm] = useState<LLMInput>(emptyLLMForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [llmBusy, setLLMBusy] = useState(false);
  const [llmMsg, setLLMMsg] = useState("");
  const [llmModelOptions, setLLMModelOptions] = useState<string[]>([]);
  const [llmModelsLoading, setLLMModelsLoading] = useState(false);
  const [llmModelsError, setLLMModelsError] = useState("");
  const llmModelsReqSeq = useRef(0);
  const [llmCacheProbing, setLLMCacheProbing] = useState(false);
  const [llmCacheProbeMsg, setLLMCacheProbeMsg] = useState("");
  const llmCacheReqSeq = useRef(0);

  const [agentBusy, setAgentBusy] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<Agent | null>(null);
  const [groupMembersChannel, setGroupMembersChannel] = useState<Channel | null>(null);
  const [channelBusy, setChannelBusy] = useState(false);

  const [avatarSettingsAgent, setAvatarSettingsAgent] = useState<Agent | null>(null);
  // bot_presence / bot_online live in the presence store so list dots don't re-render App.
  const applyBotOnline = useCallback((id: string, on: boolean) => {
    usePresenceStore.getState().setOnline(id, on);
    setAgents((prev) =>
      prev.some((a) => a.id === id && a.online !== on)
        ? prev.map((a) => (a.id === id ? { ...a, online: on } : a))
        : prev,
    );
  }, []);
  const seedOnlineFromAgents = useCallback((list: Agent[]) => {
    usePresenceStore.getState().seedOnline(list);
  }, []);
  // Message feedback → pending lessons; TrainPanel confirms (only active lessons reach the runtime).
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);
  const [trainAgent, setTrainAgent] = useState<Agent | null>(null);
  const [trainReload, setTrainReload] = useState(0);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsMsg, setSkillsMsg] = useState("");
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [skillZip, setSkillZip] = useState<File | null>(null);
  const [skillFolder, setSkillFolder] = useState<File[]>([]);
  const skillFolderInputRef = useRef<HTMLInputElement>(null);
  const skillZipInputRef = useRef<HTMLInputElement>(null);

  const [compactCfg, setCompactCfg] = useState<CompactConfig | null>(null);
  const confirm = useConfirm();
  const dismissConfirm = useDismissConfirm();
  const touchUi = useIsTouchUi();
  const sheetForm = useSheetFormUi();

  /* Android Capacitor: env(safe-area-*) often 0 under overlay StatusBar — set --sat/--sab floors */
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void installSafeAreaInsets().then((c) => {
      if (cancelled) {
        c();
        return;
      }
      cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  /* §8 mobile shell: visualViewport → keep composer at visible bottom */
  useEffect(() => {
    if (!sheetForm) {
      document.documentElement.style.removeProperty("--vv-height");
      document.documentElement.style.removeProperty("--vv-offset-top");
      document.documentElement.style.removeProperty("--keyboard-inset");
      return;
    }
    const root = document.documentElement;
    const sync = () => {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty("--vv-height", `${window.innerHeight}px`);
        root.style.setProperty("--vv-offset-top", "0px");
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-offset-top", `${Math.round(vv.offsetTop)}px`);
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-offset-top");
      root.style.removeProperty("--keyboard-inset");
    };
  }, [sheetForm]);

  useEffect(() => {
    if (!user?.id) {
      setAssistantsCollapsed(false);
      setGroupsCollapsed(false);
      return;
    }
    const saved = readListFoldState(user.id);
    setAssistantsCollapsed(saved.assistantsCollapsed);
    setGroupsCollapsed(saved.groupsCollapsed);
  }, [user?.id]);

  const toggleAssistantsCollapsed = useCallback(() => {
    setAssistantsCollapsed((prev) => {
      const next = !prev;
      if (user?.id) {
        writeListFoldState(user.id, { assistantsCollapsed: next, groupsCollapsed });
      }
      return next;
    });
  }, [user?.id, groupsCollapsed]);

  const toggleGroupsCollapsed = useCallback(() => {
    setGroupsCollapsed((prev) => {
      const next = !prev;
      if (user?.id) {
        writeListFoldState(user.id, { assistantsCollapsed, groupsCollapsed: next });
      }
      return next;
    });
  }, [user?.id, assistantsCollapsed]);


  const [convSheet, setConvSheet] = useState<
    | { kind: "agent"; agent: Agent }
    | { kind: "channel"; channel: Channel }
    | null
  >(null);
  const convLongPressTimer = useRef<number | null>(null);
  const convLongPressFired = useRef(false);
  const convLongPressStart = useRef<{ x: number; y: number } | null>(null);
  const clearConvLongPress = () => {
    if (convLongPressTimer.current != null) {
      window.clearTimeout(convLongPressTimer.current);
      convLongPressTimer.current = null;
    }
  };
  const [channels, setChannels] = useState<Channel[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpMsg, setMcpMsg] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpForm, setMcpForm] = useState<MCPServerInput>({
    name: "echo",
    transport: "stdio",
    command: "",
    args: [],
    url: "",
    enabled: true,
  });
  const [mcpArgsText, setMcpArgsText] = useState("[]");
  const [mcpTestResult, setMcpTestResult] = useState("");
  const [mcpCallServerId, setMcpCallServerId] = useState("");
  const [mcpCallToolName, setMcpCallToolName] = useState("echo");
  const [mcpCallArgs, setMcpCallArgs] = useState('{"message":"hello"}');
  const [mcpCallResult, setMcpCallResult] = useState("");

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesMsg, setRoutinesMsg] = useState("");
  const [routinesBusy, setRoutinesBusy] = useState(false);
  const [inboundHooks, setInboundHooks] = useState<InboundHook[]>([]);
  const [hooksMsg, setHooksMsg] = useState("");
  const [routineForm, setRoutineForm] = useState<RoutineInput>({
    name: "",
    prompt: "",
    schedule_cron: "0 9 * * *",
    enabled: true,
    agent_id: "",
    timezone: "Asia/Shanghai",
    triggers_json: "[]",
    max_retries: 2,
    quiet_unchanged: false,
  });
  const [composerSkills, setComposerSkills] = useState<ComposerSkillOption[]>([]);

  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [sandboxMsg, setSandboxMsg] = useState("");
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxCmd, setSandboxCmd] = useState("echo hi");
  const [sandboxExecOut, setSandboxExecOut] = useState("");
  const [sandboxPath, setSandboxPath] = useState(".");
  const [sandboxLsOut, setSandboxLsOut] = useState("");
  const [sandboxFilePath, setSandboxFilePath] = useState("hello.txt");
  const [sandboxFileContent, setSandboxFileContent] = useState("hello from open-bot");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesMsg, setMachinesMsg] = useState("");
  const [machinesBusy, setMachinesBusy] = useState(false);
  const [deviceDisplayName, setDeviceDisplayName] = useState("");
  const [renamingMachineId, setRenamingMachineId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [currentMachineDraft, setCurrentMachineDraft] = useState("");
  const [hostMachineId, setHostMachineId] = useState<string | null>(() => getStoredMachineId());
  const [hostWritesOn, setHostWritesOn] = useState(() => hostWritesEnabled());
  const [hostExecPolicy, setHostExecPolicy] = useState<MachineExecPolicy>("allow");
  const [hostActivity, setHostActivity] = useState("");
  const hostConfirmResolvers = useRef(new Map<string, (ok: boolean) => void>());
  const askHostConfirmRef = useRef<(req: HostExecRequest) => Promise<boolean>>(async () => false);
  /** Optimistic Always-allow cache + server list for 设置 · 审核. */
  const [toolAllowEntries, setToolAllowEntries] = useState<ToolAllowEntry[]>([]);
  const [toolAllowServerOk, setToolAllowServerOk] = useState(false);
  const [toolAllowBusy, setToolAllowBusy] = useState(false);
  const applyRemoteHostDecisionRef = useRef<(msg: Message) => void>(() => {});
  const clientEnv = useMemo(() => detectClientContext(), []);

  useEffect(() => {
    let cancelled = false;
    void resolveDefaultMachineLabel(clientEnv).then((name) => {
      if (!cancelled) setDeviceDisplayName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [clientEnv]);
  const [botSecrets, setBotSecrets] = useState<BotSecretMeta[]>([]);
  const [secretRequests, setSecretRequests] = useState<BotSecretRequest[]>([]);
  const [secretPrompt, setSecretPrompt] = useState<BotSecretRequest | null>(null);

  /* Mobile system back / gesture — same stack as UI ← (bot-mobile-back-gesture-v1) */
  const lastListRootBackAtRef = useRef<number | null>(null);
  const systemBackStateRef = useRef({
    dismissConfirm,
    secretPromptOpen: false,
    dismissSecretPrompt: () => {},
    feedbackOpen: false,
    dismissFeedback: () => {},
    trainOpen: false,
    dismissTrain: () => {},
    avatarSettingsOpen: false,
    dismissAvatarSettings: () => {},
    createSheetOpen: false,
    dismissCreateSheet: () => {},
    newChatOpen: false,
    dismissNewChat: () => {},
    convSheetOpen: false,
    dismissConvSheet: () => {},
    showSettings: false,
    settingsShellHub: true,
    setSettingsShellHub,
    closeSettings: () => {},
    mobileView: "list" as "list" | "chat",
    setMobileView,
    isNarrowLayout: false,
  });
  systemBackStateRef.current = {
    dismissConfirm,
    secretPromptOpen: Boolean(secretPrompt),
    dismissSecretPrompt: () => setSecretPrompt(null),
    feedbackOpen: Boolean(feedbackTarget),
    dismissFeedback: () => setFeedbackTarget(null),
    trainOpen: Boolean(trainAgent),
    dismissTrain: () => setTrainAgent(null),
    avatarSettingsOpen: Boolean(avatarSettingsAgent),
    dismissAvatarSettings: () => setAvatarSettingsAgent(null),
    createSheetOpen,
    dismissCreateSheet: () => setCreateSheetOpen(false),
    newChatOpen: showNewChat,
    dismissNewChat: () => {
      setShowNewChat(false);
      setNewChatInitialMode("list");
    },
    convSheetOpen: Boolean(convSheet),
    dismissConvSheet: () => setConvSheet(null),
    showSettings,
    settingsShellHub,
    setSettingsShellHub,
    closeSettings: () => setShowSettings(false),
    mobileView,
    setMobileView,
    isNarrowLayout,
  };

  const runSystemBack = useCallback((): SystemBackResult => {
    const result = handleSystemBack(systemBackStateRef.current, {
      lastListRootBackAt: lastListRootBackAtRef.current,
      onExitPrompt: () => {
        lastListRootBackAtRef.current = Date.now();
        toast.message(EXIT_TOAST_COPY, { duration: LIST_ROOT_EXIT_WINDOW_MS });
      },
      notifyChildOverlays: notifySystemBackOverlays,
    });
    if (result.action === "exit-ready") {
      lastListRootBackAtRef.current = null;
    }
    return result;
  }, []);

  useEffect(() => {
    if (mobileView === "chat" || showSettings) {
      lastListRootBackAtRef.current = null;
    }
  }, [mobileView, showSettings]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void installCapacitorBackButton({
      onBack: () => runSystemBack(),
    }).then((c) => {
      if (cancelled) {
        c();
        return;
      }
      cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [runSystemBack]);

  const [secretFormName, setSecretFormName] = useState("api_token");
  const [secretFormValue, setSecretFormValue] = useState("");
  const [secretFormOrigin, setSecretFormOrigin] = useState("https://api.github.com");
  const [secretMsg, setSecretMsg] = useState("");

  /** Per-conversation in-flight SSE runs — switching bots must not abort these. */
  const runsRef = useRef<Map<string, ConvRunState>>(new Map());
  const messagesByConvRef = useRef<Map<string, UiMessage[]>>(new Map());
  const conversationRef = useRef<Conversation | null>(null);
  const didRestoreLastActive = useRef<string | null>(null);
  /** False until last-active restore finishes so we never flash agents[0] / onboarding. */
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  /** Ignores stale openPrimaryConversation / openChannel results after rapid switches. */
  const selectGenRef = useRef(0);
  /** Tick so sidebar busy indicators re-render when runs start/end. */
  const [runBusyTick, setRunBusyTick] = useState(0);

  const authed = Boolean(token && user);

  // Load per-user Bot settings (timezone / Auto-review) into the host-exec gate.
  useEffect(() => {
    if (!authed) return;
    const cached = readCachedUserSettings();
    setHostExecUserSettings(cached);
    void fetchUserSettings()
      .then((s) => setHostExecUserSettings(s))
      .catch(() => {});
  }, [authed]);

  // Keep machine exec_policy in sync for the local host-exec WebSocket gate.
  useEffect(() => {
    const mid = hostMachineId;
    if (!mid) {
      setHostExecMachinePolicy("allow");
      setHostExecPolicy("allow");
      return;
    }
    const m = machines.find((x) => x.id === mid);
    const policy = normalizeMachineExecPolicy(m?.exec_policy);
    setHostExecPolicy(policy);
    setHostExecMachinePolicy(policy);
    if (m?.label) setCurrentMachineDraft(m.label);
  }, [hostMachineId, machines]);

  const refreshMachines = useCallback(async () => {
    const list = await listMachines();
    setMachines(list);
  }, []);

  // Desktop/mobile: register this host + heartbeat while authenticated.
  useEffect(() => {
    if (!authed) return;
    if (!shouldRegisterAsHost(clientEnv)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const label =
          deviceDisplayName.trim() || (await resolveDefaultMachineLabel(clientEnv));
        const m = await registerMachine({
          machine_key: await resolveMachineKey(clientEnv),
          label,
          platform: clientEnv.platform,
          os: clientEnv.os,
          arch: clientEnv.arch,
          app: clientEnv.app,
          app_version: clientEnv.app_version,
          device_type: resolveClientDeviceType(clientEnv),
        });
        if (cancelled) return;
        setStoredMachineId(m.id);
        setHostMachineId(m.id);
        setMachines((prev) => {
          const others = prev.filter((x) => x.id !== m.id);
          return [m, ...others];
        });
        timer = setInterval(() => {
          const id = getStoredMachineId();
          if (!id) return;
          void heartbeatMachine(id).catch(() => {
            /* ignore transient */
          });
        }, 30_000);
      } catch (err) {
        if (!cancelled) {
          console.warn("machine register failed", err);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [authed, clientEnv]);

  useEffect(() => {
    if (!authed || !token || clientEnv.app !== "tauri" || !hostMachineId) return;
    const stop = startHostExecSession({
      token,
      machineId: hostMachineId,
      confirm: (req) => askHostConfirmRef.current(req),
    });
    return () => {
      stop();
      for (const resolve of hostConfirmResolvers.current.values()) resolve(false);
      hostConfirmResolvers.current.clear();
    };
  }, [authed, token, clientEnv.app, hostMachineId]);


  const refreshLLMs = useCallback(async () => {
    const list = await listLLMConnections();
    setLlms(list);
  }, []);

  const refreshAgents = useCallback(async (): Promise<Agent[]> => {
    const list = await listAgents();
    setAgents(list);
    seedOnlineFromAgents(list);
    setAgentId((prev) => {
      if (prev && list.some((a) => a.id === prev)) return prev;
      const uid = getStoredUser()?.id;
      const saved = uid ? readLastActiveSelection(uid) : null;
      // Prefer last-active agent so we never briefly paint agents[0] on refresh.
      if (saved?.kind === "agent" && list.some((a) => a.id === saved.id)) {
        return saved.id;
      }
      // Before initial restore completes (esp. channel last-active), keep empty
      // rather than snapping to the first bot.
      if (uid && didRestoreLastActive.current !== uid) {
        return prev;
      }
      return list[0]?.id ?? "";
    });
    return list;
  }, [seedOnlineFromAgents]);

  const saveAvatarSettings = useCallback(
    async (
      id: string,
      patch: { avatar_shape: string; avatar_color: string; machine_id?: string },
    ) => {
      const updated = await updateAgent(id, patch);
      const nextMachineId =
        typeof updated.machine_id === "string" ? updated.machine_id : patch.machine_id;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id
            ? {
                ...a,
                avatar_shape: updated.avatar_shape || patch.avatar_shape,
                avatar_color: updated.avatar_color || patch.avatar_color,
                ...(nextMachineId !== undefined ? { machine_id: nextMachineId } : {}),
                ...(typeof updated.online === "boolean" ? { online: updated.online } : {}),
              }
            : a,
        ),
      );
      // Re-binding changes the bot's channel: take the server's fresh online bit.
      if (typeof updated.online === "boolean") applyBotOnline(id, updated.online);
    },
    [applyBotOnline],
  );

  const openAvatarSettings = useCallback((a: Agent) => {
    setAvatarSettingsAgent(a);
  }, []);

  const refreshSkills = useCallback(async () => {
    const list = await listSkills();
    setSkills(list);
  }, []);

  const refreshChannels = useCallback(async () => {
    const chs = await listChannels();
    setChannels(chs);
    return chs;
  }, []);

  const refreshCompact = useCallback(async () => {
    const cfg = await fetchCompactConfig();
    setCompactCfg(cfg);
  }, []);

  const refreshConversations = useCallback(async () => {
    // Sidebar is bot-first; refresh agent previews (last_message) instead of listing sessions.
    await refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  const applyReactionEvent = useCallback((evt: ReactionUpdatedEvent) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== evt.message_id) return m;
        const list = [...(m.reactions || [])];
        const idx = list.findIndex((r) => r.emoji === evt.emoji);
        if (evt.count <= 0) {
          if (idx >= 0) list.splice(idx, 1);
        } else if (idx >= 0) {
          list[idx] = { emoji: evt.emoji, count: evt.count, me: Boolean(evt.me) };
        } else {
          list.push({ emoji: evt.emoji, count: evt.count, me: Boolean(evt.me) });
        }
        return { ...m, reactions: list };
      }),
    );
  }, []);

  const onToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const prevSnapshot = viewedMessages().find((m) => m.id === messageId)?.reactions;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const list = [...(m.reactions || [])];
          const idx = list.findIndex((r) => r.emoji === emoji);
          if (idx >= 0) {
            const cur = list[idx];
            if (cur.me) {
              const nextCount = cur.count - 1;
              if (nextCount <= 0) list.splice(idx, 1);
              else list[idx] = { ...cur, count: nextCount, me: false };
            } else {
              list[idx] = { ...cur, count: cur.count + 1, me: true };
            }
          } else {
            list.push({ emoji, count: 1, me: true });
          }
          return { ...m, reactions: list };
        }),
      );
      try {
        const evt = await toggleReaction(messageId, emoji);
        applyReactionEvent(evt);
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, reactions: prevSnapshot } : m,
          ),
        );
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [applyReactionEvent],
  );

  const openFeedbackForMessage = useCallback(
    (message: { id: string; agent_id?: string; agent_name?: string }, source: FeedbackTarget["source"]) => {
      const convId = conversationRef.current?.id || "";
      const aid = message.agent_id || agentId;
      if (!convId || !aid) {
        toast.error("无法定位这条回复所属的会话或 Bot");
        return;
      }
      const agent = agents.find((a) => a.id === aid);
      setFeedbackTarget({
        messageId: message.id,
        agentId: aid,
        agentName: agent?.name || message.agent_name || "Bot",
        conversationId: convId,
        polarity: "negative",
        source,
      });
    },
    [agentId, agents],
  );

  const submitFeedback = useCallback(
    async (input: {
      polarity: FeedbackTarget["polarity"];
      reasons: string[];
      note: string;
      source: FeedbackTarget["source"];
    }) => {
      if (!feedbackTarget) return;
      await createMessageFeedback({
        message_id: feedbackTarget.messageId,
        agent_id: feedbackTarget.agentId,
        conversation_id: feedbackTarget.conversationId,
        polarity: input.polarity,
        reasons: input.reasons,
        note: input.note,
        source: input.source,
      });
      setTrainReload((n) => n + 1);
      toast.success("已提交反馈，已生成待确认经验（在「训练」里确认后才生效）");
    },
    [feedbackTarget],
  );

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    const pullOpen = () => {
      const id = conversationRef.current?.id;
      if (!id) return;
      void listMessagesWithStatus(id)
        .then((listed) => {
          if (conversationRef.current?.id !== id) return;
          patchConvMessages(id, (prev) => {
            let next = prev;
            for (const m of listed.messages) {
              if (m.role === "summary") continue;
              applyRemoteHostDecisionRef.current(m);
              next = mergeIncomingMessage(next, m);
            }
            return next;
          });
          noteTask(id, Boolean(listed.task_active));
        })
        .catch(() => {});
    };
    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(chatEventsWebSocketUrl(token));
      socket = ws;
      ws.onopen = () => {
        void refreshAgents().catch(() => {});
        pullOpen();
      };
      ws.onmessage = (ev) => {
        let data: { type?: string; message?: Message; conversation_id?: string; status?: string; label?: string };
        try {
          data = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (data.type === "conversation_message" && data.message) {
          acceptServerMessage(data.message);
          void refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "task_status" && data.conversation_id) {
          const active = data.status === "running" || data.status === "queued";
          noteTask(data.conversation_id, active, data.label);
          void refreshAgents().catch(() => {});
          return;
        }
        if (data.type === "host_activity") {
          const row = data as { active?: boolean; label?: string };
          setHostActivity(row.active && row.label ? row.label : "");
        }
        if (data.type === "bot_online") {
          const evt = data as unknown as BotOnlineEvent;
          if (evt.agent_id) {
            applyBotOnline(evt.agent_id, evt.online === true);
          }
          return;
        }
        if (data.type === "bot_presence") {
          const evt = data as unknown as BotPresenceEvent;
          if (evt.agent_id) {
            // Five-state whitelist; empty → idle, unknown → working (v2.1 product rule).
            const st: BotPresenceStatus = normalizePresenceStatus(evt.status);
            usePresenceStore.getState().setPresence(evt.agent_id, st);
            if (st === "awaiting_approval") {
              const rid = lastRequestIdRef.current;
              const cid = conversationRef.current?.id;
              if (rid && cid) {
                setApprovalGate({ conversationId: cid, requestId: rid });
              }
            } else if (st === "idle" || st === "thinking" || st === "working") {
              setApprovalGate((prev) =>
                prev && conversationRef.current?.id === prev.conversationId ? null : prev,
              );
            }
          }
          return;
        }
        if (data.type === "reaction_updated") {
          const evt = data as ReactionUpdatedEvent;
          if (evt.message_id && evt.emoji) {
            applyReactionEvent(evt);
          }
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        retry = window.setTimeout(connect, 2000);
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAgents().catch(() => {});
        pullOpen();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
    };
  }, [token, refreshAgents]);

  useEffect(() => {
    const id = conversation?.id;
    if (!token || !id || !taskConvIds.has(id)) return;
    const timer = window.setInterval(() => {
      void listMessagesWithStatus(id)
        .then((listed) => {
          if (conversationRef.current?.id !== id) return;
          patchConvMessages(id, (prev) => {
            let next = prev;
            for (const m of listed.messages) {
              if (m.role === "summary") continue;
              applyRemoteHostDecisionRef.current(m);
              next = mergeIncomingMessage(next, m);
            }
            return next;
          });
          noteTask(id, Boolean(listed.task_active));
        })
        .catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [token, conversation?.id, taskConvIds]);

  const busySelectionKeys = useMemo(() => {
    void runBusyTick;
    const keys = new Set<string>();
    for (const run of runsRef.current.values()) {
      keys.add(run.selectionKey);
    }
    for (const a of agents) {
      if (a.task_active || (a.conversation_id && taskConvIds.has(a.conversation_id))) {
        keys.add(`agent:${a.id}`);
      }
    }
    for (const ch of channels) {
      if (ch.task_active || (ch.conversation_id && taskConvIds.has(ch.conversation_id))) {
        keys.add(`channel:${ch.id}`);
      }
    }
    return keys;
  }, [runBusyTick, agents, channels, taskConvIds]);

  /** True while runsRef still owns this conversation — survives localOnly interrupt
   *  where setSending(false) used to desync from the kept map entry (lost RunStatus). */
  const viewingRunActive = useMemo(() => {
    void runBusyTick;
    const id = conversation?.id;
    return Boolean(id && runsRef.current.has(id));
  }, [runBusyTick, conversation?.id]);

  const activeAgent = useMemo(
    () => (agentId ? agents.find((a) => a.id === agentId) : undefined),
    [agents, agentId],
  );

  const onboardingKey = useMemo(
    () => onboardingStorageKey(conversation?.id, agentId),
    [conversation?.id, agentId],
  );

  useEffect(() => {
    setOnboardingDismissedState(isOnboardingDismissed(onboardingKey));
  }, [onboardingKey]);

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const channelMemberProfiles = useCallback(
    (ch: Channel): {
      agent_id: string;
      name: string;
      avatar_shape?: string;
      avatar_color?: string;
      online?: boolean;
    }[] =>
      (ch.members || []).map((id) => {
        const a = agents.find((x) => x.id === id);
        const p = ch.member_profiles?.find((x) => x.agent_id === id);
        return {
          agent_id: id,
          name: a?.name || p?.name || agentNameById.get(id) || id,
          avatar_shape: a?.avatar_shape || p?.avatar_shape,
          avatar_color: a?.avatar_color || p?.avatar_color,
          online: a?.online ?? p?.online,
        };
      }),
    [agents, agentNameById],
  );

  const activeChannel = useMemo(() => {
    if (!conversation?.channel_id) return null;
    return channels.find((c) => c.id === conversation.channel_id) ?? null;
  }, [channels, conversation?.channel_id]);

  const groupMentionMembers = useMemo(() => {
    if (!activeChannel?.members?.length) return undefined;
    return activeChannel.members
      .map((id): Agent | undefined => {
        const a = agents.find((x) => x.id === id);
        if (!a) return undefined;
        const p = activeChannel.member_profiles?.find((x) => x.agent_id === id);
        return {
          ...a,
          avatar_shape: a.avatar_shape || p?.avatar_shape,
          avatar_color: a.avatar_color || p?.avatar_color,
        };
      })
      .filter((a): a is Agent => Boolean(a));
  }, [activeChannel, agents]);

  const composerMentionItems = useMemo((): ComposerMentionItem[] => {
    const items: ComposerMentionItem[] = [];
    if (activeChannel?.members?.length) {
      items.push({
        kind: "everyone",
        insert: "everyone",
        label: "所有人",
        subtitle: "本回合全体成员回复",
      });
      for (const a of groupMentionMembers || []) {
        items.push({
          kind: "agent",
          insert: a.name,
          label: a.name,
          subtitle: a.description || a.id,
          agentId: a.id,
          avatarShape: a.avatar_shape,
          avatarColor: a.avatar_color,
        });
      }
    } else {
      for (const a of agents) {
        items.push({
          kind: "bot",
          insert: a.name,
          label: a.name,
          subtitle: a.description || a.id,
          agentId: a.id,
          avatarShape: a.avatar_shape,
          avatarColor: a.avatar_color,
        });
      }
    }
    for (const r of routines.filter((x) => x.enabled)) {
      items.push({
        kind: "routine",
        insert: `routine:${r.name}`,
        label: r.name,
        subtitle: `例行 · ${r.schedule_cron}`,
      });
    }
    for (const s of mcpServers.filter((x) => x.enabled)) {
      items.push({
        kind: "mcp",
        insert: `mcp:${s.name}`,
        label: s.name,
        subtitle: `插件 · ${s.transport}`,
      });
    }
    return items;
  }, [activeChannel, groupMentionMembers, agents, routines, mcpServers]);

  useEffect(() => {
    if (!authed || !agentId) {
      setComposerSkills([]);
      return;
    }
    let cancelled = false;
    void listAgentSkills(agentId)
      .then((list) => {
        if (cancelled) return;
        setComposerSkills(
          list.filter((s) => s.enabled).map((s) => ({ name: s.name, description: s.description })),
        );
      })
      .catch(() => {
        if (!cancelled) setComposerSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [authed, agentId, skills]);

  const defaultLLM = useMemo(
    () => llms.find((c) => c.is_default) ?? llms[0],
    [llms],
  );

  useEffect(() => {
    let cancelled = false;
    fetchOIDCConfig()
      .then((c) => {
        if (!cancelled) setOidcEnabled(Boolean(c.enabled));
      })
      .catch(() => {
        if (!cancelled) setOidcEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCasdoorLogin = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const { authorize_url } = await startOIDCLogin();
      window.location.href = authorize_url;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
      setAuthBusy(false);
    }
  };

  const onAuth = async (e: FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const fn = authMode === "login" ? login : register;
      const res = await fn(authUser.trim(), authPass);
      setSession(res.token, res.user);
      setToken(res.token);
      setUser(res.user);
      setAuthPass("");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const saveLastActiveSelection = useCallback(
    (selection: LastActiveSelection) => {
      if (!user?.id) return;
      writeLastActiveSelection(user.id, selection);
    },
    [user?.id],
  );

  const onLogout = () => {
    didRestoreLastActive.current = null;
    setSelectionHydrated(false);
    setMobileView("list");
    for (const [convId, run] of [...runsRef.current.entries()]) {
      run.generation += 1;
      run.abort.abort();
      void cancelConversationRun(convId).catch(() => {});
    }
    runsRef.current.clear();
    messagesByConvRef.current.clear();
    clearSession();
    setToken(null);
    setUser(null);
    conversationRef.current = null;
    openThreadRootIdRef.current = null;
    setConversation(null);
    resetChatSession();
    setTaskConvIds(new Set());
    setLlms([]);
    setStatus("");
    setRunBusyTick((n) => n + 1);
  };

  const ensureConversation = useCallback(async () => {
    if (conversation?.channel_id) return conversation;
    if (conversation && conversation.agent_id === agentId && !conversation.channel_id) {
      return conversation;
    }
    if (!agentId) {
      throw new Error("请先创建助手");
    }
    const conv = await openPrimaryConversation(agentId);
    conversationRef.current = conv;
    setConversation(conv);
    return conv;
  }, [agentId, conversation]);

  const bumpRunBusy = () => setRunBusyTick((n) => n + 1);

  const selectionKeyForConv = (conv: Conversation) =>
    conv.channel_id ? `channel:${conv.channel_id}` : `agent:${conv.agent_id}`;

  /** Update message buffer for a conversation; sync React state only if that conv is viewed. */
  const patchConvMessages = (convId: string, updater: (prev: UiMessage[]) => UiMessage[]) => {
    const prev = messagesByConvRef.current.get(convId) ?? [];
    const next = updater(prev);
    messagesByConvRef.current.set(convId, next);
    if (conversationRef.current?.id === convId) {
      setMessages(next);
    }
  };

  const noteTask = (convId: string, active: boolean, label?: string) => {
    const cur = taskConvIdsRef.current;
    const has = cur.has(convId);
    if (active !== has) {
      const next = new Set(cur);
      if (active) next.add(convId);
      else next.delete(convId);
      taskConvIdsRef.current = next;
      setTaskConvIds(next);
    }
    if (conversationRef.current?.id === convId) {
      setTaskBusy(active);
      if (active && label) setRunLabel(label);
      if (!active) setRunLabel("正在思考…");
    }
  };

  const releaseHostConfirm = (reqId: string, ok: boolean) => {
    const resolve = hostConfirmResolvers.current.get(reqId);
    if (!resolve) return;
    hostConfirmResolvers.current.delete(reqId);
    resolve(ok);
  };

  const applyRemoteHostDecision = (msg: Message) => {
    if (msg.role !== "host_confirm") return;
    const parsed = parseHostConfirm(msg.content);
    if (!parsed || (parsed.status !== "allowed" && parsed.status !== "denied")) return;
    releaseHostConfirm(parsed.req_id, parsed.status === "allowed");
  };
  applyRemoteHostDecisionRef.current = applyRemoteHostDecision;

  const acceptServerMessage = (msg: Message) => {
    applyRemoteHostDecision(msg);
    const convId = msg.conversation_id;
    if (!convId) return;
    patchConvMessages(convId, (prev) => mergeIncomingMessage(prev, msg));
  };

  askHostConfirmRef.current = (req) => {
    const conversationId = req.conversation_id || conversationRef.current?.id || "";
    return new Promise<boolean>((resolve) => {
      // Optimistic Always-allow skip (client cache / server list). exec_policy=ask forces a card.
      const family = toolFamilyForHostOp(req.op, req.path || "");
      const uid = user?.id || "";
      if (
        hostExecPolicy !== "ask" &&
        (isToolFamilyAlwaysAllowed(uid, family) ||
          toolAllowEntries.some((e) => e.family === family))
      ) {
        resolve(true);
        return;
      }
      hostConfirmResolvers.current.set(req.req_id, resolve);
      if (!conversationId) return;
      const raw = req.content || "";
      let preview = raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
      if (req.op === "shell" && req.dest === "terminal" && !preview) {
        preview = "会打开终端窗口，你可以在里面输入密码或继续操作";
      }
      const review = classifyHostExecReview(req.op, req.path || "", req.dest || "");
      void createHostConfirm(conversationId, {
        req_id: req.req_id,
        op: req.op,
        path: req.path || "",
        dest: req.dest || "",
        preview,
        reason: review.reason,
        review_tier: review.tier,
      })
        .then((msg) => acceptServerMessage(msg))
        .catch(() => {
          acceptServerMessage({
            id: `local-${req.req_id}`,
            role: "host_confirm",
            conversation_id: conversationId,
            created_at: new Date().toISOString(),
            content: JSON.stringify({
              req_id: req.req_id,
              op: req.op,
              path: req.path || "",
              dest: req.dest || "",
              preview,
              reason: review.reason,
              review_tier: review.tier,
              status: "pending",
            }),
          });
        });
    });
  };

  const refreshToolAllowlist = async () => {
    const uid = user?.id || "";
    const local = listToolAllowEntries(uid);
    try {
      const remote = await listToolAllowlist();
      if (remote.length > 0 || toolAllowServerOk) {
        setToolAllowServerOk(true);
        const mapped: ToolAllowEntry[] = remote.map((e) => ({
          family: (e.tool_group || "other") as ToolFamilyId,
          tool: e.tool || e.tool_group,
          label: e.label || toolFamilyLabel((e.tool_group || "other") as ToolFamilyId),
          granted_at: e.granted_at || new Date().toISOString(),
        }));
        const remoteFamilies = new Set(mapped.map((m) => m.family));
        const merged = [...mapped, ...local.filter((l) => !remoteFamilies.has(l.family))];
        setToolAllowEntries(merged);
        return merged;
      }
    } catch {
      /* fall through to local */
    }
    setToolAllowEntries(local);
    return local;
  };

  const settleHostConfirm = (message: Message, decision: ApprovalDecision) => {
    const parsed = parseHostConfirm(message.content);
    if (!parsed?.req_id || parsed.status === "allowed" || parsed.status === "denied") return;
    const ok = decision !== "deny";
    const status = ok ? "allowed" : "denied";
    const family = toolFamilyForHostOp(parsed.op, parsed.path);
    const tool = toolLabelForHostOp(parsed.op, parsed.path);
    const scope = { tool, tool_group: family };
    const content = JSON.stringify({ ...parsed, status, decision });
    const convId = message.conversation_id || conversationRef.current?.id || "";
    const runRequestId = (message as Message & { request_id?: string }).request_id || "";

    if (decision === "always_allow") {
      const uid = user?.id || "";
      setToolAllowEntries(grantToolFamilyAlwaysAllow(uid, family, tool));
      toast.message(ALWAYS_ALLOW_TOAST, { duration: 4000 });
    }

    if (convId) {
      patchConvMessages(convId, (prev) => prev.map((m) => (m.id === message.id ? { ...m, content } : m)));
      if (!message.id.startsWith("local-")) {
        void decideHostConfirm(convId, message.id, status, {
          decision,
          scope,
          reason: parsed.reason || "",
        })
          .then((saved) => acceptServerMessage(saved))
          .catch(() => {});
      }
      if (runRequestId) {
        void approveConversation(convId, {
          request_id: runRequestId,
          decision,
          approve: ok,
          reason: parsed.reason || "",
          scope,
        }).catch(() => {});
      }
    }
    releaseHostConfirm(parsed.req_id, ok);
  };

  // Hydrate Always-allow cache (optimistic local + server if available).
  useEffect(() => {
    if (!user?.id) {
      setToolAllowEntries([]);
      return;
    }
    setToolAllowEntries(listToolAllowEntries(user.id));
    void refreshToolAllowlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);


  const attachSourcesToStreaming = (convId: string, raw: unknown, messageId?: string) => {
    const sources = normalizeMessageSources(raw);
    if (!sources.length) return;
    const run = runsRef.current.get(convId);
    const targetId = (messageId || "").trim() || run?.assistantId || "";
    patchConvMessages(convId, (prev) => {
      // Prefer explicit message id, then current streaming assistant, then last assistant.
      let idx = targetId ? prev.findIndex((m) => m.id === targetId) : -1;
      if (idx < 0 && run?.assistantId) {
        idx = prev.findIndex((m) => m.id === run.assistantId);
      }
      if (idx < 0) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === "assistant") {
            idx = i;
            break;
          }
        }
      }
      if (idx < 0) return prev;
      const cur = prev[idx];
      const merged = normalizeMessageSources([...(cur.sources || []), ...sources]);
      if (merged.length === (cur.sources || []).length) {
        // Same set — skip churn
        const same =
          merged.length === (cur.sources || []).length &&
          merged.every((s, i) => s.url === (cur.sources || [])[i]?.url);
        if (same) return prev;
      }
      return prev.map((m, i) => (i === idx ? { ...m, sources: merged } : m));
    });
  };

  const stampSavedMessage = (
    convId: string,
    messageId: string,
    requestId?: string,
    agentId?: string,
  ) => {
    if (!messageId) return;
    const run = runsRef.current.get(convId);
    const aid = (agentId || "").trim();
    const rid = (requestId || "").trim();
    // Parallel group: resolve the local bubble for THIS agent_id only.
    // Never fall back to run.assistantId when aid is known but unmapped — that stamped
    // another bot's streaming row and swapped AgentAvatar / robot-heads.
    const resolveLocalId = (prev: UiMessage[]): string | null => {
      if (aid && run?.assistantIdsByAgent?.[aid]) return run.assistantIdsByAgent[aid];
      if (aid) {
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.role !== "assistant") continue;
          const local = Boolean(m.streaming) || m.id.startsWith("local-");
          if (!local) continue;
          if ((m.agent_id || "").trim() === aid) return m.id;
        }
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m.role !== "assistant") continue;
          if (!(m.streaming || m.id.startsWith("local-"))) continue;
          if ((m.agent_id || "").trim()) continue;
          if ((m.content || "").trim()) continue;
          return m.id;
        }
        return null;
      }
      return run?.assistantId || null;
    };
    let stampedLocalId: string | null = null;
    patchConvMessages(convId, (prev) => {
      const localId = resolveLocalId(prev);
      stampedLocalId = localId;
      const existing = prev.find((m) => m.id === messageId);
      if (existing) {
        const local = localId && localId !== messageId ? prev.find((m) => m.id === localId) : undefined;
        if (local && local.role === "assistant" && existing.role === "assistant") {
          // The saved row already arrived via WS / pullOpen as its own bubble (empty
          // placeholders never fuzzy-absorb). Fold: this agent's placeholder takes the
          // server id, drop the duplicate.
          return prev
            .filter((m) => m.id !== messageId)
            .map((m) =>
              m.id === localId
                ? {
                    ...existing,
                    ...m,
                    id: messageId,
                    content: m.content || existing.content,
                    ...(aid || existing.agent_id || m.agent_id
                      ? { agent_id: aid || existing.agent_id || m.agent_id }
                      : {}),
                    ...(rid || existing.request_id ? { request_id: rid || existing.request_id } : {}),
                  }
                : m,
            );
        }
        if (!rid && !aid) return prev;
        return prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                ...(rid && !m.request_id ? { request_id: rid } : {}),
                // Prefer explicit aid so avatar attribution cannot stick to a prior bot.
                ...(aid ? { agent_id: aid } : {}),
              }
            : m,
        );
      }
      if (!localId) return prev;
      return prev.map((m) =>
        m.id === localId
          ? {
              ...m,
              id: messageId,
              ...(rid ? { request_id: rid } : {}),
              ...(aid ? { agent_id: aid } : {}),
            }
          : m,
      );
    });
    const localId = stampedLocalId;
    if (run && localId) {
      if (run.assistantId === localId) run.assistantId = messageId;
      if (aid) {
        if (!run.assistantIdsByAgent) run.assistantIdsByAgent = {};
        if (run.assistantIdsByAgent[aid] === localId || !run.assistantIdsByAgent[aid]) {
          run.assistantIdsByAgent[aid] = messageId;
        }
      }
    }
  };

  const stampUserSavedMessage = (
    convId: string,
    messageId: string,
    extra?: { reply_to_id?: string; thread_root_id?: string; adoptThreadRoot?: boolean },
  ) => {
    if (!messageId) return;
    const localId = localUserIdRef.current;
    const serverRoot = (extra?.thread_root_id || "").trim();
    patchConvMessages(convId, (prev) => {
      if (prev.some((m) => m.id === messageId)) return prev;
      const idx = localId
        ? prev.findIndex((m) => m.id === localId)
        : [...prev].reverse().findIndex((m) => m.role === "user" && m.id.startsWith("local-user-"));
      const realIdx = localId ? idx : idx >= 0 ? prev.length - 1 - idx : -1;
      if (realIdx < 0) return prev;
      const oldId = prev[realIdx].id;
      return prev.map((m, i) => {
        if (i === realIdx) {
          // thread_root policy:
          // - Sidebar-thread send (optimistic had thread_root_id, or caller says we POSTed one):
          //   keep it, preferring the server's echoed value when present.
          // - Mainline (incl. 「回复」 quote): never adopt a server thread_root (would hide from timeline).
          const optimisticRoot = (m.thread_root_id || "").trim();
          const root =
            (optimisticRoot || extra?.adoptThreadRoot) ? serverRoot || optimisticRoot : "";
          const next: UiMessage = {
            ...m,
            id: messageId,
            reply_to_id: extra?.reply_to_id || m.reply_to_id,
          };
          if (root) next.thread_root_id = root;
          else delete next.thread_root_id;
          return next;
        }
        // Rare: thread opened on a still-local root — follow the id swap.
        if (oldId.startsWith("local-") && m.thread_root_id === oldId) {
          return { ...m, thread_root_id: messageId };
        }
        return m;
      });
    });
    if (localId && openThreadRootIdRef.current === localId) setOpenThreadRootId(messageId);
    if (localUserIdRef.current === localId) localUserIdRef.current = messageId;
    if (replyTargetRef.current?.id && replyTargetRef.current.id.startsWith("local-")) {
      // keep reply target pointing at server id when we replied to a just-sent msg (rare)
    }
  };

  const snapshotViewedMessages = () => {
    const id = conversationRef.current?.id;
    if (!id) return;
    messagesByConvRef.current.set(id, viewedMessages());
  };

  const sealStreamingMessagesForConv = (convId: string, _markStopped?: boolean) => {
    patchConvMessages(convId, (prev) =>
      prev
        .filter((m) => {
          if (m.streaming && isGroupPassContent(m.content || "")) return false;
          // Stop and supersede: drop empty streaming bubbles — never stamp 「（已停止）」.
          if (m.streaming && !(m.content && m.content.trim())) return false;
          return true;
        })
        .map((m) => {
        if (!m.streaming) return m;
        return { ...m, streaming: false };
      }),
    );
    const run = runsRef.current.get(convId);
    if (run) run.assistantId = null;
  };

  /** Stop a specific conversation's run (default: currently viewed). Does not touch other bots. */
  const stopCurrentRun = async (opts?: {
    /** @deprecated Ignored — empty bubbles are always dropped; no 「（已停止）」. */
    markStopped?: boolean;
    waitForFlush?: boolean;
    conversationId?: string;
    /**
     * Abort the local stream only. Used when a newer send will supersede via
     * server register (cancelReason=replace).
     */
    localOnly?: boolean;
  }) => {
    const convId = opts?.conversationId ?? conversationRef.current?.id;
    if (!convId) return;
    const run = runsRef.current.get(convId);
    if (run) {
      run.generation += 1;
      run.abort.abort();
      // localOnly (interrupt-and-send): keep the map entry so generation stays
      // monotonic. Deleting reset gen→0 and let the stale send's finally match
      // the superseding run (same gen) and drop it — bot appeared silent.
      if (!opts?.localOnly) {
        runsRef.current.delete(convId);
        bumpRunBusy();
      } else {
        // Refresh busy tick so viewingRunActive/chatProcessing re-render while
        // the map entry is retained (pairs with d6c4fcf processing indicator).
        bumpRunBusy();
      }
    }
    sealStreamingMessagesForConv(convId);
    if (conversationRef.current?.id === convId) {
      // localOnly (interrupt-and-send): keep sending/processing UI. Clearing it
      // while runsRef is retained (e806a30) desynced RunStatus after replace interrupts.
      if (!opts?.localOnly) {
        setSending(false);
      }
      setRunLabel("正在思考…");
    }
    if (opts?.localOnly) return;
    const rid =
      conversationRef.current?.id === convId ? lastRequestIdRef.current.trim() : "";
    const cancelPromise = cancelConversationRun(
      convId,
      rid ? { requestId: rid } : undefined,
    ).catch(() => {});
    if (opts?.waitForFlush) {
      await cancelPromise;
    }
  };

  const mapApiMessages = (msgs: Message[], nameLookup: Map<string, string> | Agent[]) => {
    const nameOf = (agentId: string) => {
      if (Array.isArray(nameLookup)) {
        return nameLookup.find((a) => a.id === agentId)?.name || agentId;
      }
      return nameLookup.get(agentId) || agentId;
    };
    return msgs
      .filter((m) => m.role !== "summary")
      // Drop any silence tokens that leaked into storage (journal race / old rows).
      .filter((m) => !(m.role === "assistant" && isGroupPassContent(m.content || "")))
      // Legacy 「（已停止）」 rows: never show (Stop and supersede both omit the marker).
      .filter((m) => !(m.role === "assistant" && isStopMarkerContent(m.content)))
      .map((m) => ({
        ...m,
        agent_name: m.agent_id ? nameOf(m.agent_id) : undefined,
      }));
  };

  /** After refresh / reconnect: rejoin a server-owned in-flight run for this conversation. */
  const resumeActiveRun = async (
    conv: Conversation,
    nameLookup: Map<string, string> | Agent[],
  ) => {
    if (runsRef.current.has(conv.id)) return;
    let active = false;
    try {
      active = (await getConversationRunStatus(conv.id)).active;
    } catch {
      return;
    }
    if (!active) return;

    const ac = new AbortController();
    const gen = (runsRef.current.get(conv.id)?.generation ?? 0) + 1;
    runsRef.current.set(conv.id, {
      abort: ac,
      generation: gen,
      assistantId: null,
      runLabel: "正在思考…",
      activeTool: "",
      faceAgentId: "",
      selectionKey: selectionKeyForConv(conv),
    });
    bumpRunBusy();
    if (conversationRef.current?.id === conv.id) {
      setSending(true);
      setRunLabel("正在思考…");
      setRunActiveTool("");
      setRunFaceAgentId("");
    }

    const isRunCurrent = () => {
      const run = runsRef.current.get(conv.id);
      return Boolean(run && run.generation === gen && run.abort === ac);
    };
    const isViewingStream = () => conversationRef.current?.id === conv.id;
    const setRunLabelForStream = (label: string) => {
      const run = runsRef.current.get(conv.id);
      if (run && run.generation === gen && run.abort === ac) run.runLabel = label;
      if (isViewingStream()) setRunLabel(label);
    };
    const setActiveToolForStream = (tool: string) => {
      const run = runsRef.current.get(conv.id);
      if (run && run.generation === gen && run.abort === ac) run.activeTool = tool;
      if (isViewingStream()) setRunActiveTool(tool);
    };
    const setFaceAgentForStream = (agentId: string) => {
      const run = runsRef.current.get(conv.id);
      if (run && run.generation === gen && run.abort === ac) run.faceAgentId = agentId;
      if (isViewingStream()) setRunFaceAgentId(agentId);
    };
    const ensureStreamingBubble = (agentId?: string, agentName?: string) => {
      const run = runsRef.current.get(conv.id);
      if (!run || run.generation !== gen || run.abort !== ac) return;
      if (!run.assistantIdsByAgent) run.assistantIdsByAgent = {};
      if (agentId && run.assistantIdsByAgent[agentId]) {
        const id = run.assistantIdsByAgent[agentId];
        const cur = (messagesByConvRef.current.get(conv.id) ?? []).find((m) => m.id === id);
        if (cur?.streaming) {
          run.assistantId = id;
          return;
        }
      }
      // Claim unnamed streaming placeholder when present.
      if (run.assistantId) {
        const cur = (messagesByConvRef.current.get(conv.id) ?? []).find((m) => m.id === run.assistantId);
        if (cur?.streaming && (!cur.agent_id || cur.agent_id === agentId)) {
          if (agentId && !cur.agent_id) {
            run.assistantIdsByAgent[agentId] = run.assistantId;
            patchConvMessages(conv.id, (prev) =>
              prev.map((m) =>
                m.id === run.assistantId
                  ? { ...m, agent_id: agentId, agent_name: agentName || m.agent_name, streaming: true }
                  : m,
              ),
            );
          }
          return;
        }
      }
      // Parallel resume: keep other agents' streaming bubbles; add one for this agent.
      const nextId = `local-asst-resume-${Date.now()}-${agentId || "x"}`;
      run.assistantId = nextId;
      if (agentId) run.assistantIdsByAgent[agentId] = nextId;
      patchConvMessages(conv.id, (prev) => [
        ...prev,
        {
          id: nextId,
          role: "assistant" as const,
          content: "",
          streaming: true,
          agent_id: agentId,
          agent_name: agentName,
        },
      ]);
    };

    try {
      await subscribeConversationEvents(
        conv.id,
        {
          onBotOnline: (evt) => {
            if (!evt.agent_id) return;
            const openId = conversationRef.current?.id;
            if (evt.conversation_id && openId && evt.conversation_id !== openId) return;
            applyBotOnline(evt.agent_id, evt.online === true);
          },
          onAgentStart: (info) => {
            if (!isRunCurrent()) return;
            const name =
              info.agent_name ||
              (Array.isArray(nameLookup)
                ? nameLookup.find((a) => a.id === info.agent_id)?.name
                : nameLookup.get(info.agent_id)) ||
              info.agent_id;
            setRunLabelForStream(`${name} 正在回复…`);
            if (info.agent_id) setFaceAgentForStream(info.agent_id);
            ensureStreamingBubble(info.agent_id, name);
          },
          onToken: (text, info) => {
            if (!isRunCurrent()) return;
            ensureStreamingBubble(info?.agent_id);
            const run = runsRef.current.get(conv.id);
            const agentId = info?.agent_id;
            if (agentId && !run?.faceAgentId) setFaceAgentForStream(agentId);
            const curId =
              (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
            if (!curId) return;
            patchConvMessages(conv.id, (prev) =>
              prev.map((m) => (m.id === curId ? { ...m, content: m.content + text, streaming: true } : m)),
            );
          },
          onMeta: (meta) => {
            if (!isRunCurrent()) return;
            if (meta.phase === "resumed") {
              if (isViewingStream()) {
                setSending(true);
                setRunLabel("正在思考…");
              }
              return;
            }
            if (meta.phase === "cancelled") {
              sealStreamingMessagesForConv(conv.id);
              setActiveToolForStream("");
              // finally clears sending when this resume gen still owns the run.
              if (isViewingStream()) {
                setRunLabel("正在思考…");
              }
            }
            if (meta.phase === "user_saved" && typeof meta.message_id === "string") {
              stampUserSavedMessage(conv.id, meta.message_id, {
                reply_to_id: typeof meta.reply_to_id === "string" ? meta.reply_to_id : undefined,
                thread_root_id: typeof meta.thread_root_id === "string" ? meta.thread_root_id : undefined,
              });
            }
            if (meta.phase === "message_saved" && typeof meta.message_id === "string") {
              stampSavedMessage(
                conv.id,
                meta.message_id,
                typeof meta.request_id === "string" ? meta.request_id : undefined,
                typeof meta.agent_id === "string" ? meta.agent_id : undefined,
              );
              if (meta.sources != null) {
                attachSourcesToStreaming(conv.id, meta.sources, meta.message_id);
              }
            } else if (meta.sources != null) {
              attachSourcesToStreaming(conv.id, meta.sources);
            }
            if (meta.phase === "task_queued") {
              noteTask(conv.id, true, "正在做…");
            }
          },
          onStatus: (data) => {
            if (!isRunCurrent()) return;
            const phase = String(data.phase || "");
            const tool = typeof data.tool === "string" ? data.tool : "";
            if (phase === "tool") {
              setActiveToolForStream(tool || data.label || "tool");
            } else if (phase === "thinking" || phase === "tool_done") {
              setActiveToolForStream("");
            }
            if (typeof data.label === "string" && data.label.trim()) {
              if (phase === "tool" && tool) {
                setRunLabelForStream(`${data.label} · ${tool}`);
              } else {
                setRunLabelForStream(data.label);
              }
              return;
            }
            if (phase === "tool") {
              setRunLabelForStream(tool ? `正在运行命令 · ${tool}` : "正在运行命令");
            } else if (phase === "thinking" || phase === "tool_done") {
              setRunLabelForStream("正在思考…");
            }
          },
          onError: (msg, info) => {
            if (!isRunCurrent()) return;
            ensureStreamingBubble(info?.agent_id);
            const run = runsRef.current.get(conv.id);
            const agentId = info?.agent_id;
            const curId =
              (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
            patchConvMessages(conv.id, (prev) =>
              prev.map((m) =>
                m.id === curId
                  ? { ...m, streaming: false, content: m.content || `（失败）${msg}` }
                  : m,
              ),
            );
          },
          onDone: () => {
            if (!isRunCurrent()) return;
            sealStreamingMessagesForConv(conv.id, false);
            setActiveToolForStream("");
            setRunLabelForStream("正在思考…");
            void listMessages(conv.id)
              .then((msgs) => {
                if (!isRunCurrent() && runsRef.current.has(conv.id)) return;
                // Only replace if this resume gen already cleaned or still current after seal.
                if (conversationRef.current?.id === conv.id || messagesByConvRef.current.has(conv.id)) {
                  const mapped = mapApiMessages(msgs, nameLookup);
                  messagesByConvRef.current.set(conv.id, mapped);
                  if (conversationRef.current?.id === conv.id) {
                    setMessages(mapped);
                  }
                }
              })
              .catch(() => {});
            void refreshConversations();
          },
        },
        ac.signal,
      );
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (aborted) return;
      if (!isRunCurrent()) return;
      console.warn("resume run failed", err);
    } finally {
      const run = runsRef.current.get(conv.id);
      // Match generation AND abort controller (same as sendUserText) so a
      // superseded resume cannot clear the interrupt replacement run's UI.
      if (run && run.generation === gen && run.abort === ac) {
        runsRef.current.delete(conv.id);
        bumpRunBusy();
        if (conversationRef.current?.id === conv.id) {
          setSending(false);
        }
      }
    }
  };


  const applyConversationView = (conv: Conversation, apiMsgs?: Message[], nameLookup?: Map<string, string> | Agent[]) => {
    chatScrollRef.stickToBottom = true;
    // Sync ref immediately so in-flight tokens for the previous conv cannot paint into this view.
    conversationRef.current = conv;
    setConversation(conv);
    // Session-host green dot: stamp from this conversation's participants.
    for (const p of conv.participants ?? []) {
      if (p.agent_id && typeof p.online === "boolean") {
        applyBotOnline(p.agent_id, p.online);
      }
    }
    replyTargetRef.current = null;
    setReplyTarget(null);
    setOpenThreadRootId(null);
    setChatSwitchPending(false);
    const activeRun = runsRef.current.get(conv.id);
    if (activeRun) {
      const buffered = messagesByConvRef.current.get(conv.id) ?? [];
      setMessages(buffered);
      setSending(true);
      setRunLabel(activeRun.runLabel || "正在思考…");
      setRunActiveTool(activeRun.activeTool || "");
      setRunFaceAgentId(activeRun.faceAgentId || "");
      return;
    }
    setSending(false);
    setRunLabel("正在思考…");
    setRunActiveTool("");
    setRunFaceAgentId("");
    if (apiMsgs) {
      const mapped = mapApiMessages(apiMsgs, nameLookup ?? agents);
      messagesByConvRef.current.set(conv.id, mapped);
      setMessages(mapped);
    } else {
      // Never leave the previous conversation's bubbles on screen when apiMsgs was omitted.
      const cached = messagesByConvRef.current.get(conv.id) ?? [];
      setMessages(cached);
    }
  };

  const onSelectAgent = useCallback(async (id: string) => {
    snapshotViewedMessages();
    const selectGen = ++selectGenRef.current;
    // Hide Stop for the previous run while the target chat loads; do not cancel it.
    setSending(false);
    setRunLabel("正在思考…");
    setMobileView("chat");
    setAgentId(id);
    setPendingFiles([]);
    setStatus("");
    // Drop previous conv immediately so stream patches cannot re-paint old bubbles under the new header.
    chatScrollRef.stickToBottom = true;
    setChatSwitchPending(true);
    conversationRef.current = null;
    setConversation(null);
    replyTargetRef.current = null;
    setReplyTarget(null);
    setOpenThreadRootId(null);
    const agentEntry = agents.find((a) => a.id === id);
    const cachedConvId = (agentEntry?.conversation_id || "").trim();
    const cachedMsgs = cachedConvId ? messagesByConvRef.current.get(cachedConvId) : undefined;
    if (cachedMsgs) {
      setMessages(cachedMsgs);
    } else {
      setMessages([]);
    }
    try {
      const conv = await openPrimaryConversation(id);
      if (selectGen !== selectGenRef.current) return;
      conversationRef.current = conv;
      const activeRun = runsRef.current.get(conv.id);
      let apiMsgs: Message[] | undefined;
      let runActive = false;
      if (!activeRun) {
        const listed = await listMessagesWithStatus(conv.id);
        if (selectGen !== selectGenRef.current) return;
        apiMsgs = listed.messages;
        runActive = Boolean(listed.run_active);
        noteTask(conv.id, Boolean(listed.task_active), listed.task_active ? "正在做…" : undefined);
      } else {
        setTaskBusy(taskConvIdsRef.current.has(conv.id));
      }
      applyConversationView(conv, apiMsgs, agents);
      saveLastActiveSelection({ kind: "agent", id });
      void refreshAgents().catch(() => {});
      if (!activeRun && runActive) {
        void resumeActiveRun(conv, agents);
      }
    } catch (err) {
      if (selectGen !== selectGenRef.current) return;
      conversationRef.current = null;
      setConversation(null);
      setMessages([]);
      setChatSwitchPending(false);
      setSending(false);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [agents, refreshAgents, saveLastActiveSelection]);

  const openChannelChat = useCallback(async (channelId: string) => {
    try {
      snapshotViewedMessages();
      const selectGen = ++selectGenRef.current;
      setSending(false);
      setRunLabel("正在思考…");
      setMobileView("chat");
      chatScrollRef.stickToBottom = true;
      setChatSwitchPending(true);
      // Drop previous conv immediately so old bubbles cannot linger under the new channel header.
      conversationRef.current = null;
      setConversation(null);
      replyTargetRef.current = null;
      setReplyTarget(null);
      setOpenThreadRootId(null);
      const channelEntry = channels.find((c) => c.id === channelId);
      const cachedConvId = (channelEntry?.conversation_id || "").trim();
      const cachedMsgs = cachedConvId ? messagesByConvRef.current.get(cachedConvId) : undefined;
      if (cachedMsgs) {
        setMessages(cachedMsgs);
      } else {
        setMessages([]);
      }
      setPendingFiles([]);
      setStatus("");
      const { conversation: conv } = await openChannelConversation(channelId);
      if (selectGen !== selectGenRef.current) return;
      conversationRef.current = conv;
      setAgentId(conv.agent_id);
      const activeRun = runsRef.current.get(conv.id);
      let apiMsgs: Message[] | undefined;
      let runActive = false;
      if (!activeRun) {
        const listed = await listMessagesWithStatus(conv.id);
        if (selectGen !== selectGenRef.current) return;
        apiMsgs = listed.messages;
        runActive = Boolean(listed.run_active);
        noteTask(conv.id, Boolean(listed.task_active), listed.task_active ? "正在做…" : undefined);
      } else {
        setTaskBusy(taskConvIdsRef.current.has(conv.id));
      }
      applyConversationView(conv, apiMsgs, agentNameById);
      saveLastActiveSelection({ kind: "channel", id: channelId });
      await refreshChannels();
      if (!activeRun && runActive) {
        void resumeActiveRun(conv, agentNameById);
      }
    } catch (err) {
      setChatSwitchPending(false);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [agentNameById, channels, refreshChannels, saveLastActiveSelection]);

  const sendUserText = async (rawContent: string, filesToSend: PendingFile[] = []) => {
    const content = rawContent.trim();
    if ((!content && filesToSend.length === 0) || !authed) return;
    // Sidebar thread panel (opened via 「N 条回复」) shares this Composer. Capture it now,
    // before any await, so the send goes where the user was looking when they hit Enter.
    const threadRootAtSend = (openThreadRootIdRef.current || "").trim();
    const threadConvAtSend = conversationRef.current?.id;
    // keep-partial-next-turn: only interrupt the *current* conversation's run.
    // Supersede: seal partial locally, drop empty bubbles (no 「（已停止）」). Server
    // cancel + durable abort is left to the next send's register (cancelReason=replace).
    const viewedId = conversationRef.current?.id;
    let supersededBusy = false;
    if (viewedId && runsRef.current.has(viewedId)) {
      supersededBusy = true;
      await stopCurrentRun({
        localOnly: true,
        conversationId: viewedId,
      });
    } else if (
      chatState().sending ||
      chatState().taskBusy ||
      (viewedId ? taskConvIdsRef.current.has(viewedId) : false)
    ) {
      // Durable still busy but client map empty (SSE drop / finally raced): force
      // when_busy=replace so the API aborts the old harness instead of inbox-queue
      // (inbox → done with no tokens → empty bubble → looks like never replied).
      supersededBusy = true;
    }

    // DM: @其他 Bot → 切到对方主线程再发；原会话留下转交记录，并把近期上下文带给对方。
    let sendContent = content;
    let handoffConv: Conversation | null = null;
    let handoffContext: { role: string; content: string }[] | undefined;
    const inGroup = Boolean(conversationRef.current?.channel_id);
    if (!inGroup && content) {
      const mentioned = firstMentionedAgent(content, agents);
      const currentAid = conversationRef.current?.agent_id || agentId;
      if (mentioned && mentioned.id !== currentAid) {
        try {
          const sourceConvId = conversationRef.current?.id;
          const sourceAgent =
            agents.find((a) => a.id === currentAid) ||
            ({ id: currentAid, name: agentNameById.get(currentAid) || "助手" } as Agent);
          const sourceMsgs = sourceConvId
            ? messagesByConvRef.current.get(sourceConvId) ?? viewedMessages()
            : viewedMessages();
          handoffContext = buildHandoffContext(sourceMsgs, sourceAgent.name || "助手");

          // 原 Bot 会话留下这次转交，下次回来仍看得见、模型也读得到。
          if (sourceConvId) {
            try {
              const persisted = await persistConversationMessage(sourceConvId, content);
              patchConvMessages(sourceConvId, (prev) => [
                ...prev,
                {
                  id: persisted.id,
                  role: "user",
                  content,
                  created_at: persisted.created_at,
                },
              ]);
            } catch {
              patchConvMessages(sourceConvId, (prev) => [
                ...prev,
                { id: `local-handoff-${Date.now()}`, role: "user", content },
              ]);
            }
          }

          snapshotViewedMessages();
          selectGenRef.current += 1;
          setAgentId(mentioned.id);
          const targetConv = await openPrimaryConversation(mentioned.id);
          conversationRef.current = targetConv;
          setConversation(targetConv);
          const listed = await listMessagesWithStatus(targetConv.id);
          const mapped = mapApiMessages(listed.messages, agentNameById);
          messagesByConvRef.current.set(targetConv.id, mapped);
          setMessages(mapped);
          noteTask(
            targetConv.id,
            Boolean(listed.task_active),
            listed.task_active ? "正在做…" : undefined,
          );
          handoffConv = targetConv;
          sendContent = stripLeadingAtAgent(content, mentioned);
          saveLastActiveSelection({ kind: "agent", id: mentioned.id });
          toast.message(`已转给 ${mentioned.name}（已带上此前对话）`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
          return;
        }
      }
    }

    setSending(true);
    setInput("");
    setPendingFiles([]);
    setStatus("");
    setRunLabel("正在思考…");
    // Choosing / answering onboarding hides the card for this conversation
    setOnboardingDismissed(onboardingKey);
    setOnboardingDismissedState(true);
    // After send always jump to bottom (common chat pattern).
    pinChatScroll();
    const localAttachments: AttachmentMeta[] = filesToSend.map((f, i) => {
      const mime = f.file.type || "application/octet-stream";
      const meta: AttachmentMeta = {
        id: `local-${i}`,
        name: f.file.name,
        mime,
        size: f.file.size,
        path: "",
      };
      // Optimistic image preview via blob: until upload returns auth url.
      if (/^image\//i.test(mime)) {
        try {
          meta.url = URL.createObjectURL(f.file);
        } catch {
          /* ignore */
        }
      }
      return meta;
    });
    const activeReply = replyTargetRef.current;
    // thread_root_id is set ONLY when the sidebar thread panel is open (「N 条回复」) and we are
    // still in that conversation (not a DM @handoff into another Bot).
    // PM: explicit 「回复」 on the mainline is quote only — reply_to_id, no thread_root_id.
    // Diverting into thread_root would hide the send (and Bot answer) from the main timeline.
    const sendThreadRootId =
      threadRootAtSend && !handoffConv && conversationRef.current?.id === threadConvAtSend
        ? threadRootAtSend
        : "";
    const threadStamp = sendThreadRootId ? { thread_root_id: sendThreadRootId } : {};
    const userMsg: UiMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      content: sendContent || (filesToSend.length ? `（${filesToSend.length} 个附件）` : ""),
      attachments: localAttachments.length ? localAttachments : undefined,
      ...(activeReply?.id ? { reply_to_id: activeReply.id } : {}),
      ...threadStamp,
    };
    localUserIdRef.current = userMsg.id;
    // Clear reply bar after capturing (composer already cleared input above).
    if (activeReply) {
      replyTargetRef.current = null;
      setReplyTarget(null);
    }
    const assistantId = `local-asst-${Date.now()}`;
    const appendOptimistic = (prev: UiMessage[]) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant" as const,
        content: "",
        streaming: true,
        // No reply_to_id: Bot answers are not quotes (only explicit「回复」).
        // thread_root_id only for sidebar-thread sends (stays in panel); mainline stays unset.
        ...threadStamp,
      },
    ];
    const optTargetId = handoffConv?.id || conversationRef.current?.id || viewedId;
    if (optTargetId) {
      patchConvMessages(optTargetId, appendOptimistic);
    } else {
      setMessages(appendOptimistic(viewedMessages()));
    }
    const mentionAgentIds = (() => {
      if (!conversationRef.current?.channel_id || !groupMentionMembers?.length) {
        return undefined as string[] | undefined;
      }
      const re = /@([^\s@]+)/g;
      const ids: string[] = [];
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      let everyone = false;
      while ((m = re.exec(sendContent)) !== null) {
        const tok = m[1].replace(/[.,!?;:，。！？；：]+$/u, "");
        const lower = tok.toLowerCase();
        if (lower === "everyone" || lower === "all") {
          everyone = true;
          continue;
        }
        const hit = matchAgentByMentionToken(tok, groupMentionMembers);
        if (hit && !seen.has(hit.id)) {
          seen.add(hit.id);
          ids.push(hit.id);
        }
      }
      if (everyone) {
        return groupMentionMembers.map((a) => a.id);
      }
      // Specific @ → those agents. No @ → omit agent_ids so server AutoPick runs.
      // (Legacy sent all member ids here, which made the API treat the turn as
      // explicit addressing and skip AutoPick — every bot answered.)
      if (ids.length) return ids;
      return undefined;
    })();
    let sendSelection: LastActiveSelection | null = null;
    let sendHadError = false;
    let streamConvId: string | null = null;
    let gen = 0;
    let ac: AbortController | undefined;
    try {
      const conv = handoffConv ?? (await ensureConversation());
      streamConvId = conv.id;
      sendSelection = conv.channel_id
        ? { kind: "channel", id: conv.channel_id }
        : { kind: "agent", id: conv.agent_id };
      // Ensure buffer has optimistic messages under the real conv id (first send may create it).
      if (!messagesByConvRef.current.has(streamConvId) || conversationRef.current?.id === streamConvId) {
        messagesByConvRef.current.set(streamConvId, viewedMessages());
      }
      void refreshConversations();
      void refreshAgents().catch(() => {});
      let uploaded: AttachmentMeta[] = [];
      if (filesToSend.length > 0) {
        uploaded = [];
        for (const pf of filesToSend) {
          uploaded.push(await uploadConversationAttachment(conv.id, pf.file));
        }
        patchConvMessages(streamConvId, (prev) =>
          prev.map((m) => {
            if (m.id !== userMsg.id) return m;
            for (const a of m.attachments || []) {
              if (a.url && a.url.startsWith("blob:")) {
                try {
                  URL.revokeObjectURL(a.url);
                } catch {
                  /* ignore */
                }
              }
            }
            return { ...m, attachments: uploaded };
          }),
        );
      }
      ac = new AbortController();
      gen = (runsRef.current.get(streamConvId)?.generation ?? 0) + 1;
      runsRef.current.set(streamConvId, {
        abort: ac,
        generation: gen,
        assistantId,
        runLabel: "正在思考…",
        activeTool: "",
        faceAgentId: "",
        selectionKey: selectionKeyForConv(conv),
      });
      bumpRunBusy();
      const isRunCurrent = () => {
        const run = runsRef.current.get(streamConvId!);
        // Match abort too (same as finally) so a superseded slot that somehow
        // kept the same generation cannot steal tokens from the replacement.
        return Boolean(run && run.generation === gen && run.abort === ac);
      };
      const isViewingStream = () => conversationRef.current?.id === streamConvId;
      const setRunLabelForStream = (label: string) => {
        const run = runsRef.current.get(streamConvId!);
        if (run && run.generation === gen && run.abort === ac) run.runLabel = label;
        if (isViewingStream()) setRunLabel(label);
      };
      const setActiveToolForStream = (tool: string) => {
        const run = runsRef.current.get(streamConvId!);
        if (run && run.generation === gen && run.abort === ac) run.activeTool = tool;
        if (isViewingStream()) setRunActiveTool(tool);
      };
      const setFaceAgentForStream = (agentId: string) => {
        const run = runsRef.current.get(streamConvId!);
        if (run && run.generation === gen && run.abort === ac) run.faceAgentId = agentId;
        if (isViewingStream()) setRunFaceAgentId(agentId);
      };
      if (isViewingStream()) {
        setRunActiveTool("");
        setRunFaceAgentId("");
      }
      await sendMessageStream(
        conv.id,
        sendContent,
        {
          onAgentStart: (info) => {
            if (!isRunCurrent()) return;
            const name =
              info.agent_name ||
              agents.find((a) => a.id === info.agent_id)?.name ||
              info.agent_id;
            setRunLabelForStream(`${name} 正在回复…`);
            if (info.agent_id) setFaceAgentForStream(info.agent_id);
            patchConvMessages(streamConvId!, (prev) => {
              const run = runsRef.current.get(streamConvId!);
              if (!run) return prev;
              if (!run.assistantIdsByAgent) run.assistantIdsByAgent = {};
              const existingId = run.assistantIdsByAgent[info.agent_id];
              if (existingId && prev.some((m) => m.id === existingId)) {
                run.assistantId = existingId;
                return prev.map((m) =>
                  m.id === existingId
                    ? { ...m, agent_id: info.agent_id, agent_name: name, streaming: true }
                    : m,
                );
              }
              const curId = run.assistantId;
              const cur = curId ? prev.find((m) => m.id === curId) : undefined;
              // First agent: stamp identity on the placeholder bubble.
              if (cur && !cur.content && !cur.agent_id) {
                run.assistantIdsByAgent[info.agent_id] = curId!;
                return prev.map((m) =>
                  m.id === curId
                    ? { ...m, agent_id: info.agent_id, agent_name: name, streaming: true }
                    : m,
                );
              }
              // Parallel candidates: add a new bubble; do NOT seal other agents' streams.
              const nextId = `local-asst-${Date.now()}-${info.index ?? 0}-${info.agent_id}`;
              run.assistantIdsByAgent[info.agent_id] = nextId;
              run.assistantId = nextId;
              return [
                ...prev,
                {
                  id: nextId,
                  role: "assistant",
                  content: "",
                  streaming: true,
                  agent_id: info.agent_id,
                  agent_name: name,
                  // Sidebar-thread send: follow-on agent bubbles stay in the panel.
                  // Mainline (incl. 「回复」): no thread_root_id.
                  ...threadStamp,
                },
              ];
            });
          },
          onToken: (text, info) => {
            if (!isRunCurrent()) return;
            const run = runsRef.current.get(streamConvId!);
            const agentId = info?.agent_id;
            if (agentId && !run?.faceAgentId) setFaceAgentForStream(agentId);
            const curId =
              (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
            if (!curId) return;
            patchConvMessages(streamConvId!, (prev) =>
              prev.map((m) => (m.id === curId ? { ...m, content: m.content + text } : m)),
            );
          },
          onMeta: (meta) => {
            if (!isRunCurrent()) return;
            if (typeof meta.request_id === "string" && meta.request_id) {
              lastRequestIdRef.current = meta.request_id;
            } else if (typeof meta.run_id === "string" && meta.run_id) {
              lastRequestIdRef.current = meta.run_id;
            }
            if (meta.waiting_approval && streamConvId && lastRequestIdRef.current) {
              setApprovalGate({
                conversationId: streamConvId,
                requestId: lastRequestIdRef.current,
              });
            }
            if (meta.phase === "cancelled") {
              sealStreamingMessagesForConv(streamConvId!);
              setActiveToolForStream("");
              // Do not setSending(false) here: localOnly supersede keeps runsRef and
              // a newer turn may already own the processing indicator. finally clears
              // sending only when this gen+abort still owns the map entry.
              if (isViewingStream()) {
                setRunLabel("正在思考…");
              }
            }
            if (meta.phase === "agent_skipped") {
              const skipId = typeof meta.agent_id === "string" ? meta.agent_id : "";
              // Server is authoritative: drop the in-flight bubble for this agent even if
              // streamed tokens were not yet classified as PASS (e.g. mid-stream / wrappers).
              patchConvMessages(streamConvId!, (prev) => {
                const run = runsRef.current.get(streamConvId!);
                const mappedId = skipId && run?.assistantIdsByAgent?.[skipId];
                return prev.filter((m) => {
                  const dropMapped = Boolean(mappedId && m.id === mappedId);
                  const dropPassForAgent =
                    Boolean(skipId) &&
                    m.agent_id === skipId &&
                    (m.streaming || isGroupPassContent(m.content || ""));
                  const drop = dropMapped || dropPassForAgent;
                  if (drop && run) {
                    if (run.assistantId === m.id) run.assistantId = "";
                    if (skipId && run.assistantIdsByAgent?.[skipId] === m.id) {
                      delete run.assistantIdsByAgent[skipId];
                    }
                  }
                  return !drop;
                });
              });
            }
            if (meta.phase === "user_saved" && typeof meta.message_id === "string") {
              stampUserSavedMessage(streamConvId!, meta.message_id, {
                reply_to_id: typeof meta.reply_to_id === "string" ? meta.reply_to_id : undefined,
                thread_root_id: typeof meta.thread_root_id === "string" ? meta.thread_root_id : undefined,
                // Adopt server thread_root only when we intentionally POSTed one.
                adoptThreadRoot: Boolean(sendThreadRootId),
              });
            }
            if (meta.phase === "message_saved" && typeof meta.message_id === "string") {
              stampSavedMessage(
                streamConvId!,
                meta.message_id,
                typeof meta.request_id === "string" ? meta.request_id : undefined,
                typeof meta.agent_id === "string" ? meta.agent_id : undefined,
              );
              if (meta.sources != null) {
                attachSourcesToStreaming(streamConvId!, meta.sources, meta.message_id);
              }
            } else if (meta.sources != null) {
              attachSourcesToStreaming(streamConvId!, meta.sources);
            }
            if (meta.phase === "task_queued") {
              noteTask(streamConvId!, true, "正在做…");
            }
          },
          onStatus: (data) => {
            if (!isRunCurrent()) return;
            const phase = String(data.phase || "");
            const tool = typeof data.tool === "string" ? data.tool : "";
            if (phase === "waiting_approval") {
              setActiveToolForStream("");
              setRunLabelForStream(
                typeof data.label === "string" && data.label.trim()
                  ? data.label
                  : "等待确认后继续",
              );
              const rid = lastRequestIdRef.current;
              if (rid && streamConvId) {
                setApprovalGate({ conversationId: streamConvId, requestId: rid });
              }
              return;
            }
            if (phase === "tool") {
              setActiveToolForStream(tool || data.label || "tool");
            } else if (phase === "thinking" || phase === "tool_done") {
              setActiveToolForStream("");
            }
            if (typeof data.label === "string" && data.label.trim()) {
              if (phase === "tool" && tool) {
                setRunLabelForStream(`${data.label} · ${tool}`);
              } else {
                setRunLabelForStream(data.label);
              }
              return;
            }
            if (phase === "tool") {
              setRunLabelForStream(tool ? `正在运行命令 · ${tool}` : "正在运行命令");
            } else if (phase === "thinking" || phase === "tool_done") {
              setRunLabelForStream("正在思考…");
            }
          },
          onError: (msg, info) => {
            if (!isRunCurrent()) return;
            sendHadError = true;
            setStatus(`错误：${msg}`);
            setActiveToolForStream("");
            setRunLabelForStream("正在思考…");
            const run = runsRef.current.get(streamConvId!);
            const agentId = info?.agent_id;
            const curId =
              (agentId && run?.assistantIdsByAgent?.[agentId]) || run?.assistantId || null;
            patchConvMessages(streamConvId!, (prev) =>
              prev.map((m) =>
                m.id === curId
                  ? { ...m, streaming: false, content: m.content || `（失败）${msg}` }
                  : m,
              ),
            );
          },
          onDone: (data) => {
            if (!isRunCurrent()) return;
            const doneFailed =
              data?.ok === false &&
              !data?.waiting_approval &&
              !data?.cancelled &&
              typeof data?.error === "string" &&
              Boolean((data.error as string).trim());
            const failText =
              doneFailed && typeof data?.error === "string"
                ? `（失败）${(data.error as string).trim()}`
                : "";
            const inboxQueued = Boolean(data?.inbox);
            // Parallel group: seal every streaming bubble; drop PASS silence
            // (keep empty streaming bubble when doneFailed so failure text can show).
            // Inbox queue: drop empty placeholders — no tokens will arrive on this SSE.
            patchConvMessages(streamConvId!, (prev) =>
              prev
                .filter((m) => {
                  if (inboxQueued && m.role === "assistant" && !(m.content || "").trim() && (m.streaming || m.id === assistantId)) {
                    return false;
                  }
                  if (!(m.streaming && isGroupPassContent(m.content || ""))) return true;
                  return Boolean(doneFailed);
                })
                .map((m) => {
                  if (!m.streaming) return m;
                  const content =
                    !(m.content || "").trim() && failText ? failText : m.content;
                  return { ...m, streaming: false, content };
                }),
            );
            setActiveToolForStream("");
            if (data?.waiting_approval && streamConvId) {
              const rid =
                (typeof data.request_id === "string" && data.request_id) ||
                lastRequestIdRef.current;
              if (rid) {
                setApprovalGate({ conversationId: streamConvId, requestId: rid });
                setRunLabelForStream("等待确认后继续");
              }
            } else if (!taskConvIdsRef.current.has(streamConvId!)) {
              setRunLabelForStream("正在思考…");
            }
            void refreshConversations();
          },
        },
        ac.signal,
        uploaded.length ? uploaded : undefined,
        mentionAgentIds,
        (() => {
          // Browser must not send a stale desktop machine_id from localStorage —
          // that makes the model think the user is on that Mac and invent Downloads contents.
          const tz = effectiveTimezone(readCachedUserSettings());
          if (!shouldRegisterAsHost(clientEnv)) {
            return { ...clientEnv, machine_id: undefined, machine_label: undefined, timezone: tz };
          }
          const mid = getStoredMachineId() || undefined;
          const fromList = mid ? machines.find((x) => x.id === mid)?.label : undefined;
          const machine_label =
            (fromList || deviceDisplayName || defaultMachineLabel(clientEnv) || "").trim() ||
            undefined;
          return { ...clientEnv, machine_id: mid, machine_label, timezone: tz };
        })(),
        handoffContext,
        activeReply?.id,
        sendThreadRootId || undefined,
        supersededBusy ? "replace" : undefined,
      );
      if (!sendHadError && sendSelection) {
        saveLastActiveSelection(sendSelection);
      }
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (aborted) {
        // stopCurrentRun already sealed bubbles; ignore stale aborts from interrupt-and-send.
        return;
      }
      if (streamConvId && !((runsRef.current.get(streamConvId)?.generation ?? 0) === gen)) return;
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`发送失败：${msg}`);
      if (streamConvId) {
        const curId = runsRef.current.get(streamConvId)?.assistantId ?? assistantId;
        patchConvMessages(streamConvId, (prev) =>
          prev.map((m) =>
            m.id === curId
              ? { ...m, streaming: false, content: m.content || `（失败）${msg}` }
              : m,
          ),
        );
        if (conversationRef.current?.id === streamConvId) {
          setRunLabel("正在思考…");
        }
      } else {
        setRunLabel("正在思考…");
      }
    } finally {
      if (streamConvId) {
        const run = runsRef.current.get(streamConvId);
        // Match generation AND abort controller so a superseded turn's late
        // finally cannot delete the interrupt replacement run.
        if (run && run.generation === gen && run.abort === ac) {
          runsRef.current.delete(streamConvId);
          bumpRunBusy();
          if (conversationRef.current?.id === streamConvId) {
            setSending(false);
          }
        }
      } else if (
        conversationRef.current?.id === viewedId &&
        !(viewedId && runsRef.current.has(viewedId))
      ) {
        // No streamConvId yet (failed before register) and no superseding run.
        setSending(false);
      }
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const { input, pendingFiles } = chatState();
    await sendUserText(input, [...pendingFiles]);
  };


  const refreshMCP = useCallback(async () => {
    const list = await listMCPServers();
    setMcpServers(list);
  }, []);

  const refreshRoutines = useCallback(async () => {
    const list = await listRoutines();
    setRoutines(list);
    try {
      const hooks = await listInboundHooks();
      setInboundHooks(hooks);
    } catch {
      /* hooks optional */
    }
  }, []);

  const saveMCP = async (e: FormEvent) => {
    e.preventDefault();
    setMcpBusy(true);
    setMcpMsg("");
    try {
      let args: string[] = [];
      try {
        const parsed = JSON.parse(mcpArgsText || "[]");
        if (!Array.isArray(parsed)) throw new Error("args 须为 JSON 数组");
        args = parsed.map(String);
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : "args JSON 无效");
      }
      const body: MCPServerInput = {
        name: mcpForm.name,
        transport: mcpForm.transport,
        command: mcpForm.command || "",
        args,
        url: mcpForm.url || "",
        enabled: mcpForm.enabled !== false,
      };
      await createMCPServer(body);
      setMcpMsg("已创建");
      setMcpForm({
        name: "",
        transport: "stdio",
        command: "",
        args: [],
        url: "",
        enabled: true,
      });
      setMcpArgsText("[]");
      await refreshMCP();
    } catch (err) {
      setMcpMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const toggleMCP = async (s: MCPServer, enabled: boolean) => {
    setMcpBusy(true);
    setMcpMsg("");
    try {
      await updateMCPServer(s.id, { enabled });
      await refreshMCP();
    } catch (err) {
      setMcpMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const removeMCP = async (id: string) => {
    const ok = await confirm({
      title: "删除该 MCP server？",
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setMcpBusy(true);
    setMcpMsg("");
    try {
      await deleteMCPServer(id);
      await refreshMCP();
    } catch (err) {
      setMcpMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const runTestMCP = async (id: string) => {
    setMcpBusy(true);
    setMcpTestResult("");
    setMcpMsg("");
    try {
      const r = await testMCPServer(id);
      if (r.ok) {
        const names = r.tool_names || (r.tools || []).map((t) => t.name);
        setMcpTestResult(`连接成功 · 工具: ${names.join(", ") || "(无)"}`);
      } else {
        setMcpTestResult(`失败: ${r.error || "unknown"}`);
      }
    } catch (err) {
      setMcpTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const runCallMCP = async (e: FormEvent) => {
    e.preventDefault();
    setMcpBusy(true);
    setMcpCallResult("");
    try {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(mcpCallArgs || "{}") as Record<string, unknown>;
      } catch {
        throw new Error("arguments 须为 JSON 对象");
      }
      if (!mcpCallServerId) throw new Error("请选择 server");
      const r = await mcpCallTool({
        server_id: mcpCallServerId,
        tool: mcpCallToolName,
        arguments: args,
      });
      setMcpCallResult(
        r.error
          ? `错误: ${r.error}`
          : r.text || JSON.stringify(r, null, 2),
      );
    } catch (err) {
      setMcpCallResult(err instanceof Error ? err.message : String(err));
    } finally {
      setMcpBusy(false);
    }
  };


  const saveRoutine = async (e: FormEvent) => {
    e.preventDefault();
    setRoutinesBusy(true);
    setRoutinesMsg("");
    try {
      await createRoutine({
        name: routineForm.name.trim(),
        prompt: routineForm.prompt.trim(),
        schedule_cron: routineForm.schedule_cron.trim(),
        enabled: routineForm.enabled !== false,
        agent_id: routineForm.agent_id || agentId || undefined,
        timezone: routineForm.timezone || "Asia/Shanghai",
        triggers_json: routineForm.triggers_json || "[]",
        max_retries: routineForm.max_retries ?? 2,
        quiet_unchanged: !!routineForm.quiet_unchanged,
        conversation_id: conversation?.id || undefined,
      })
      setRoutineForm({
        name: "",
        prompt: "",
        schedule_cron: "0 9 * * *",
        enabled: true,
        agent_id: agentId || "",
        timezone: "Asia/Shanghai",
        triggers_json: "[]",
        max_retries: 2,
        quiet_unchanged: false,
      });
      await refreshRoutines();
      setRoutinesMsg("已创建");
    } catch (err) {
      setRoutinesMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRoutinesBusy(false);
    }
  };

  const toggleRoutine = async (r: Routine, enabled: boolean) => {
    setRoutinesBusy(true);
    setRoutinesMsg("");
    try {
      await updateRoutine(r.id, { enabled });
      await refreshRoutines();
    } catch (err) {
      setRoutinesMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRoutinesBusy(false);
    }
  };

  const removeRoutine = async (id: string) => {
    const ok = await confirm({
      title: "删除该例行任务？",
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setRoutinesBusy(true);
    setRoutinesMsg("");
    try {
      await deleteRoutine(id);
      await refreshRoutines();
    } catch (err) {
      setRoutinesMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRoutinesBusy(false);
    }
  };

  const runRoutineNow = async (id: string) => {
    setRoutinesBusy(true);
    setRoutinesMsg("运行中…");
    try {
      const res = await runRoutine(id);
      await refreshRoutines();
      setRoutinesMsg(`运行完成：${res.run.status}`);
    } catch (err) {
      setRoutinesMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRoutinesBusy(false);
    }
  };

  const refreshSandbox = useCallback(async () => {
    const s = await getSandbox();
    // stale error: 注册时镜像/依赖未就绪留下的错误，尝试一次自愈
    if (s.status === "error") {
      try {
        const fresh = await ensureSandbox({});
        setSandbox(fresh);
        setSandboxMsg("已自动重试启动运行环境");
        return;
      } catch {
        // 重试失败，保留原错误状态展示
      }
    }
    setSandbox(s);
  }, []);

  const refreshSecrets = useCallback(async () => {
    try {
      const [secs, reqs] = await Promise.all([listBotSecrets(), listBotSecretRequests()]);
      setBotSecrets(secs);
      setSecretRequests(reqs);
      if (reqs.length && !secretPrompt) setSecretPrompt(reqs[0]);
    } catch {
      /* soft-fail */
    }
  }, [secretPrompt]);
  useEffect(() => {
    if (!getToken()) return;
    void refreshSecrets();
    const id = window.setInterval(() => void refreshSecrets(), 8000);
    return () => window.clearInterval(id);
  }, [refreshSecrets]);


  const doCheckpointSandbox = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await checkpointSandbox();
      setSandbox(res.sandbox);
      setSandboxMsg(`已快照：${res.checkpoint_path}`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doEnsureSandbox = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const s = await ensureSandbox({
        agent_id: agentId || undefined,
        mode: activeAgent?.computer_mode || undefined,
      });
      setSandbox(s);
      setSandboxMsg(
        `已确保运行：${s.container_id || "(no id)"} · 模式 ${s.computer_mode || activeAgent?.computer_mode || "team"}`,
      );
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doOpenDesktop = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const s = await ensureSandbox({
        desktop: true,
        agent_id: agentId || undefined,
        mode: activeAgent?.computer_mode || undefined,
      });
      setSandbox(s);
      if (!s.desktop_port) {
        setSandboxMsg(
          s.last_error ||
            "桌面预览未就绪：请先构建桌面镜像（make sandbox-image-desktop）",
        );
        return;
      }
      const url = sandboxDesktopURL({ desktop_token: s.desktop_token });
      window.open(url, "openbot-sandbox-desktop", "noopener,noreferrer");
      setSandboxMsg(`桌面已打开（本地端口 ${s.desktop_port}，经 API JWT 反代）`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doStopSandbox = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const s = await stopSandbox();
      setSandbox(s);
      setSandboxMsg("已停止");
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doResetSandbox = async () => {
    const ok = await confirm({
      title: "重置将清空运行环境中的文件并重建，确认？",
      confirmLabel: "重置",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await resetSandbox();
      setSandbox(res.sandbox);
      setSandboxMsg(res.warning || "已重置");
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doExecSandbox = async (e: FormEvent) => {
    e.preventDefault();
    setSandboxBusy(true);
    setSandboxMsg("");
    setSandboxExecOut("");
    try {
      const res = await execSandbox({ cmd: sandboxCmd });
      setSandboxExecOut(
        `exit=${res.exit_code}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
      );
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doLsSandbox = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await listSandbox(sandboxPath || ".");
      const lines = (res.entries || []).map(
        (e) => `${e.is_dir ? "d" : "f"}\t${e.name}\t${e.size}`,
      );
      setSandboxLsOut(lines.join("\n") || "(empty)");
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doWriteSandboxFile = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      await writeSandboxFile(sandboxFilePath, sandboxFileContent);
      setSandboxMsg(`已写入 ${sandboxFilePath}`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const doReadSandboxFile = async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await readSandboxFile(sandboxFilePath);
      setSandboxFileContent(res.content);
      setSandboxMsg(`已读取 ${res.path}`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const startChatWithAgent = async (agent: Agent) => {
    setShowNewChat(false);
    onSelectAgent(agent.id);
  };

  const createBotFromPopover = async (input: CreateBotInput) => {
    const created = await createAgent({
      name: input.name,
      description: input.description,
      system_prompt: input.system_prompt,
      avatar_shape: input.avatar_shape,
      avatar_color: input.avatar_color,
      ...(input.machine_id ? { machine_id: input.machine_id } : {}),
    });
    await refreshAgents();
    setShowNewChat(false);
    setMobileView("chat");
    // Navigate away without cancelling other bots' in-flight runs.
    snapshotViewedMessages();
    selectGenRef.current += 1;
    setAgentId(created.id);
    setPendingFiles([]);
    setSending(false);
    setRunLabel("正在思考…");
    setStatus("");
    toast.success(`已创建 Bot「${created.name}」`);
    try {
      const conv = await openPrimaryConversation(created.id);
      chatScrollRef.stickToBottom = true;
      conversationRef.current = conv;
      setConversation(conv);
      messagesByConvRef.current.set(conv.id, []);
      setMessages([]);
      setOnboardingDismissedState(false);
      saveLastActiveSelection({ kind: "agent", id: created.id });
      await refreshConversations();
      await refreshAgents();
    } catch (err) {
      conversationRef.current = null;
      setConversation(null);
      setMessages([]);
      setOnboardingDismissedState(false);
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const createGroupFromPopover = async (name: string, memberIds: string[]) => {
    const ch = await createChannel(name, memberIds);
    await refreshChannels();
    setShowNewChat(false);
    toast.success(`已创建群聊「${ch.name}」（${memberIds.length} 名成员）`);
    // Open linked conversation immediately (no longer flash-only).
    await openChannelChat(ch.id);
    await refreshConversations();
  };

  // layout-narrow: sync with CSS max-width 860px. Keep mobileView across wide↔narrow so the same pane returns.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(LAYOUT_NARROW_MQ);
    const sync = () => setIsNarrowLayout(mq.matches);
    sync();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  // Keep latest select handlers in refs so the restore effect only re-runs on auth,
  // not when `agents` identity changes (which would cancel mid-restore and flash UI).
  const onSelectAgentRef = useRef(onSelectAgent);
  onSelectAgentRef.current = onSelectAgent;
  const openChannelChatRef = useRef(openChannelChat);
  openChannelChatRef.current = openChannelChat;

  useEffect(() => {
    if (!authed || !user?.id) {
      didRestoreLastActive.current = null;
      setSelectionHydrated(false);
      return;
    }
    if (didRestoreLastActive.current === user.id) return;

    let cancelled = false;
    const restoreLastActive = async () => {
      try {
        const [agentList, channelList] = await Promise.all([refreshAgents(), refreshChannels()]);
        if (cancelled) return;

        // User already opened something (click / prior in-flight select).
        if (conversationRef.current) {
          didRestoreLastActive.current = user.id;
          setSelectionHydrated(true);
          setMobileView("chat");
          return;
        }

        const saved = readLastActiveSelection(user.id);
        if (saved?.kind === "agent" && agentList.some((agent) => agent.id === saved.id)) {
          await onSelectAgentRef.current(saved.id);
        } else if (saved?.kind === "channel" && channelList.some((channel) => channel.id === saved.id)) {
          await openChannelChatRef.current(saved.id);
        } else {
          const datedAgents = agentList
            .filter((agent) => agent.conversation_updated_at)
            .sort(
              (a, b) =>
                (Date.parse(b.conversation_updated_at || "") || 0) -
                (Date.parse(a.conversation_updated_at || "") || 0),
            );
          const fallback = datedAgents[0] ?? agentList[0];
          if (fallback) await onSelectAgentRef.current(fallback.id);
        }

        if (cancelled) return;
        didRestoreLastActive.current = user.id;
        setSelectionHydrated(true);
        // Selecting a bot/channel already sets chat; if restore opened a conversation, stay on chat.
        if (conversationRef.current) setMobileView("chat");
      } catch {
        if (!cancelled) {
          didRestoreLastActive.current = user.id;
          setSelectionHydrated(true);
          setStatus("无法拉取助手或群聊列表（请确认已登录且 API 可用）");
        }
      }
    };

    void restoreLastActive();
    void refreshLLMs().catch(() => setStatus("无法拉取 LLM 连接列表"));
    return () => {
      cancelled = true;
    };
  }, [authed, user?.id, refreshAgents, refreshChannels, refreshLLMs]);

  const settingsRefreshApi = useMemo<SettingsRefreshApi>(
    () => ({
      refreshLLMs,
      refreshAgents,
      refreshSkills,
      refreshCompact,
      refreshMCP,
      refreshRoutines,
      refreshSandbox,
      refreshMachines,
      refreshSecrets,
      refreshToolAllowlist,
    }),
    [
      refreshLLMs,
      refreshAgents,
      refreshSkills,
      refreshCompact,
      refreshMCP,
      refreshRoutines,
      refreshSandbox,
      refreshMachines,
      refreshSecrets,
    ],
  );

  const settingsRefreshErrors = useMemo(
    () => ({
      onLLMError: setLLMMsg,
      onSkillsError: setSkillsMsg,
      onMcpError: setMcpMsg,
      onRoutinesError: setRoutinesMsg,
      onSandboxError: setSandboxMsg,
      onMachinesError: setMachinesMsg,
    }),
    [],
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
      setShowSettings(true);
      setSettingsShellHub(Boolean(sheetForm && tab === "general"));
      if (tab === "general") setSettingsGeneralPane("account");
      setSettingsTab(tab);
      setLLMMsg("");
      setSkillsMsg("");
      setMcpMsg("");
      setMcpTestResult("");
      setRoutinesMsg("");
      setSandboxMsg("");
      prefetchSettingsTab(tab);
    },
    [sheetForm, prefetchSettingsTab],
  );

  const startEdit = (c: LLMConnection) => {
    setEditingId(c.id);
    setLLMForm({
      name: c.name,
      base_url: c.base_url,
      api_key: "",
      model: c.model,
      enable_tools: c.enable_tools,
      is_default: c.is_default,
      context_window: c.context_window ?? null,
    });
    setLLMMsg(c.api_key_set ? `已保存密钥 ${c.api_key_hint || ""}（留空则不修改）` : "");
  };

  const resetForm = () => {
    setEditingId(null);
    setLLMForm({ ...emptyLLMForm, is_default: llms.length === 0 });
    setLLMMsg("");
    setLLMModelOptions([]);
    setLLMModelsError("");
    setLLMCacheProbeMsg("");
  };

  const saveLLM = async (e: FormEvent) => {
    e.preventDefault();
    setLLMBusy(true);
    setLLMMsg("");
    try {
      if (llmForm.enable_tools) {
        const probe = await probeLLMTools({
          base_url: llmForm.base_url,
          model: llmForm.model,
          api_key: llmForm.api_key?.trim() || undefined,
          connection_id: editingId || undefined,
        });
        if (!probe.can_enable_tools) {
          setLLMMsg(formatLLMToolsProbe(probe));
          setLLMBusy(false);
          return;
        }
        if (probe.mode !== "native") {
          setLLMMsg(formatLLMToolsProbe(probe));
        }
      }
      if (editingId) {
        const patch: Partial<LLMInput> = {
          name: llmForm.name,
          base_url: llmForm.base_url,
          model: llmForm.model,
          enable_tools: llmForm.enable_tools,
          is_default: llmForm.is_default,
          context_window:
            llmForm.context_window && llmForm.context_window > 0
              ? llmForm.context_window
              : null,
        };
        if (llmForm.api_key && llmForm.api_key.trim()) {
          patch.api_key = llmForm.api_key.trim();
        }
        await updateLLMConnection(editingId, patch);
        setLLMMsg((prev) => (prev ? `${prev} · 已更新` : "已更新"));
      } else {
        await createLLMConnection({
          ...llmForm,
          context_window:
            llmForm.context_window && llmForm.context_window > 0
              ? llmForm.context_window
              : null,
        });
        setLLMMsg((prev) => (prev ? `${prev} · 已创建` : "已创建"));
      }
      await refreshLLMs();
      resetForm();
    } catch (err) {
      setLLMMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLLMBusy(false);
    }
  };

  const probeLLMFormTools = async () => {
    setLLMBusy(true);
    setLLMMsg("正在检测 tools / function calling…");
    try {
      const probe = await probeLLMTools({
        base_url: llmForm.base_url,
        model: llmForm.model,
        api_key: llmForm.api_key?.trim() || undefined,
        connection_id: editingId || undefined,
      });
      setLLMMsg(formatLLMToolsProbe(probe));
      if (!probe.can_enable_tools && llmForm.enable_tools) {
        setLLMForm({ ...llmForm, enable_tools: false });
      }
    } catch (err) {
      setLLMMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLLMBusy(false);
    }
  };

  // Auto-fetch OpenAI-compatible model list when base URL + key (or saved connection key) ready.
  useEffect(() => {
    const base = llmForm.base_url.trim();
    const key = (llmForm.api_key || "").trim();
    const editing = llms.find((c) => c.id === editingId);
    const canReuseSaved = Boolean(editingId && editing?.api_key_set);
    if (!base || (!key && !canReuseSaved)) {
      setLLMModelOptions([]);
      setLLMModelsError("");
      setLLMModelsLoading(false);
      return;
    }
    const seq = ++llmModelsReqSeq.current;
    const timer = window.setTimeout(() => {
      setLLMModelsLoading(true);
      setLLMModelsError("");
      void listLLMModels({
        base_url: base,
        ...(key ? { api_key: key } : {}),
        ...(editingId ? { connection_id: editingId } : {}),
      })
        .then((res) => {
          if (seq !== llmModelsReqSeq.current) return;
          if (!res.ok) {
            setLLMModelOptions([]);
            setLLMModelsError(res.detail || res.error || "拉取模型列表失败");
            return;
          }
          setLLMModelOptions(res.models || []);
          setLLMModelsError("");
        })
        .catch((err) => {
          if (seq !== llmModelsReqSeq.current) return;
          setLLMModelOptions([]);
          setLLMModelsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === llmModelsReqSeq.current) setLLMModelsLoading(false);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [llmForm.base_url, llmForm.api_key, editingId, llms]);

  // Auto-detect prompt-cache support when endpoint + key + model are ready.
  useEffect(() => {
    const base = llmForm.base_url.trim();
    const key = (llmForm.api_key || "").trim();
    const model = llmForm.model.trim();
    const editing = llms.find((c) => c.id === editingId);
    const canReuseSaved = Boolean(editingId && editing?.api_key_set);
    if (!base || !model || (!key && !canReuseSaved)) {
      setLLMCacheProbeMsg("");
      setLLMCacheProbing(false);
      return;
    }
    const seq = ++llmCacheReqSeq.current;
    const timer = window.setTimeout(() => {
      setLLMCacheProbing(true);
      void probeLLMPromptCache({
        base_url: base,
        model,
        ...(key ? { api_key: key } : {}),
        ...(editingId ? { connection_id: editingId } : {}),
      })
        .then((res) => {
          if (seq !== llmCacheReqSeq.current) return;
          setLLMCacheProbeMsg(formatLLMPromptCacheProbe(res));
        })
        .catch((err) => {
          if (seq !== llmCacheReqSeq.current) return;
          setLLMCacheProbeMsg(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === llmCacheReqSeq.current) setLLMCacheProbing(false);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [llmForm.base_url, llmForm.api_key, llmForm.model, editingId, llms]);


  const CONV_LONG_PRESS_MS = 400;
  const CONV_MOVE_CANCEL_PX = 10;

  const beginConvLongPress = (
    e: ReactPointerEvent,
    target: { kind: "agent"; agent: Agent } | { kind: "channel"; channel: Channel },
  ) => {
    if (!touchUi) return;
    if (e.pointerType === "mouse") return;
    convLongPressStart.current = { x: e.clientX, y: e.clientY };
    convLongPressFired.current = false;
    clearConvLongPress();
    convLongPressTimer.current = window.setTimeout(() => {
      convLongPressTimer.current = null;
      convLongPressFired.current = true;
      setConvSheet(target);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* ignore */
      }
    }, CONV_LONG_PRESS_MS);
  };

  const moveConvLongPress = (e: ReactPointerEvent) => {
    if (!convLongPressStart.current || convLongPressTimer.current == null) return;
    const dx = Math.abs(e.clientX - convLongPressStart.current.x);
    const dy = Math.abs(e.clientY - convLongPressStart.current.y);
    if (dx + dy > CONV_MOVE_CANCEL_PX) clearConvLongPress();
  };

  const endConvLongPress = () => {
    clearConvLongPress();
    convLongPressStart.current = null;
    if (convLongPressFired.current) {
      convLongPressFired.current = false;
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 500);
    }
  };

  const removeAgent = async (a: Agent, e?: MouseEvent) => {
    e?.stopPropagation();
    const ok = await confirm({
      title: "确定删除该会话？",
      description: `「${a.name}」删除后无法找回`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setAgentBusy(true);
    try {
      await deleteAgent(a.id);
      const list = await listAgents();
      setAgents(list);
      seedOnlineFromAgents(list);
      await refreshConversations().catch(() => {});
      // Cancel any in-flight runs owned by this agent (viewed or background).
      const agentKey = `agent:${a.id}`;
      for (const [convId, run] of [...runsRef.current.entries()]) {
        if (run.selectionKey === agentKey) {
          await stopCurrentRun({ markStopped: true, conversationId: convId });
        }
      }
      if (agentId === a.id) {
        setAgentId(list[0]?.id ?? "");
        conversationRef.current = null;
        setConversation(null);
        setMessages([]);
        setSending(false);
        setStatus("");
      } else if (conversation?.agent_id === a.id && !conversation?.channel_id) {
        conversationRef.current = null;
        setConversation(null);
        setMessages([]);
        setSending(false);
        setStatus("");
      }
      toast.success(`已删除助手「${a.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentBusy(false);
    }
  };


  const removeChannel = async (ch: Channel, e?: MouseEvent) => {
    e?.stopPropagation();
    const ok = await confirm({
      title: "确定删除该会话？",
      description: `「${ch.name}」删除后无法找回`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setChannelBusy(true);
    try {
      await deleteChannel(ch.id);
      await refreshChannels();
      const channelKey = `channel:${ch.id}`;
      for (const [convId, run] of [...runsRef.current.entries()]) {
        if (run.selectionKey === channelKey || (ch.conversation_id && convId === ch.conversation_id)) {
          await stopCurrentRun({ markStopped: true, conversationId: convId });
        }
      }
      if (conversation?.channel_id === ch.id || conversation?.id === ch.conversation_id) {
        conversationRef.current = null;
        setConversation(null);
        setMessages([]);
        setSending(false);
        setStatus("");
      }
      toast.success(`已删除群聊「${ch.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setChannelBusy(false);
    }
  };


  const onUploadSkill = async (e: FormEvent) => {
    e.preventDefault();
    setSkillsBusy(true);
    setSkillsMsg("");
    try {
      let result;
      if (skillZip) {
        result = await uploadSkillPackage({
          name: skillName.trim() || undefined,
          description: skillDesc.trim() || undefined,
          archive: skillZip,
        });
      } else if (skillFolder.length > 0) {
        result = await uploadSkillPackage({
          name: skillName.trim() || undefined,
          description: skillDesc.trim() || undefined,
          folderFiles: skillFolder,
        });
      } else {
        result = await uploadSkill({
          name: skillName.trim(),
          description: skillDesc.trim(),
          body_markdown: skillBody,
        });
      }
      setSkillName("");
      setSkillDesc("");
      setSkillBody("");
      setSkillZip(null);
      setSkillFolder([]);
      if (skillFolderInputRef.current) skillFolderInputRef.current.value = "";
      if (skillZipInputRef.current) skillZipInputRef.current.value = "";
      await refreshSkills();
      const n = result.file_count ?? result.files?.length ?? 1;
      setSkillsMsg(`技能「${result.name}」已上传并启用（${n} 个文件）`);
    } catch (err) {
      setSkillsMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSkillsBusy(false);
    }
  };

  const onDeleteSkill = async (name: string) => {
    const ok = await confirm({
      title: `删除自定义技能「${name}」？`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setSkillsBusy(true);
    setSkillsMsg("");
    try {
      await deleteSkill(name);
      await refreshSkills();
      setSkillsMsg("已删除");
    } catch (err) {
      setSkillsMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSkillsBusy(false);
    }
  };

  const toggleSkill = async (name: string, enabled: boolean) => {
    setSkillsBusy(true);
    setSkillsMsg("");
    try {
      await setSkillEnabled(name, enabled);
      await refreshSkills();
    } catch (err) {
      setSkillsMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSkillsBusy(false);
    }
  };

  const onOpenSettingsGeneral = useCallback(() => void openSettings("general"), [openSettings]);
  const onOpenSettingsLlm = useCallback(() => void openSettings("llm"), [openSettings]);

  const onToggleCreateSheet = useCallback(() => {
    if (showNewChat) {
      setShowNewChat(false);
      return;
    }
    setCreateSheetOpen((v) => !v);
  }, [showNewChat]);

  const onOpenNewChatList = useCallback(() => {
    setNewChatInitialMode("list");
    setShowNewChat((v) => !v);
  }, []);

  const onSelectAgentSync = useCallback((id: string) => void onSelectAgent(id), [onSelectAgent]);
  const onOpenChannelChatSync = useCallback((id: string) => void openChannelChat(id), [openChannelChat]);
  const onRemoveAgentSync = useCallback(
    (a: Agent, e?: MouseEvent) => void removeAgent(a, e),
    [removeAgent],
  );
  const onRemoveChannelSync = useCallback(
    (ch: Channel, e?: MouseEvent) => void removeChannel(ch, e),
    [removeChannel],
  );
  const onOpenBotSettingsFromSidebar = useCallback(
    (id: string) => {
      void onSelectAgent(id);
      void openSettings("bot");
    },
    [onSelectAgent, openSettings],
  );

  const runSystemBackSync = useCallback(() => void runSystemBack(), [runSystemBack]);

  const onOnboardingSelect = useCallback(
    (opt: OnboardingOption) => {
      void (async () => {
        try {
          if (agentId) {
            await applyAgentOnboarding(agentId, { focus: opt.letter });
            await refreshAgents();
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
        void sendUserText(opt.prompt);
      })();
    },
    [agentId, refreshAgents, sendUserText],
  );

  const onOnboardingCustom = useCallback(
    (customText: string) => {
      void (async () => {
        try {
          if (agentId) {
            await applyAgentOnboarding(agentId, {
              focus: "E",
              description: customText.slice(0, 400),
              system_prompt: `用户自定义方向：${customText}`,
            });
            await refreshAgents();
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
        void sendUserText(customText);
      })();
    },
    [agentId, refreshAgents, sendUserText],
  );

  const onOnboardingDismiss = useCallback(() => {
    setOnboardingDismissed(onboardingKey);
    setOnboardingDismissedState(true);
  }, [onboardingKey]);

  const onApprovalDeny = useCallback(() => {
    const gate = chatState().approvalGate;
    if (!gate) return;
    void approveConversationRun(gate.conversationId, gate.requestId, false, "user_rejected", {
      decision: "deny",
    })
      .then(() => setApprovalGate(null))
      .catch((err) => setStatus(`拒绝失败：${err instanceof Error ? err.message : String(err)}`));
  }, []);

  const onApprovalAllow = useCallback(() => {
    const gate = chatState().approvalGate;
    if (!gate) return;
    void approveConversationRun(gate.conversationId, gate.requestId, true, "", { decision: "allow_once" })
      .then(() => {
        setApprovalGate(null);
        setRunLabel("正在继续…");
      })
      .catch((err) => setStatus(`批准失败：${err instanceof Error ? err.message : String(err)}`));
  }, []);

  if (!authed) {
    return (
      <AuthPage
        authMode={authMode}
        authUser={authUser}
        authPass={authPass}
        authError={authError}
        authBusy={authBusy}
        oidcEnabled={oidcEnabled}
        onAuthModeChange={setAuthMode}
        onAuthUserChange={setAuthUser}
        onAuthPassChange={setAuthPass}
        onSubmit={onAuth}
        onCasdoorLogin={() => void onCasdoorLogin()}
      />
    );
  }

  return (
    <div className={`app${isNarrowLayout ? ` mobile-${mobileView}` : ""}${sheetForm ? " shell-narrow" : ""}`}>
      <AppSidebar
        sheetForm={sheetForm}
        user={user}
        hostActivity={hostActivity}
        newChatBtnRef={newChatBtnRef}
        createSheetOpen={createSheetOpen}
        showNewChat={showNewChat}
        onToggleCreateSheet={onToggleCreateSheet}
        onOpenNewChatList={onOpenNewChatList}
        onOpenSettingsGeneral={onOpenSettingsGeneral}
        onOpenSettingsLlm={onOpenSettingsLlm}
        activeAgent={activeAgent}
        agents={agents}
        agentId={agentId}
        conversation={conversation}
        onOpenAvatarSettings={openAvatarSettings}
        assistantsCollapsed={assistantsCollapsed}
        groupsCollapsed={groupsCollapsed}
        onToggleAssistantsCollapsed={toggleAssistantsCollapsed}
        onToggleGroupsCollapsed={toggleGroupsCollapsed}
        channels={channels}
        busySelectionKeys={busySelectionKeys}
        onSelectAgent={onSelectAgentSync}
        agentBusy={agentBusy}
        channelBusy={channelBusy}
        touchUi={touchUi}
        onBeginConvLongPress={beginConvLongPress}
        onMoveConvLongPress={moveConvLongPress}
        onEndConvLongPress={endConvLongPress}
        onOpenBotSettings={onOpenBotSettingsFromSidebar}
        onCloneAgent={setCloneTarget}
        onRemoveAgent={onRemoveAgentSync}
        channelMemberProfiles={channelMemberProfiles}
        agentNameById={agentNameById}
        onOpenChannelChat={onOpenChannelChatSync}
        onRemoveChannel={onRemoveChannelSync}
        defaultLLM={defaultLLM}
        onLogout={onLogout}
      />

      <CreateActionSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreateBot={() => {
          setCreateSheetOpen(false);
          setNewChatInitialMode("bot");
          setShowNewChat(true);
        }}
        onCreateGroup={() => {
          setCreateSheetOpen(false);
          setNewChatInitialMode("group");
          setShowNewChat(true);
        }}
      />

      <NewChatPopover
        open={showNewChat}
        agents={agents}
        anchorRef={newChatBtnRef}
        initialMode={newChatInitialMode}
        onClose={() => {
          setShowNewChat(false);
          setNewChatInitialMode("list");
        }}
        onSelectAgent={(a) => void startChatWithAgent(a)}
        onCreateBot={(input) => createBotFromPopover(input)}
        onCreateGroup={(name, ids) => createGroupFromPopover(name, ids)}
      />

      <ConvActionSheet
        open={Boolean(convSheet)}
        title={
          convSheet?.kind === "agent"
            ? convSheet.agent.name
            : convSheet?.kind === "channel"
              ? convSheet.channel.name
              : undefined
        }
        onClose={() => setConvSheet(null)}
        onSettings={
          convSheet?.kind === "agent"
            ? () => {
                const agent = convSheet.agent;
                setConvSheet(null);
                void onSelectAgent(agent.id);
                void openSettings("bot");
              }
            : undefined
        }
        onGroupSettings={
          convSheet?.kind === "channel"
            ? () => {
                const ch = convSheet.channel;
                setConvSheet(null);
                setGroupMembersChannel(ch);
              }
            : undefined
        }
        onClone={
          convSheet?.kind === "agent"
            ? () => {
                const agent = convSheet.agent;
                setConvSheet(null);
                setCloneTarget(agent);
              }
            : undefined
        }
        onDelete={() => {
          const target = convSheet;
          setConvSheet(null);
          if (!target) return;
          if (target.kind === "agent") void removeAgent(target.agent);
          else void removeChannel(target.channel);
        }}
      />

      <ChatMain
        hostActivity={hostActivity}
        onSystemBack={runSystemBackSync}
        activeChannel={activeChannel}
        selectionHydrated={selectionHydrated}
        activeAgent={activeAgent}
        agentId={agentId}
        conversation={conversation}
        channelMemberProfiles={channelMemberProfiles}
        agentNameById={agentNameById}
        onOpenGroupSettings={setGroupMembersChannel}
        onOpenAvatarSettings={openAvatarSettings}
        onOpenTrain={setTrainAgent}
        onboardingDismissed={onboardingDismissed}
        agents={agents}
        onOnboardingSelect={onOnboardingSelect}
        onOnboardingCustom={onOnboardingCustom}
        onOnboardingDismiss={onOnboardingDismiss}
        settleHostConfirm={settleHostConfirm}
        hostExecPolicy={hostExecPolicy}
        setOpenThreadRootId={setOpenThreadRootId}
        onToggleReaction={onToggleReaction}
        openFeedbackForMessage={openFeedbackForMessage}
        viewingRunActive={viewingRunActive}
        onApprovalDeny={onApprovalDeny}
        onApprovalAllow={onApprovalAllow}
        onSubmit={onSubmit}
        stopCurrentRun={stopCurrentRun}
        composerMentionItems={composerMentionItems}
        composerSkills={composerSkills}
      />

      {showSettings && (
        <div
          className={`modal-backdrop${sheetForm ? " settings-backdrop-shell" : ""}`}
          onClick={() => setShowSettings(false)}
        >
          <div
            className={`modal settings-dialog${sheetForm ? " settings-dialog-shell" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            {sheetForm && settingsShellHub ? (
              <MobileSettingsHub
                username={user?.username || "账户"}
                email={user?.email}
                accountInitials={accountInitials(user?.username || "")}
                focusBot={activeAgent || agents[0] || null}
                preferredMachineLabel={(() => {
                  const focus = activeAgent || agents[0];
                  const mid = focus?.machine_id;
                  if (!mid) return undefined;
                  const m = machines.find((x) => x.id === mid);
                  return m?.label || mid;
                })()}
                apiBaseLabel={(() => {
                  const raw = getApiBase().replace(/^https?:\/\//i, "");
                  return raw.length > 28 ? `${raw.slice(0, 27)}…` : raw;
                })()}
                onClose={() => setShowSettings(false)}
                onOpenBotAvatar={() => {
                  const focus = activeAgent || agents[0];
                  if (focus) {
                    setShowSettings(false);
                    openAvatarSettings(focus);
                  } else {
                    setSettingsShellHub(false);
                    setSettingsTab("bot");
                  }
                }}
                onLogout={() => {
                  setShowSettings(false);
                  onLogout();
                }}
                onNavigate={(tab: SettingsHubNav) => {
                  if (tab === "account") {
                    setSettingsGeneralPane("account");
                    setSettingsTab("general");
                  } else if (tab === "server") {
                    setSettingsGeneralPane("server");
                    setSettingsTab("general");
                  } else if (tab === "review") {
                    setSettingsTab("review");
                  } else if (tab === "general") {
                    setSettingsGeneralPane("review");
                    setSettingsTab("general");
                  } else {
                    setSettingsTab(tab);
                  }
                  setSettingsShellHub(false);
                  if (tab === "account" || tab === "server") {
                    prefetchSettingsTab("general");
                  } else if (tab !== "general") {
                    prefetchSettingsTab(tab);
                  } else {
                    prefetchSettingsTab("general");
                  }
                }}
              />
            ) : null}
            {sheetForm && !settingsShellHub ? (
              <div className="settings-shell-subhead">
                <button
                  type="button"
                  className="settings-shell-back"
                  aria-label="返回"
                  onClick={() => {
                    void runSystemBack();
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <h2>
                  {settingsTab === "general"
                    ? settingsGeneralPane === "account"
                      ? "账户"
                      : settingsGeneralPane === "server"
                        ? "服务器"
                        : "时区与自动审核"
                    : SETTINGS_TITLE[settingsTab]}
                </h2>
                <button
                  type="button"
                  className="settings-close"
                  aria-label="关闭"
                  onClick={() => setShowSettings(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
            ) : null}
            {!(sheetForm && settingsShellHub) ? (
            <>
            <nav className={`settings-nav${sheetForm ? " settings-nav-hidden" : ""}`} aria-label="设置分类">
              {(
                [
                  ["general", "通用"],
                  ["review", "审核"],
                  ["bot", "当前 Bot"],
                  ["machines", "电脑"],
                  ["sandbox", "运行环境"],
                  ["llm", "模型"],
                  ["skills", "Skills"],
                  ["mcp", "插件 / MCP"],
                  ["compact", "压缩"],
                  ["routines", "例行任务"],
                  ["secrets", "密钥"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={settingsTab === id ? "active" : ""}
                  onClick={() => selectSettingsTab(id)}
                >
                  <SettingsGlyph id={id} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            <div className="settings-main">
              {!sheetForm ? (
              <div className="settings-main-head">
                <h2>{SETTINGS_TITLE[settingsTab]}</h2>
                <button
                  type="button"
                  className="settings-close"
                  aria-label="关闭"
                  onClick={() => setShowSettings(false)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              ) : null}
              <div className="settings-main-body">
            {settingsTab === "general" && (
              <SettingsPage>
                {(!sheetForm || settingsGeneralPane === "account") && (
                  <SettingsSection title={sheetForm ? undefined : "账户"}>
                    <SettingsCard className="settings-account">
                      <div className="settings-account-avatar" aria-hidden>
                        {accountInitials(user?.username || "")}
                      </div>
                      <div className="settings-account-main">
                        <div className="settings-account-name">{user?.username || "账户"}</div>
                        {user?.email ? (
                          <div className="settings-account-email">
                            <span>{user.email}</span>
                            <button
                              type="button"
                              className="settings-icon-btn"
                              title={emailCopied ? "已复制" : "复制邮箱"}
                              aria-label="复制邮箱"
                              onClick={() => {
                                void navigator.clipboard.writeText(user.email || "").then(() => {
                                  setEmailCopied(true);
                                  window.setTimeout(() => setEmailCopied(false), 1200);
                                });
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                                <rect x="8" y="8" width="12" height="12" rx="2" />
                                <path d="M4 16V6a2 2 0 0 1 2-2h10" />
                              </svg>
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" className="settings-pill" onClick={onLogout}>
                        退出登录
                      </button>
                    </SettingsCard>
                  </SettingsSection>
                )}
                {(!sheetForm || settingsGeneralPane === "account" || settingsGeneralPane === "server") && (
                  <SettingsSection title={sheetForm ? undefined : "服务器"}>
                    <SettingsCard className="settings-card-padded">
                      <ApiServerField
                        variant="settings"
                        onApplied={() => {
                          setStatus("已切换服务器地址");
                        }}
                      />
                    </SettingsCard>
                  </SettingsSection>
                )}
                {!sheetForm ? (
                  <SettingsSection title="模型">
                    <SettingsCard>
                      <div className="settings-row">
                        <span>默认模型</span>
                        <button type="button" className="settings-pill" onClick={() => setSettingsTab("llm")}>
                          {defaultLLM?.model || defaultLLM?.name || "未配置"}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </SettingsCard>
                  </SettingsSection>
                ) : null}
                {(!sheetForm || settingsGeneralPane === "review") && (
                  <>
                    {sheetForm ? (
                      <SettingsHint>
                        时区用于报告与例行任务；自动审核在执行本机操作前检查规则，必要时询问你。
                      </SettingsHint>
                    ) : null}
                    <GeneralBotSettings
                      sectionTitle={sheetForm ? undefined : "时区与自动审核"}
                      onSettingsChange={(s) => {
                        setHostExecUserSettings(s);
                      }}
                    />
                  </>
                )}
              </SettingsPage>
            )}

            {settingsTab === "review" && (
              <SettingsPage>
                <SettingsSection title="始终允许">
                  <SettingsHint>
                    这里是你点过「始终允许」的操作。撤销后，同类操作会再次请求确认。
                  </SettingsHint>
                  <SettingsCard>
                    {toolAllowEntries.length === 0 ? (
                      <SettingsEmpty>{REVIEW_EMPTY_COPY}</SettingsEmpty>
                    ) : (
                      <ul className="review-allow-list" aria-label="始终允许的操作">
                        {toolAllowEntries.map((entry) => (
                          <li key={entry.family} className="review-allow-row">
                            <div className="review-allow-main">
                              <span className="review-allow-name">{entry.label}</span>
                              {entry.tool ? (
                                <span className="review-allow-sub">{entry.tool}</span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="settings-pill review-allow-revoke"
                              disabled={toolAllowBusy}
                              onClick={() => {
                                void (async () => {
                                  setToolAllowBusy(true);
                                  try {
                                    const serverOk = await revokeToolAllowlistEntry({
                                      tool_group: entry.family,
                                    });
                                    if (serverOk) setToolAllowServerOk(true);
                                    const uid = user?.id || "";
                                    setToolAllowEntries(revokeToolFamilyAlwaysAllow(uid, entry.family));
                                    toast.message("已撤销，下次将再次询问");
                                  } finally {
                                    setToolAllowBusy(false);
                                  }
                                })();
                              }}
                            >
                              撤销
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </SettingsCard>
                  {!toolAllowServerOk ? (
                    <SettingsHint>
                      列表暂存在本机；服务端 allowlist API 就绪后将自动同步。
                    </SettingsHint>
                  ) : null}
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "bot" && (
              <BotSettingsPanel
                agent={activeAgent ?? null}
                onClone={(a) => setCloneTarget(a)}
                onOpenAvatar={(a) => {
                  setShowSettings(false);
                  openAvatarSettings(a);
                }}
                onSaved={(a) => {
                  void refreshAgents().then(() => {
                    toast.success(`已更新「${a.name}」`);
                  });
                }}
              />
            )}

            {settingsTab === "llm" && (
              <SettingsPage>
                <SettingsHint>
                  可配置多个 OpenAI 兼容连接；聊天默认使用标记为「默认」的连接。密钥不会完整回显。
                  勾选「启用 tools」前可用「检测 tools 能力」验证上游是否支持 function calling；不支持时无法开启。
                  选定模型后会自动检测该端点是否支持 prompt cache（与运行时 OPENBOT_PROMPT_CACHE 一致）。
                </SettingsHint>
                <SettingsSection title="已有连接">
                  <SettingsCard>
                    <div className="llm-list">
                      {llms.length === 0 ? (
                        <SettingsEmpty>暂无连接，请在下方新增。</SettingsEmpty>
                      ) : (
                        llms.map((c) => (
                          <div key={c.id} className={`llm-item ${c.is_default ? "default" : ""}`}>
                            <div>
                              <div className="agent-name">
                                {c.name}
                                {c.is_default ? <span className="tag">默认</span> : null}
                              </div>
                              <div className="agent-desc">
                                {c.model || "(无 model)"} · {c.base_url || "(无 base_url)"} · key{" "}
                                {c.api_key_set ? c.api_key_hint || "已设置" : "未设置"}
                                {c.enable_tools ? " · tools" : ""}
                              </div>
                            </div>
                            <div className="llm-actions">
                              {!c.is_default ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void setDefaultLLMConnection(c.id)
                                      .then(refreshLLMs)
                                      .catch((err) => setLLMMsg(String(err)))
                                  }
                                >
                                  设默认
                                </button>
                              ) : null}
                              <button type="button" onClick={() => startEdit(c)}>
                                编辑
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() =>
                                  void deleteLLMConnection(c.id)
                                    .then(refreshLLMs)
                                    .then(resetForm)
                                    .catch((err) => setLLMMsg(String(err)))
                                }
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title={editingId ? "编辑连接" : "新增连接"}>
                  <SettingsCard padded>
                    <form className="llm-form" onSubmit={saveLLM}>
                      <label>
                        名称
                        <input
                          value={llmForm.name}
                          onChange={(e) => setLLMForm({ ...llmForm, name: e.target.value })}
                          required
                        />
                      </label>
                      <label>
                        Base URL
                        <input
                          value={llmForm.base_url}
                          onChange={(e) => setLLMForm({ ...llmForm, base_url: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                        />
                      </label>
                      <label>
                        API Key{editingId ? "（留空不改）" : ""}
                        <input
                          type="password"
                          value={llmForm.api_key || ""}
                          onChange={(e) => setLLMForm({ ...llmForm, api_key: e.target.value })}
                          placeholder="sk-..."
                          autoComplete="off"
                        />
                      </label>
                      <label>
                        Model
                        <input
                          list="llm-model-options"
                          value={llmForm.model}
                          onChange={(e) => setLLMForm({ ...llmForm, model: e.target.value })}
                          placeholder={llmModelsLoading ? "加载模型列表…" : "gpt-4o-mini"}
                          autoComplete="off"
                        />
                        <datalist id="llm-model-options">
                          {llmModelOptions.map((id) => (
                            <option key={id} value={id} />
                          ))}
                        </datalist>
                        {llmModelsLoading ? (
                          <span className="settings-status">正在拉取模型列表…</span>
                        ) : llmModelsError ? (
                          <span className="settings-status">{llmModelsError}（仍可手动输入）</span>
                        ) : llmModelOptions.length > 0 ? (
                          <span className="settings-status">
                            已加载 {llmModelOptions.length} 个模型，可下拉选择或手动输入
                          </span>
                        ) : null}
                        {llmCacheProbing ? (
                          <span className="settings-status">正在检测 prompt cache…</span>
                        ) : llmCacheProbeMsg ? (
                          <span className="settings-status">{llmCacheProbeMsg}</span>
                        ) : null}
                      </label>
                      <label>
                        上下文窗口 (tokens)
                        <input
                          type="number"
                          min={0}
                          step={1024}
                          value={llmForm.context_window ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) {
                              setLLMForm({ ...llmForm, context_window: null });
                              return;
                            }
                            const n = Number(raw);
                            setLLMForm({
                              ...llmForm,
                              context_window: Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
                            });
                          }}
                          placeholder="留空=自动（按模型名推断）"
                        />
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(llmForm.enable_tools)}
                          onChange={(e) => setLLMForm({ ...llmForm, enable_tools: e.target.checked })}
                        />
                        启用 tools（需上游支持 function calling / 工具调用）
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={Boolean(llmForm.is_default)}
                          onChange={(e) => setLLMForm({ ...llmForm, is_default: e.target.checked })}
                        />
                        设为默认
                      </label>
                      {llmMsg ? <div className="settings-status">{llmMsg}</div> : null}
                      <div className="llm-actions">
                        <button type="submit" className="primary" disabled={llmBusy}>
                          {llmBusy ? "保存中…" : "保存"}
                        </button>
                        <button type="button" disabled={llmBusy} onClick={() => void probeLLMFormTools()}>
                          检测 tools 能力
                        </button>
                        {editingId ? (
                          <button type="button" onClick={resetForm}>
                            取消编辑
                          </button>
                        ) : null}
                      </div>
                    </form>
                  </SettingsCard>
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "skills" && (
              <SettingsPage>
                <SettingsHint>
                  关闭后该技能不会注入系统提示，也无法被 load_skill 加载。默认全部启用。自定义技能是目录包（必有
                  SKILL.md，可含 references/、scripts/ 等）。可粘贴正文、选文件夹，或上传 .zip；服务端会校验路径与体积。
                </SettingsHint>
                <SettingsSection title="上传自定义 Skill">
                  <SettingsCard padded>
                    <form className="llm-form" onSubmit={(e) => void onUploadSkill(e)}>
                      <label>
                        名称（可选，若 SKILL.md frontmatter 已有可省略）
                        <input
                          placeholder="如 my-helper"
                          value={skillName}
                          onChange={(e) => setSkillName(e.target.value)}
                        />
                      </label>
                      <label>
                        描述（可选，若 frontmatter 已有可省略）
                        <input
                          placeholder="简要说明适用场景"
                          value={skillDesc}
                          onChange={(e) => setSkillDesc(e.target.value)}
                        />
                      </label>
                      <label>
                        正文（单文件 Markdown；与文件夹/zip 三选一）
                        <textarea
                          placeholder="可省略 frontmatter，会自动补全"
                          value={skillBody}
                          onChange={(e) => {
                            setSkillBody(e.target.value);
                            setSkillZip(null);
                            setSkillFolder([]);
                            if (skillFolderInputRef.current) skillFolderInputRef.current.value = "";
                            if (skillZipInputRef.current) skillZipInputRef.current.value = "";
                          }}
                          rows={6}
                          disabled={Boolean(skillZip) || skillFolder.length > 0}
                        />
                      </label>
                      <label>
                        上传文件夹
                        <input
                          ref={skillFolderInputRef}
                          type="file"
                          multiple
                          {...({
                            webkitdirectory: "",
                            directory: "",
                          } as Record<string, string>)}
                          onChange={(e) => {
                            const list = Array.from(e.target.files || []);
                            setSkillFolder(list);
                            setSkillZip(null);
                            setSkillBody("");
                            if (skillZipInputRef.current) skillZipInputRef.current.value = "";
                          }}
                        />
                        {skillFolder.length > 0 ? (
                          <span className="agent-desc">已选 {skillFolder.length} 个文件</span>
                        ) : null}
                      </label>
                      <label>
                        上传 .zip 压缩包
                        <input
                          ref={skillZipInputRef}
                          type="file"
                          accept=".zip,application/zip"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            setSkillZip(f);
                            setSkillFolder([]);
                            setSkillBody("");
                            if (skillFolderInputRef.current) skillFolderInputRef.current.value = "";
                          }}
                        />
                        {skillZip ? <span className="agent-desc">{skillZip.name}</span> : null}
                      </label>
                      <div className="llm-actions">
                        <button type="submit" className="primary" disabled={skillsBusy}>
                          {skillsBusy ? "上传中…" : "上传并启用"}
                        </button>
                      </div>
                    </form>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="已安装">
                  <SettingsCard>
                    <div className="llm-list">
                      {skills.length === 0 ? (
                        <SettingsEmpty>暂无技能。</SettingsEmpty>
                      ) : (
                        skills.map((s) => (
                          <div key={s.name} className="llm-item">
                            <div>
                              <div className="agent-name">
                                {s.name}
                                {s.custom ? <span className="pill">自定义</span> : null}
                                {s.custom && s.file_count ? (
                                  <span className="pill">{s.file_count} 文件</span>
                                ) : null}
                              </div>
                              <div className="agent-desc">{s.description}</div>
                            </div>
                            <div className="llm-actions">
                              <label className="check skill-toggle">
                                <input
                                  type="checkbox"
                                  checked={s.enabled}
                                  disabled={skillsBusy}
                                  onChange={(e) => void toggleSkill(s.name, e.target.checked)}
                                />
                                {s.enabled ? "已启用" : "已关闭"}
                              </label>
                              {s.custom ? (
                                <button
                                  type="button"
                                  className="ghost danger"
                                  disabled={skillsBusy}
                                  onClick={() => void onDeleteSkill(s.name)}
                                >
                                  删除
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SettingsCard>
                  {skillsMsg ? <div className="settings-status">{skillsMsg}</div> : null}
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "mcp" && (
              <SettingsPage>
                <SettingsHint>
                  插件 / MCP：账号级连接（stdio / sse / http）。启用后可在作曲框用 @mcp:名称 引用；模型开启 tools 时会注入工具。上游不支持 function calling 时可用下方手动调用测试连接。
                </SettingsHint>
                <SettingsSection title="已配置">
                  <SettingsCard>
                    <div className="llm-list">
                      {mcpServers.length === 0 ? (
                        <SettingsEmpty>暂无 MCP server，请在下方新增。</SettingsEmpty>
                      ) : (
                        mcpServers.map((s) => (
                          <div key={s.id} className="llm-item">
                            <div>
                              <div className="agent-name">
                                {s.name}
                                {s.enabled ? <span className="tag">启用</span> : <span className="tag">停用</span>}
                              </div>
                              <div className="agent-desc">
                                {s.transport}
                                {s.transport === "stdio"
                                  ? ` · ${s.command} ${(s.args || []).join(" ")}`
                                  : ` · ${s.url}`}
                              </div>
                            </div>
                            <div className="llm-actions">
                              <button type="button" onClick={() => void runTestMCP(s.id)} disabled={mcpBusy}>
                                测试连接
                              </button>
                              <button
                                type="button"
                                onClick={() => void toggleMCP(s, !s.enabled)}
                                disabled={mcpBusy}
                              >
                                {s.enabled ? "停用" : "启用"}
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() => void removeMCP(s.id)}
                                disabled={mcpBusy}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SettingsCard>
                  {mcpTestResult ? <div className="settings-status">{mcpTestResult}</div> : null}
                  {mcpMsg ? <div className="settings-status">{mcpMsg}</div> : null}
                </SettingsSection>
                <SettingsSection title="新增 MCP server">
                  <SettingsCard padded>
                    <form className="llm-form" onSubmit={saveMCP}>
                      <label>
                        名称
                        <input
                          value={mcpForm.name}
                          onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                          required
                        />
                      </label>
                      <label>
                        传输
                        <select
                          value={mcpForm.transport}
                          onChange={(e) =>
                            setMcpForm({
                              ...mcpForm,
                              transport: e.target.value as MCPServerInput["transport"],
                            })
                          }
                        >
                          <option value="stdio">stdio</option>
                          <option value="sse">sse</option>
                          <option value="http">http</option>
                        </select>
                      </label>
                      {mcpForm.transport === "stdio" ? (
                        <>
                          <label>
                            command（绝对路径或 python3/node/npx/uv…）
                            <input
                              value={mcpForm.command || ""}
                              onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                              placeholder="python3"
                              required
                            />
                          </label>
                          <label>
                            args（JSON 数组）
                            <input
                              value={mcpArgsText}
                              onChange={(e) => setMcpArgsText(e.target.value)}
                              placeholder='["/path/to/server.py"]'
                            />
                          </label>
                        </>
                      ) : (
                        <label>
                          URL
                          <input
                            value={mcpForm.url || ""}
                            onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })}
                            placeholder="http://127.0.0.1:8000/sse"
                            required
                          />
                        </label>
                      )}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={mcpForm.enabled !== false}
                          onChange={(e) => setMcpForm({ ...mcpForm, enabled: e.target.checked })}
                        />
                        启用
                      </label>
                      <div className="llm-actions">
                        <button type="submit" className="primary" disabled={mcpBusy}>
                          {mcpBusy ? "保存中…" : "新增"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMcpForm({
                              name: "echo",
                              transport: "stdio",
                              command:
                                "/Users/tangxin/Workprojects/open-bot/services/agent-runtime/.venv/bin/python",
                              args: [
                                "/Users/tangxin/Workprojects/open-bot/services/agent-runtime/examples/mcp_echo_server.py",
                              ],
                              url: "",
                              enabled: true,
                            });
                            setMcpArgsText(
                              JSON.stringify([
                                "/Users/tangxin/Workprojects/open-bot/services/agent-runtime/examples/mcp_echo_server.py",
                              ]),
                            );
                            setMcpMsg("已填入本地 echo 示例路径");
                          }}
                        >
                          填入 echo 示例
                        </button>
                      </div>
                    </form>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="手动调用工具">
                  <SettingsCard padded>
                    <form className="llm-form" onSubmit={runCallMCP}>
                      <label>
                        Server
                        <select
                          value={mcpCallServerId}
                          onChange={(e) => setMcpCallServerId(e.target.value)}
                        >
                          <option value="">选择…</option>
                          {mcpServers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Tool 名
                        <input
                          value={mcpCallToolName}
                          onChange={(e) => setMcpCallToolName(e.target.value)}
                          placeholder="echo"
                          required
                        />
                      </label>
                      <label>
                        Arguments（JSON）
                        <textarea
                          rows={3}
                          value={mcpCallArgs}
                          onChange={(e) => setMcpCallArgs(e.target.value)}
                        />
                      </label>
                      <div className="llm-actions">
                        <button type="submit" className="primary" disabled={mcpBusy}>
                          调用
                        </button>
                      </div>
                      {mcpCallResult ? (
                        <pre className="settings-status">{mcpCallResult}</pre>
                      ) : null}
                    </form>
                  </SettingsCard>
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "compact" && (
              <SettingsPage>
                <SettingsHint>
                  上下文压缩以估算 token 相对模型上下文窗口为主触发；消息数 / 字符数阈值作兜底。可在「模型」页为每条连接设置「上下文窗口 (tokens)」（留空则按模型名自动推断）。摘要以 role=summary 落库，重启后优先复用。
                </SettingsHint>
                <SettingsSection
                  title="当前参数"
                  actions={
                    <button type="button" onClick={() => void refreshCompact()}>
                      刷新
                    </button>
                  }
                >
                  {compactCfg ? (
                    <SettingsCard>
                      <div className="llm-list">
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">触发模式</div>
                            <div className="agent-desc">
                              {compactCfg.token_mode === false ? "仅遗留阈值" : "token 预算（主）+ 遗留阈值（兜底）"}
                            </div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">上下文窗口（当前用于估算）</div>
                            <div className="agent-desc">
                              {defaultLLM?.context_window && defaultLLM.context_window > 0
                                ? `${defaultLLM.context_window}（默认模型「${defaultLLM.name}」显式设置）`
                                : `${compactCfg.context_window ?? compactCfg.default_context_window ?? "—"}（自动 / 环境默认）`}
                              {defaultLLM?.model ? ` · 模型 ${defaultLLM.model}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">估算 token 预算</div>
                            <div className="agent-desc">
                              {compactCfg.token_budget ?? "—"}
                              {" "}
                              （窗口 × {compactCfg.budget_ratio ?? 0.75} − 预留输出{" "}
                              {compactCfg.reserve_output_tokens ?? 2048}）
                            </div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">默认上下文窗口</div>
                            <div className="agent-desc">{compactCfg.default_context_window ?? 32768}</div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">预算比例</div>
                            <div className="agent-desc">{compactCfg.budget_ratio ?? 0.75}</div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">预留输出 tokens</div>
                            <div className="agent-desc">{compactCfg.reserve_output_tokens ?? 2048}</div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">消息数阈值（兜底）</div>
                            <div className="agent-desc">{compactCfg.max_messages}</div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">字符数阈值（兜底）</div>
                            <div className="agent-desc">{compactCfg.max_chars}</div>
                          </div>
                        </div>
                        <div className="llm-item">
                          <div>
                            <div className="agent-name">保留最近消息数</div>
                            <div className="agent-desc">{compactCfg.keep_recent}</div>
                          </div>
                        </div>
                      </div>
                    </SettingsCard>
                  ) : (
                    <SettingsCard>
                      <SettingsEmpty>无法读取（请确认服务已启动）</SettingsEmpty>
                    </SettingsCard>
                  )}
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "routines" && (
              <SettingsPage>
                <SettingsHint>
                  例行任务绑定所属 Bot，触发后复用固定会话并注入 [routine] 提示。支持 IANA 时区 cron，以及 Slack / GitHub 事件唤醒（需先创建入站 Hook）。可在聊天里用工具创建/暂停/恢复。
                </SettingsHint>
                <SettingsSection title="任务列表">
                  <SettingsCard>
                    <div className="llm-list">
                      {routines.length === 0 ? (
                        <SettingsEmpty>暂无例行任务。</SettingsEmpty>
                      ) : (
                        routines.map((r) => (
                          <div key={r.id} className="llm-item">
                            <div style={{ flex: 1 }}>
                              <div className="agent-name">
                                {r.name}
                                {r.enabled ? <span className="tag">启用</span> : <span className="tag">停用</span>}
                              </div>
                              <div className="agent-desc">
                                Bot: {agentNameById.get(r.agent_id) || r.agent_id || "—"}
                                {" · "}
                                cron: {r.schedule_cron || "（无）"}
                                {" · "}
                                {r.timezone || "Asia/Shanghai"}
                                {r.triggers && r.triggers.length
                                  ? ` · 事件 ${r.triggers.length}`
                                  : ""}
                                {r.conversation_id ? " · 已绑定会话" : ""}
                                {r.last_run_at ? ` · 上次 ${r.last_run_at}` : ""}
                              </div>
                              <div className="agent-desc" style={{ marginTop: 4 }}>
                                prompt: {r.prompt.slice(0, 120)}
                                {r.prompt.length > 120 ? "…" : ""}
                              </div>
                              {r.last_run ? (
                                <pre className="settings-status" style={{ marginTop: 8, maxHeight: 160 }}>
                                  [{r.last_run.status}] {r.last_run.result_text}
                                </pre>
                              ) : null}
                            </div>
                            <div className="llm-actions">
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={r.enabled}
                                  onChange={(e) => void toggleRoutine(r, e.target.checked)}
                                  disabled={routinesBusy}
                                />
                                启用
                              </label>
                              <button type="button" onClick={() => void runRoutineNow(r.id)} disabled={routinesBusy}>
                                立即运行
                              </button>
                              <button type="button" className="danger" onClick={() => void removeRoutine(r.id)}>
                                删除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="新建例行任务">
                  <SettingsCard padded>
                    <form className="llm-form" onSubmit={saveRoutine}>
                      <label>
                        名称
                        <input
                          value={routineForm.name}
                          onChange={(e) => setRoutineForm({ ...routineForm, name: e.target.value })}
                          required
                        />
                      </label>
                      <label>
                        Prompt
                        <textarea
                          rows={3}
                          value={routineForm.prompt}
                          onChange={(e) => setRoutineForm({ ...routineForm, prompt: e.target.value })}
                          required
                        />
                      </label>
                      <label>
                        所属 Bot
                        <select
                          value={routineForm.agent_id || agentId || ""}
                          onChange={(e) => setRoutineForm({ ...routineForm, agent_id: e.target.value })}
                        >
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Cron（5 字段，纯事件可留空）
                        <input
                          value={routineForm.schedule_cron}
                          onChange={(e) => setRoutineForm({ ...routineForm, schedule_cron: e.target.value })}
                          placeholder="0 9 * * *"
                        />
                      </label>
                      <label>
                        时区（IANA）
                        <input
                          value={routineForm.timezone || "Asia/Shanghai"}
                          onChange={(e) => setRoutineForm({ ...routineForm, timezone: e.target.value })}
                          placeholder="Asia/Shanghai"
                        />
                      </label>
                      <label>
                        事件触发器 JSON
                        <textarea
                          rows={3}
                          value={routineForm.triggers_json || "[]"}
                          onChange={(e) => setRoutineForm({ ...routineForm, triggers_json: e.target.value })}
                          placeholder='[{"source":"slack","type":"app_mention"}]'
                        />
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!routineForm.quiet_unchanged}
                          onChange={(e) => setRoutineForm({ ...routineForm, quiet_unchanged: e.target.checked })}
                        />
                        结果无变化时静默
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={routineForm.enabled !== false}
                          onChange={(e) => setRoutineForm({ ...routineForm, enabled: e.target.checked })}
                        />
                        创建后启用
                      </label>
                      {routinesMsg ? <div className="settings-status">{routinesMsg}</div> : null}
                      <div className="llm-actions">
                        <button type="submit" className="primary" disabled={routinesBusy}>
                          {routinesBusy ? "处理中…" : "创建"}
                        </button>
                        <button type="button" onClick={() => void refreshRoutines()}>
                          刷新
                        </button>
                      </div>
                    </form>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="入站 Webhook（Slack / GitHub）">
                  <SettingsHint>
                    创建 Hook 后把返回的 URL 配到 Slack Event Subscriptions 或 GitHub Webhooks。
                    例行任务的 triggers 匹配事件后，会在绑定会话中唤醒助手。密钥可选用 bot_secrets / Hook secret（GitHub 签名）。
                  </SettingsHint>
                  <SettingsCard>
                    <div className="llm-list">
                      {inboundHooks.length === 0 ? (
                        <SettingsEmpty>暂无 Hook。点击下方创建。</SettingsEmpty>
                      ) : (
                        inboundHooks.map((h) => (
                          <div key={h.id} className="llm-item">
                            <div style={{ flex: 1 }}>
                              <div className="agent-name">{h.label || h.provider}</div>
                              <div className="agent-desc">Slack: {h.url_slack}</div>
                              <div className="agent-desc">GitHub: {h.url_github}</div>
                              <div className="agent-desc">token: {h.token}</div>
                            </div>
                            <div className="llm-actions">
                              <button
                                type="button"
                                className="danger"
                                onClick={() => {
                                  void (async () => {
                                    await deleteInboundHook(h.id);
                                    await refreshRoutines();
                                  })().catch((err) =>
                                    setHooksMsg(err instanceof Error ? err.message : String(err)),
                                  );
                                }}
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {hooksMsg ? <div className="settings-status">{hooksMsg}</div> : null}
                    <div className="llm-actions" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className="primary"
                        disabled={routinesBusy}
                        onClick={() => {
                          void (async () => {
                            setHooksMsg("");
                            await createInboundHook({ provider: "any", label: "默认入站" });
                            await refreshRoutines();
                            setHooksMsg("已创建 Hook");
                          })().catch((err) =>
                            setHooksMsg(err instanceof Error ? err.message : String(err)),
                          );
                        }}
                      >
                        创建 Hook
                      </button>
                    </div>
                  </SettingsCard>
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "sandbox" && (
              <SettingsPage>
                <SettingsHint>
                  运行环境由本账户下的 Bot 共用。电脑模式决定读写文件时是账户内多 Bot 共用一份，还是每个 Bot 单独一份。你自己的设备请到「电脑」里查看。
                </SettingsHint>
                <SettingsSection title="状态">
                  <SettingsCard>
                    <div className="llm-list">
                      <div className="llm-item">
                        <div>
                          <div className="agent-name">状态：{sandbox?.status || "未知"}</div>
                          <div className="agent-desc">
                            {sandbox?.image ? `环境 ${sandbox.image}` : "尚未就绪"}
                          </div>
                          {sandbox?.last_error ? (
                            <div className="agent-desc" style={{ color: "var(--danger)" }}>
                              错误：{sandbox.last_error}
                            </div>
                          ) : null}
                        </div>
                        <div className="llm-actions">
                          <button type="button" onClick={() => void doEnsureSandbox()} disabled={sandboxBusy}>
                            确保启动
                          </button>
                          <button type="button" onClick={() => void doOpenDesktop()} disabled={sandboxBusy}>
                            打开桌面
                          </button>
                          <button type="button" onClick={() => void doCheckpointSandbox()} disabled={sandboxBusy}>
                            快照
                          </button>
                          <button type="button" onClick={() => void doStopSandbox()} disabled={sandboxBusy}>
                            停止
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => void doResetSandbox()}
                            disabled={sandboxBusy}
                          >
                            重置
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void refreshSandbox().catch((err) =>
                                setSandboxMsg(err instanceof Error ? err.message : String(err)),
                              )
                            }
                          >
                            刷新
                          </button>
                        </div>
                      </div>
                    </div>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="执行命令">
                  <SettingsCard padded>
                    <form className="llm-form" onSubmit={doExecSandbox}>
                      <label>
                        命令
                        <input
                          value={sandboxCmd}
                          onChange={(e) => setSandboxCmd(e.target.value)}
                          placeholder="echo hi"
                          required
                        />
                      </label>
                      <div className="llm-actions">
                        <button type="submit" className="primary" disabled={sandboxBusy}>
                          运行
                        </button>
                      </div>
                      {sandboxExecOut ? <pre className="settings-status">{sandboxExecOut}</pre> : null}
                    </form>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="文件">
                  <SettingsCard padded>
                    <div className="llm-form">
                      <label>
                        目录路径
                        <input
                          value={sandboxPath}
                          onChange={(e) => setSandboxPath(e.target.value)}
                          placeholder="."
                        />
                      </label>
                      <div className="llm-actions">
                        <button type="button" onClick={() => void doLsSandbox()} disabled={sandboxBusy}>
                          列出
                        </button>
                      </div>
                      {sandboxLsOut ? <pre className="settings-status">{sandboxLsOut}</pre> : null}
                      <label>
                        文件路径
                        <input
                          value={sandboxFilePath}
                          onChange={(e) => setSandboxFilePath(e.target.value)}
                          placeholder="hello.txt"
                        />
                      </label>
                      <label>
                        内容
                        <textarea
                          rows={3}
                          value={sandboxFileContent}
                          onChange={(e) => setSandboxFileContent(e.target.value)}
                        />
                      </label>
                      <div className="llm-actions">
                        <button type="button" onClick={() => void doWriteSandboxFile()} disabled={sandboxBusy}>
                          写入
                        </button>
                        <button type="button" onClick={() => void doReadSandboxFile()} disabled={sandboxBusy}>
                          读取
                        </button>
                      </div>
                    </div>
                  </SettingsCard>
                  {sandboxMsg ? <div className="settings-status">{sandboxMsg}</div> : null}
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "machines" && (
              <SettingsPage>
                <SettingsHint>
                  桌面端登录后会连上本机文件通道；网页不会登记为电脑。操作仍经「通用 → Bot → 自动审核」检查（硬拒绝始终有效）。当前客户端：{clientEnv.platform} / {clientEnv.app}
                  {shouldRegisterAsHost(clientEnv) ? "（会自动注册）" : "（浏览器，不自动注册）"}。
                  手机只用来登录聊天，本地文件和命令在已连接的电脑上跑。
                </SettingsHint>

                {(() => {
                  const current = hostMachineId
                    ? machines.find((x) => x.id === hostMachineId)
                    : null;
                  if (!shouldRegisterAsHost(clientEnv)) {
                    return (
                      <SettingsSection title="当前电脑">
                        <SettingsCard padded>
                          <div className="bot-settings-desc">
                            浏览器不能作为本机执行通道。请用桌面应用打开并保持在线。
                          </div>
                        </SettingsCard>
                      </SettingsSection>
                    );
                  }
                  const loginOnlyHere =
                    resolveClientDeviceType(clientEnv) === "mobile" ||
                    clientEnv.app === "capacitor";
                  if (loginOnlyHere) {
                    return (
                      <SettingsSection title="当前设备">
                        <SettingsCard padded>
                          <div className="bot-general-settings">
                            <div className="settings-row bot-settings-row">
                              <div className="bot-settings-copy">
                                <div className="bot-settings-title">
                                  {current?.label || deviceDisplayName || "本机"}
                                </div>
                                <div className="bot-settings-desc">
                                  手机只用来登录聊天；本地文件和命令请在已连接的电脑上跑。
                                </div>
                              </div>
                              <span className="tag machine-login-only">仅登录</span>
                              {current ? (
                                machineIsOnline(current) ? (
                                  <span className="tag machine-online">在线</span>
                                ) : (
                                  <span className="tag machine-offline">离线</span>
                                )
                              ) : null}
                            </div>
                            {!current ? (
                              <div className="bot-settings-desc">
                                尚未登记本机。点击下方「重新注册本机」以出现在设备列表。
                              </div>
                            ) : null}
                          </div>
                        </SettingsCard>
                      </SettingsSection>
                    );
                  }
                  return (
                    <SettingsSection title="当前电脑">
                      <SettingsCard padded>
                        <div className="bot-general-settings">
                          <div className="settings-row bot-settings-row">
                            <div className="bot-settings-copy">
                              <div className="bot-settings-title">名称</div>
                              <div className="bot-settings-desc">
                                显示给 Bot 的设备名（如系统主机名）。保存后同步到已注册列表。
                              </div>
                            </div>
                            <div className="bot-machine-name-edit">
                              <input
                                value={currentMachineDraft}
                                onChange={(e) => setCurrentMachineDraft(e.target.value)}
                                maxLength={64}
                                placeholder={deviceDisplayName || "设备名称"}
                                disabled={machinesBusy || !current}
                              />
                              <button
                                type="button"
                                className="primary"
                                disabled={
                                  machinesBusy ||
                                  !current ||
                                  !currentMachineDraft.trim() ||
                                  currentMachineDraft.trim() === current.label
                                }
                                onClick={() => {
                                  if (!current) return;
                                  const name = currentMachineDraft.trim();
                                  if (!name) return;
                                  setMachinesBusy(true);
                                  void updateMachine(current.id, { label: name })
                                    .then((updated) => {
                                      setMachinesMsg(`已保存为 ${updated.label}`);
                                      setDeviceDisplayName(updated.label);
                                      setCurrentMachineDraft(updated.label);
                                      return refreshMachines();
                                    })
                                    .catch((err) =>
                                      setMachinesMsg(err instanceof Error ? err.message : String(err)),
                                    )
                                    .finally(() => setMachinesBusy(false));
                                }}
                              >
                                保存
                              </button>
                            </div>
                          </div>
                          <div className="settings-row bot-settings-row">
                            <div className="bot-settings-copy">
                              <div className="bot-settings-title">在这台电脑上执行</div>
                              <div className="bot-settings-desc">
                                始终允许：除硬拒绝（curl|sh、rm -rf /、mkfs）外直接执行，不弹确认卡。用户规则「先询问」命中时仍会确认。
                              </div>
                            </div>
                            <select
                              className="bot-settings-select"
                              value={hostExecPolicy}
                              disabled={machinesBusy || !current}
                              onChange={(e) => {
                                if (!current) return;
                                const policy = normalizeMachineExecPolicy(e.target.value);
                                setHostExecPolicy(policy);
                                setHostExecMachinePolicy(policy);
                                // Mirror write kill-switch: deny → no writes; allow/ask → writes on.
                                setHostWritesEnabled(policy !== "deny");
                                setHostWritesOn(policy !== "deny");
                                setMachinesBusy(true);
                                void updateMachine(current.id, { exec_policy: policy })
                                  .then(() => {
                                    setMachinesMsg(
                                      policy === "allow"
                                        ? "已设为始终允许（不弹确认卡；硬拒绝仍失败）"
                                        : policy === "ask"
                                          ? "已设为每次询问"
                                          : "已设为不允许在这台电脑执行",
                                    );
                                    return refreshMachines();
                                  })
                                  .catch((err) =>
                                    setMachinesMsg(err instanceof Error ? err.message : String(err)),
                                  )
                                  .finally(() => setMachinesBusy(false));
                              }}
                              aria-label="在这台电脑上执行"
                            >
                              {MACHINE_EXEC_POLICY_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {!current ? (
                            <div className="bot-settings-desc">
                              尚未登记本机。点击下方「重新注册本机」以启用。
                            </div>
                          ) : (
                            <div className="bot-settings-desc">
                              状态：
                              {machineIsOnline(current) ? "在线" : "离线"}
                              {current.connected ? " · 可操作" : ""}
                              {current.platform ? ` · ${current.platform}` : ""}
                              {hostWritesOn ? "" : " · 本机写入已关"}
                            </div>
                          )}
                        </div>
                      </SettingsCard>
                    </SettingsSection>
                  );
                })()}

                <SettingsSection
                  title="已注册"
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          void refreshMachines()
                            .then(() => setMachinesMsg("已刷新"))
                            .catch((err) =>
                              setMachinesMsg(err instanceof Error ? err.message : String(err)),
                            )
                        }
                        disabled={machinesBusy}
                      >
                        刷新
                      </button>
                      {shouldRegisterAsHost(clientEnv) ? (
                        <button
                          type="button"
                          className="primary"
                          disabled={machinesBusy}
                          onClick={() => {
                            setMachinesBusy(true);
                            void (async () => {
                              const label =
                                currentMachineDraft.trim() ||
                                deviceDisplayName.trim() ||
                                (await resolveDefaultMachineLabel(clientEnv));
                              const m = await registerMachine({
                                machine_key: await resolveMachineKey(clientEnv),
                                label,
                                platform: clientEnv.platform,
                                os: clientEnv.os,
                                arch: clientEnv.arch,
                                app: clientEnv.app,
                                app_version: clientEnv.app_version,
                                device_type: resolveClientDeviceType(clientEnv),
                              });
                              setStoredMachineId(m.id);
                              setHostMachineId(m.id);
                              setCurrentMachineDraft(m.label);
                              setMachinesMsg(`已注册：${m.label}`);
                              await refreshMachines();
                            })()
                              .catch((err) =>
                                setMachinesMsg(err instanceof Error ? err.message : String(err)),
                              )
                              .finally(() => setMachinesBusy(false));
                          }}
                        >
                          重新注册本机
                        </button>
                      ) : null}
                    </>
                  }
                >
                  <SettingsCard>
                    <div className="llm-list">
                      {machines.length === 0 ? (
                        <SettingsEmpty>暂无已注册电脑。请用桌面或移动客户端登录以登记。</SettingsEmpty>
                      ) : (
                        machines.map((m) => (
                          <div className="llm-item" key={m.id}>
                            <div>
                              {renamingMachineId === m.id ? (
                                <div className="llm-form" style={{ gap: 8, marginBottom: 4 }}>
                                  <input
                                    value={renameDraft}
                                    onChange={(e) => setRenameDraft(e.target.value)}
                                    maxLength={64}
                                    placeholder="设备名称"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        const name = renameDraft.trim();
                                        if (!name) return;
                                        setMachinesBusy(true);
                                        void updateMachine(m.id, { label: name })
                                          .then((updated) => {
                                            setMachinesMsg(`已重命名为 ${updated.label}`);
                                            setRenamingMachineId(null);
                                            if (getStoredMachineId() === m.id) {
                                              setDeviceDisplayName(updated.label);
                                              setCurrentMachineDraft(updated.label);
                                            }
                                            return refreshMachines();
                                          })
                                          .catch((err) =>
                                            setMachinesMsg(
                                              err instanceof Error ? err.message : String(err),
                                            ),
                                          )
                                          .finally(() => setMachinesBusy(false));
                                      } else if (e.key === "Escape") {
                                        setRenamingMachineId(null);
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="agent-name">
                                  {m.label}{" "}
                                  {isLoginOnlyMachine(m) ? (
                                    <span className="tag machine-login-only">仅登录</span>
                                  ) : null}
                                  {machineIsOnline(m) ? (
                                    <span className="tag machine-online">在线</span>
                                  ) : (
                                    <span className="tag machine-offline">离线</span>
                                  )}
                                  {!isLoginOnlyMachine(m) && m.connected ? (
                                    <span className="tag machine-host-ready">可操作</span>
                                  ) : null}
                                  {hostMachineId === m.id ? <span className="tag">当前</span> : null}
                                </div>
                              )}
                              <div className="agent-desc">
                                {m.platform}
                                {m.os ? ` · ${m.os}` : ""}
                                {m.arch ? ` · ${m.arch}` : ""}
                                {m.app ? ` · ${m.app}` : ""}
                                {m.device_type ? ` · ${m.device_type}` : ""}
                                {isLoginOnlyMachine(m)
                                  ? ""
                                  : ` · ${normalizeMachineExecPolicy(m.exec_policy) === "allow" ? "始终允许" : normalizeMachineExecPolicy(m.exec_policy) === "ask" ? "每次询问" : "不允许"}`}
                                {m.last_seen ? ` · 最近 ${m.last_seen}` : ""}
                              </div>
                            </div>
                            <div className="llm-actions">
                              {renamingMachineId === m.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={machinesBusy || !renameDraft.trim()}
                                    onClick={() => {
                                      const name = renameDraft.trim();
                                      if (!name) return;
                                      setMachinesBusy(true);
                                      void updateMachine(m.id, { label: name })
                                        .then((updated) => {
                                          setMachinesMsg(`已重命名为 ${updated.label}`);
                                          setRenamingMachineId(null);
                                          if (getStoredMachineId() === m.id) {
                                            setDeviceDisplayName(updated.label);
                                            setCurrentMachineDraft(updated.label);
                                          }
                                          return refreshMachines();
                                        })
                                        .catch((err) =>
                                          setMachinesMsg(
                                            err instanceof Error ? err.message : String(err),
                                          ),
                                        )
                                        .finally(() => setMachinesBusy(false));
                                    }}
                                  >
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    disabled={machinesBusy}
                                    onClick={() => setRenamingMachineId(null)}
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={machinesBusy}
                                  onClick={() => {
                                    setRenamingMachineId(m.id);
                                    setRenameDraft(m.label);
                                  }}
                                >
                                  重命名
                                </button>
                              )}
                              <button
                                type="button"
                                className="danger"
                                disabled={machinesBusy}
                                onClick={() => {
                                  setMachinesBusy(true);
                                  void deleteMachine(m.id)
                                    .then(() => {
                                      if (getStoredMachineId() === m.id) clearStoredMachineId();
                                      if (renamingMachineId === m.id) setRenamingMachineId(null);
                                      setMachinesMsg(
                                        isLoginOnlyMachine(m)
                                          ? `已移除 ${m.label}`
                                          : `已删除 ${m.label}`,
                                      );
                                      return refreshMachines();
                                    })
                                    .catch((err) =>
                                      setMachinesMsg(err instanceof Error ? err.message : String(err)),
                                    )
                                    .finally(() => setMachinesBusy(false));
                                }}
                              >
                                {isLoginOnlyMachine(m) ? "移除" : "删除"}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SettingsCard>
                  {machinesMsg ? <div className="settings-status">{machinesMsg}</div> : null}
                </SettingsSection>
              </SettingsPage>
            )}

            {settingsTab === "secrets" && (
              <SettingsPage>
                <SettingsHint>
                  仅存元数据与密文；列表接口永不返回明文。需在服务端配置加密密钥。
                </SettingsHint>
                <SettingsSection title="添加密钥">
                  <SettingsCard padded>
                    <form
                      className="llm-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void (async () => {
                          try {
                            await createBotSecret({
                              name: secretFormName,
                              value: secretFormValue,
                              origin: secretFormOrigin,
                              auth_type: "bearer",
                            });
                            setSecretFormValue("");
                            setSecretMsg("已保存");
                            await refreshSecrets();
                          } catch (err) {
                            setSecretMsg(err instanceof Error ? err.message : String(err));
                          }
                        })();
                      }}
                    >
                      <label>
                        名称
                        <input value={secretFormName} onChange={(e) => setSecretFormName(e.target.value)} />
                      </label>
                      <label>
                        Origin (HTTPS)
                        <input value={secretFormOrigin} onChange={(e) => setSecretFormOrigin(e.target.value)} />
                      </label>
                      <label>
                        值
                        <input type="password" value={secretFormValue} onChange={(e) => setSecretFormValue(e.target.value)} />
                      </label>
                      <div className="llm-actions">
                        <button type="submit" className="primary">
                          添加密钥
                        </button>
                      </div>
                    </form>
                  </SettingsCard>
                </SettingsSection>
                <SettingsSection title="已保存">
                  <SettingsCard>
                    <div className="llm-list">
                      {botSecrets.length === 0 ? (
                        <SettingsEmpty>暂无密钥。</SettingsEmpty>
                      ) : (
                        botSecrets.map((s) => (
                          <div key={s.id} className="llm-item">
                            <div>
                              <div className="agent-name">{s.name}</div>
                              <div className="agent-desc">
                                {s.origin || "(no origin)"} · {s.auth_type}
                              </div>
                            </div>
                            <div className="llm-actions">
                              <button
                                type="button"
                                className="danger"
                                onClick={() =>
                                  void deleteBotSecret(s.id)
                                    .then(() => refreshSecrets())
                                    .catch((e) => setSecretMsg(String(e)))
                                }
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </SettingsCard>
                  {secretRequests.length ? (
                    <div className="settings-status">待处理请求：{secretRequests.length}</div>
                  ) : null}
                  {secretMsg ? <div className="settings-status">{secretMsg}</div> : null}
                </SettingsSection>
              </SettingsPage>
            )}

              </div>
            </div>
            </>
            ) : null}
          </div>
        </div>
      )}
      <GroupMembersSettings
        open={Boolean(groupMembersChannel)}
        channel={groupMembersChannel}
        agents={agents}
        onClose={() => setGroupMembersChannel(null)}
        onChanged={(ch) => {
          setChannels((prev) => {
            const i = prev.findIndex((c) => c.id === ch.id);
            if (i < 0) return prev;
            const next = prev.slice();
            next[i] = { ...prev[i], ...ch, name: ch.name || prev[i].name };
            return next;
          });
          setGroupMembersChannel((cur) =>
            cur && cur.id === ch.id
              ? { ...cur, ...ch, name: ch.name || cur.name }
              : cur,
          );
          void refreshChannels().catch(() => {});
        }}
      />
      <CloneAgentModal
        agent={cloneTarget}
        onClose={() => setCloneTarget(null)}
        onCloned={(res) => {
          const created = res.agent;
          void refreshAgents()
            .then(() => {
              setShowSettings(false);
              void onSelectAgentRef.current(created.id);
            })
            .catch(() => {});
          const extras: string[] = [];
          if (res.memories_copied) extras.push(`${res.memories_copied} 条记忆`);
          if (res.routines_copied) extras.push(`${res.routines_copied} 个例行任务（已暂停）`);
          toast.success(`已复制为「${created.name}」${extras.length ? `，含 ${extras.join("、")}` : ""}`);
        }}
      />
      <SecretPromptModal
        request={secretPrompt}
        onClose={() => setSecretPrompt(null)}
        onResolved={() => void refreshSecrets()}
      />
      <BotAvatarSettings
        open={Boolean(avatarSettingsAgent)}
        agent={avatarSettingsAgent}
        onClose={() => setAvatarSettingsAgent(null)}
        onSave={saveAvatarSettings}
      />
      <FeedbackModal
        target={feedbackTarget}
        onClose={() => setFeedbackTarget(null)}
        onSubmit={submitFeedback}
      />
      <TrainPanel
        open={Boolean(trainAgent)}
        agent={trainAgent}
        reloadToken={trainReload}
        onClose={() => setTrainAgent(null)}
      />
    </div>
  );
}
