import { useMemo } from "react";
import { toast } from "sonner";
import {
  deleteLLMConnection,
  setDefaultLLMConnection,
  type Agent,
} from "../../api";
import { setHostExecUserSettings } from "../../lib/hostExec";
import { BotSettingsPanel } from "../BotSettingsPanel";
import {
  CompactSettingsTab,
  GeneralSettingsTab,
  LlmSettingsTab,
  MachinesSettingsTab,
  McpSettingsTab,
  ReviewSettingsTab,
  RoutinesSettingsTab,
  SandboxSettingsTab,
  SecretsSettingsTab,
  SkillsSettingsTab,
} from "../settings";
import type { SettingsHubNav } from "../MobileSettingsHub";
import type { AppSettingsBundle } from "../../hooks/useAppSettings";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { useSheetFormUi } from "../useIsTouchUi";
import { sessionActions } from "../../stores/sessionActions";
import { patchShell, useShellStore } from "../../stores/shell";
import { useWorkspaceStore } from "../../stores/workspace";
import { agentNameMap, resolveActiveAgent } from "../../lib/app/workspaceDerived";

export function AppSettingsPanel({ settings }: { settings: AppSettingsBundle }) {
  const user = useWorkspaceStore((s) => s.user);
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const hostExecPolicy = useWorkspaceStore((s) => s.hostExecPolicy);
  const hostWritesOn = useWorkspaceStore((s) => s.hostWritesOn);
  const settingsShellHub = useShellStore((s) => s.settingsShellHub);
  const settingsGeneralPane = useShellStore((s) => s.settingsGeneralPane);
  const sheetForm = useSheetFormUi();
  const activeAgent = resolveActiveAgent(agentId, agents);
  const agentNameById = useMemo(() => agentNameMap(agents), [agents]);
  const setSettingsShellHub = (v: boolean) => patchShell({ settingsShellHub: v });
  const setSettingsGeneralPane = (pane: "account" | "server" | "review") =>
    patchShell({ settingsGeneralPane: pane });
  const onLogout = () => sessionActions().onLogout();
  const onSystemBack = () => sessionActions().onSystemBack();
  const onStatusMessage = (msg: string) => sessionActions().onStatusMessage(msg);
  const refreshAgents = () => sessionActions().refreshAgents();
  const openAvatarSettings = (agent: Agent) => sessionActions().openAvatarSettings(agent);
  const setCloneTarget = (agent: Agent | null) => sessionActions().setCloneTarget(agent);
  const {
    showSettings,
    closeSettings,
    settingsTab,
    selectSettingsTab,
    prefetchSettingsTab,
    setSettingsTab,
    emailCopied,
    onCopyEmail,
    defaultLLM,
    llm,
    skills,
    compact,
    mcp,
    routines,
    sandbox,
    machines,
    secrets,
    review,
    hostMachineId,
    clientEnv,
  } = settings;

  if (!showSettings) return null;

  const preferredMachineLabel = (() => {
    const focus = activeAgent || agents[0];
    const mid = focus?.machine_id;
    if (!mid) return undefined;
    const m = machines.machines.find((x) => x.id === mid);
    return m?.label || mid;
  })();

  const onHubNavigate = (tab: SettingsHubNav) => {
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
  };

  return (
    <AppSettingsDialog
      open={showSettings}
      sheetForm={sheetForm}
      settingsShellHub={settingsShellHub}
      settingsTab={settingsTab}
      settingsGeneralPane={settingsGeneralPane}
      user={user}
      activeAgent={activeAgent}
      agents={agents}
      preferredMachineLabel={preferredMachineLabel}
      onClose={closeSettings}
      onSelectTab={selectSettingsTab}
      onHubNavigate={onHubNavigate}
      onOpenBotAvatar={() => {
        const focus = activeAgent || agents[0];
        if (focus) {
          closeSettings();
          openAvatarSettings(focus);
        } else {
          setSettingsShellHub(false);
          setSettingsTab("bot");
        }
      }}
      onLogout={onLogout}
      onSystemBack={onSystemBack}
    >
      {settingsTab === "general" && (
        <GeneralSettingsTab
          sheetForm={sheetForm}
          settingsGeneralPane={settingsGeneralPane}
          username={user?.username || "账户"}
          email={user?.email}
          emailCopied={emailCopied}
          onCopyEmail={() => onCopyEmail(user?.email || "")}
          onLogout={onLogout}
          onApiServerApplied={() => {
            onStatusMessage("已切换服务器地址");
          }}
          defaultModelLabel={defaultLLM?.model || defaultLLM?.name || "未配置"}
          onOpenLlmSettings={() => setSettingsTab("llm")}
          onHostExecSettingsChange={(s) => {
            setHostExecUserSettings(s);
          }}
        />
      )}

      {settingsTab === "review" && (
        <ReviewSettingsTab
          toolAllowEntries={review.toolAllowEntries}
          toolAllowBusy={review.toolAllowBusy}
          toolAllowServerOk={review.toolAllowServerOk}
          onRevokeEntry={review.onRevokeEntry}
        />
      )}

      {settingsTab === "bot" && (
        <BotSettingsPanel
          agent={activeAgent ?? null}
          onClone={(a) => setCloneTarget(a)}
          onOpenAvatar={(a) => {
            closeSettings();
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
        <LlmSettingsTab
          llms={llm.llms}
          editingId={llm.editingId}
          llmForm={llm.llmForm}
          onLlmFormChange={llm.setLLMForm}
          llmMsg={llm.llmMsg}
          llmBusy={llm.llmBusy}
          llmModelOptions={llm.llmModelOptions}
          llmModelsLoading={llm.llmModelsLoading}
          llmModelsError={llm.llmModelsError}
          llmCacheProbing={llm.llmCacheProbing}
          llmCacheProbeMsg={llm.llmCacheProbeMsg}
          onSetDefault={(id) =>
            void setDefaultLLMConnection(id)
              .then(llm.refreshLLMs)
              .catch((err) => llm.setLLMMsg(String(err)))
          }
          onStartEdit={llm.startEdit}
          onDeleteConnection={(id) =>
            void deleteLLMConnection(id)
              .then(llm.refreshLLMs)
              .then(llm.resetForm)
              .catch((err) => llm.setLLMMsg(String(err)))
          }
          onSaveLlm={llm.saveLLM}
          onResetForm={llm.resetForm}
          onProbeTools={() => void llm.probeLLMFormTools()}
        />
      )}

      {settingsTab === "skills" && (
        <SkillsSettingsTab
          skillName={skills.skillName}
          setSkillName={skills.setSkillName}
          skillDesc={skills.skillDesc}
          setSkillDesc={skills.setSkillDesc}
          skillBody={skills.skillBody}
          skillZip={skills.skillZip}
          skillFolder={skills.skillFolder}
          skillFolderInputRef={skills.skillFolderInputRef}
          skillZipInputRef={skills.skillZipInputRef}
          skillsBusy={skills.skillsBusy}
          skillsMsg={skills.skillsMsg}
          skills={skills.skills}
          onUploadSkill={skills.onUploadSkill}
          onToggleSkill={skills.toggleSkill}
          onDeleteSkill={skills.onDeleteSkill}
          onSkillBodyChange={skills.onSkillBodyChange}
          onSkillFolderChange={skills.onSkillFolderChange}
          onSkillZipChange={skills.onSkillZipChange}
        />
      )}

      {settingsTab === "mcp" && (
        <McpSettingsTab
          mcpServers={mcp.mcpServers}
          mcpBusy={mcp.mcpBusy}
          mcpMsg={mcp.mcpMsg}
          mcpTestResult={mcp.mcpTestResult}
          mcpForm={mcp.mcpForm}
          setMcpForm={mcp.setMcpForm}
          mcpArgsText={mcp.mcpArgsText}
          setMcpArgsText={mcp.setMcpArgsText}
          mcpCallServerId={mcp.mcpCallServerId}
          setMcpCallServerId={mcp.setMcpCallServerId}
          mcpCallToolName={mcp.mcpCallToolName}
          setMcpCallToolName={mcp.setMcpCallToolName}
          mcpCallArgs={mcp.mcpCallArgs}
          setMcpCallArgs={mcp.setMcpCallArgs}
          mcpCallResult={mcp.mcpCallResult}
          onSaveMcp={mcp.saveMCP}
          onRunCallMcp={mcp.runCallMCP}
          onTestMcp={(id) => void mcp.runTestMCP(id)}
          onToggleMcp={(server, enabled) => void mcp.toggleMCP(server, enabled)}
          onRemoveMcp={(id) => void mcp.removeMCP(id)}
          onFillEchoExample={mcp.fillEchoExample}
        />
      )}

      {settingsTab === "compact" && (
        <CompactSettingsTab
          compactCfg={compact.compactCfg}
          defaultLLM={defaultLLM}
          onRefreshCompact={() => void compact.refreshCompact()}
        />
      )}

      {settingsTab === "routines" && (
        <RoutinesSettingsTab
          routines={routines.routines}
          routinesBusy={routines.routinesBusy}
          routinesMsg={routines.routinesMsg}
          routineForm={routines.routineForm}
          setRoutineForm={routines.setRoutineForm}
          agents={agents}
          agentId={agentId}
          agentNameById={agentNameById}
          inboundHooks={routines.inboundHooks}
          hooksMsg={routines.hooksMsg}
          onSaveRoutine={routines.saveRoutine}
          onToggleRoutine={(routine, enabled) => void routines.toggleRoutine(routine, enabled)}
          onRunRoutineNow={(id) => void routines.runRoutineNow(id)}
          onRemoveRoutine={(id) => void routines.removeRoutine(id)}
          onRefreshRoutines={() => void routines.refreshRoutines()}
          onDeleteInboundHook={(id) => {
            void routines.deleteInboundHookEntry(id).catch((err) =>
              routines.setHooksMsg(err instanceof Error ? err.message : String(err)),
            );
          }}
          onCreateInboundHook={() => {
            void routines.createInboundHookEntry().catch((err) =>
              routines.setHooksMsg(err instanceof Error ? err.message : String(err)),
            );
          }}
        />
      )}

      {settingsTab === "sandbox" && (
        <SandboxSettingsTab
          sandbox={sandbox.sandbox}
          sandboxBusy={sandbox.sandboxBusy}
          sandboxMsg={sandbox.sandboxMsg}
          sandboxCmd={sandbox.sandboxCmd}
          setSandboxCmd={sandbox.setSandboxCmd}
          sandboxExecOut={sandbox.sandboxExecOut}
          sandboxPath={sandbox.sandboxPath}
          setSandboxPath={sandbox.setSandboxPath}
          sandboxLsOut={sandbox.sandboxLsOut}
          sandboxFilePath={sandbox.sandboxFilePath}
          setSandboxFilePath={sandbox.setSandboxFilePath}
          sandboxFileContent={sandbox.sandboxFileContent}
          setSandboxFileContent={sandbox.setSandboxFileContent}
          onEnsureSandbox={() => void sandbox.doEnsureSandbox()}
          onOpenDesktop={() => void sandbox.doOpenDesktop()}
          onCheckpointSandbox={() => void sandbox.doCheckpointSandbox()}
          onStopSandbox={() => void sandbox.doStopSandbox()}
          onResetSandbox={() => void sandbox.doResetSandbox()}
          onRefreshSandbox={() =>
            void sandbox.refreshSandbox().catch((err) =>
              sandbox.setSandboxMsg(err instanceof Error ? err.message : String(err)),
            )
          }
          onExecSandbox={sandbox.doExecSandbox}
          onLsSandbox={() => void sandbox.doLsSandbox()}
          onWriteSandboxFile={() => void sandbox.doWriteSandboxFile()}
          onReadSandboxFile={() => void sandbox.doReadSandboxFile()}
        />
      )}

      {settingsTab === "machines" && (
        <MachinesSettingsTab
          clientEnv={clientEnv}
          machines={machines.machines}
          hostMachineId={hostMachineId}
          deviceDisplayName={machines.deviceDisplayName}
          currentMachineDraft={machines.currentMachineDraft}
          onCurrentMachineDraftChange={machines.setCurrentMachineDraft}
          hostExecPolicy={hostExecPolicy}
          hostWritesOn={hostWritesOn}
          machinesBusy={machines.machinesBusy}
          machinesMsg={machines.machinesMsg}
          renamingMachineId={machines.renamingMachineId}
          renameDraft={machines.renameDraft}
          onRenameDraftChange={machines.setRenameDraft}
          onRefreshMachines={machines.onRefreshMachines}
          onReregisterHost={machines.onReregisterHost}
          onSaveCurrentMachineName={machines.onSaveCurrentMachineName}
          onHostExecPolicyChange={machines.onHostExecPolicyChange}
          onStartRename={machines.onStartRename}
          onCancelRename={machines.onCancelRename}
          onSaveRename={machines.onSaveRename}
          onDeleteMachine={machines.onDeleteMachine}
        />
      )}

      {settingsTab === "secrets" && (
        <SecretsSettingsTab
          secretFormName={secrets.secretFormName}
          setSecretFormName={secrets.setSecretFormName}
          secretFormOrigin={secrets.secretFormOrigin}
          setSecretFormOrigin={secrets.setSecretFormOrigin}
          secretFormValue={secrets.secretFormValue}
          setSecretFormValue={secrets.setSecretFormValue}
          botSecrets={secrets.botSecrets}
          secretRequests={secrets.secretRequests}
          secretMsg={secrets.secretMsg}
          onSubmitSecret={secrets.onSubmitSecret}
          onDeleteSecret={secrets.onDeleteSecret}
        />
      )}
    </AppSettingsDialog>
  );
}
