import type { KeyboardEvent } from "react";
import type { Machine } from "../../api";
import {
  type ClientContext,
  isLoginOnlyMachine,
  machineIsOnline,
  resolveClientDeviceType,
  shouldRegisterAsHost,
} from "../../lib/clientEnv";
import {
  MACHINE_EXEC_POLICY_OPTIONS,
  normalizeMachineExecPolicy,
  type MachineExecPolicy,
} from "../../lib/userSettings";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export interface MachinesSettingsTabProps {
  clientEnv: ClientContext;
  machines: Machine[];
  hostMachineId: string | null;
  deviceDisplayName: string;
  currentMachineDraft: string;
  onCurrentMachineDraftChange: (value: string) => void;
  hostExecPolicy: MachineExecPolicy;
  hostWritesOn: boolean;
  machinesBusy: boolean;
  machinesMsg: string;
  renamingMachineId: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onRefreshMachines: () => void;
  onReregisterHost: () => void;
  onSaveCurrentMachineName: () => void;
  onHostExecPolicyChange: (policy: MachineExecPolicy) => void;
  onStartRename: (machineId: string, currentLabel: string) => void;
  onCancelRename: () => void;
  onSaveRename: (machineId: string) => void;
  onDeleteMachine: (machine: Machine) => void;
}

type CurrentMachineSectionProps = Pick<
  MachinesSettingsTabProps,
  | "clientEnv"
  | "machines"
  | "hostMachineId"
  | "deviceDisplayName"
  | "currentMachineDraft"
  | "onCurrentMachineDraftChange"
  | "hostExecPolicy"
  | "hostWritesOn"
  | "machinesBusy"
  | "onSaveCurrentMachineName"
  | "onHostExecPolicyChange"
>;

function CurrentMachineSection({
  clientEnv,
  machines,
  hostMachineId,
  deviceDisplayName,
  currentMachineDraft,
  onCurrentMachineDraftChange,
  hostExecPolicy,
  hostWritesOn,
  machinesBusy,
  onSaveCurrentMachineName,
  onHostExecPolicyChange,
}: CurrentMachineSectionProps) {
  const current = hostMachineId ? machines.find((x) => x.id === hostMachineId) : null;

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
    resolveClientDeviceType(clientEnv) === "mobile" || clientEnv.app === "capacitor";

  if (loginOnlyHere) {
    return (
      <SettingsSection title="当前设备">
        <SettingsCard padded>
          <div className="bot-general-settings">
            <div className="settings-row bot-settings-row">
              <div className="bot-settings-copy">
                <div className="bot-settings-title">{current?.label || deviceDisplayName || "本机"}</div>
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
              <div className="bot-settings-desc">尚未登记本机。点击下方「重新注册本机」以出现在设备列表。</div>
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
                onChange={(e) => onCurrentMachineDraftChange(e.target.value)}
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
                onClick={onSaveCurrentMachineName}
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
                onHostExecPolicyChange(normalizeMachineExecPolicy(e.target.value));
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
            <div className="bot-settings-desc">尚未登记本机。点击下方「重新注册本机」以启用。</div>
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
}

export function MachinesSettingsTab({
  clientEnv,
  machines,
  hostMachineId,
  deviceDisplayName,
  currentMachineDraft,
  onCurrentMachineDraftChange,
  hostExecPolicy,
  hostWritesOn,
  machinesBusy,
  machinesMsg,
  renamingMachineId,
  renameDraft,
  onRenameDraftChange,
  onRefreshMachines,
  onReregisterHost,
  onSaveCurrentMachineName,
  onHostExecPolicyChange,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onDeleteMachine,
}: MachinesSettingsTabProps) {
  const onRenameKeyDown = (machineId: string, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!renameDraft.trim()) return;
      onSaveRename(machineId);
    } else if (e.key === "Escape") {
      onCancelRename();
    }
  };

  return (
    <SettingsPage>
      <SettingsHint>
        桌面端登录后会连上本机文件通道；网页不会登记为电脑。操作仍经「通用 → Bot → 自动审核」检查（硬拒绝始终有效）。当前客户端：
        {clientEnv.platform} / {clientEnv.app}
        {shouldRegisterAsHost(clientEnv) ? "（会自动注册）" : "（浏览器，不自动注册）"}。
        手机只用来登录聊天，本地文件和命令在已连接的电脑上跑。
      </SettingsHint>

      <CurrentMachineSection
        clientEnv={clientEnv}
        machines={machines}
        hostMachineId={hostMachineId}
        deviceDisplayName={deviceDisplayName}
        currentMachineDraft={currentMachineDraft}
        onCurrentMachineDraftChange={onCurrentMachineDraftChange}
        hostExecPolicy={hostExecPolicy}
        hostWritesOn={hostWritesOn}
        machinesBusy={machinesBusy}
        onSaveCurrentMachineName={onSaveCurrentMachineName}
        onHostExecPolicyChange={onHostExecPolicyChange}
      />

      <SettingsSection
        title="已注册"
        actions={
          <>
            <button type="button" onClick={onRefreshMachines} disabled={machinesBusy}>
              刷新
            </button>
            {shouldRegisterAsHost(clientEnv) ? (
              <button type="button" className="primary" disabled={machinesBusy} onClick={onReregisterHost}>
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
                          onChange={(e) => onRenameDraftChange(e.target.value)}
                          maxLength={64}
                          placeholder="设备名称"
                          autoFocus
                          onKeyDown={(e) => onRenameKeyDown(m.id, e)}
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
                          onClick={() => onSaveRename(m.id)}
                        >
                          保存
                        </button>
                        <button type="button" disabled={machinesBusy} onClick={onCancelRename}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={machinesBusy}
                        onClick={() => onStartRename(m.id, m.label)}
                      >
                        重命名
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      disabled={machinesBusy}
                      onClick={() => onDeleteMachine(m)}
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
  );
}
