import { useState, type KeyboardEvent } from "react";
import type { Machine } from "../../api";
import { openDesktopPrivacyPane, shouldShowDesktopCapturePermissions } from "../../lib/desktopPrivacy";
import {
  type ClientContext,
  isLoginOnlyMachine,
  machineIsOnline,
  resolveClientDeviceType,
  shouldRegisterAsHost,
} from "../../lib/clientEnv";
import { formatRelativeTime } from "../../lib/formatTime";
import {
  MACHINE_EXEC_POLICY_OPTIONS,
  normalizeMachineExecPolicy,
  type MachineExecPolicy,
} from "../../lib/userSettings";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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

function DesktopCapturePermissions({ clientEnv }: { clientEnv: ClientContext }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!shouldShowDesktopCapturePermissions(clientEnv)) return null;

  const open = (pane: "screen" | "accessibility") => {
    setBusy(true);
    setMsg("");
    void openDesktopPrivacyPane(pane)
      .catch((err: unknown) => {
        setMsg(err instanceof Error ? err.message : "无法打开系统设置");
      })
      .finally(() => setBusy(false));
  };

  return (
    <SettingsSection title="屏幕录制与辅助功能">
      <SettingsCard padded>
        <FieldGroup>
          <FieldDescription>
            助手要看到这台 Mac 的画面，需要在「系统设置 → 隐私与安全性 → 屏幕录制」里允许 Open Bot。
            通过辅助功能点按钮、读控件时，还要允许「辅助功能」。授权后回到对话里再试一次。手机和浏览器不能截这台电脑的屏幕。
          </FieldDescription>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => open("screen")}>
              打开「屏幕录制」
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => open("accessibility")}
            >
              打开「辅助功能」
            </Button>
          </div>
          {msg ? <FieldDescription>{msg}</FieldDescription> : null}
        </FieldGroup>
      </SettingsCard>
    </SettingsSection>
  );
}

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
          <FieldDescription>
            浏览器不能作为本机执行通道。请用桌面应用打开并保持在线。
          </FieldDescription>
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
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>{current?.label || deviceDisplayName || "本机"}</FieldTitle>
                <FieldDescription>
                  手机只用来登录聊天；本地文件和命令请在已连接的电脑上跑。
                </FieldDescription>
              </FieldContent>
              <div className="flex flex-wrap gap-1">
                <span className="tag machine-login-only">仅登录</span>
                {current ? (
                  machineIsOnline(current) ? (
                    <span className="tag machine-online">在线</span>
                  ) : (
                    <span className="tag machine-offline">离线</span>
                  )
                ) : null}
              </div>
            </Field>
            {!current ? (
              <FieldDescription>
                尚未登记本机。点击下方「重新注册本机」以出现在设备列表。
              </FieldDescription>
            ) : null}
          </FieldGroup>
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="当前电脑">
      <SettingsCard padded>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>名称</FieldTitle>
              <FieldDescription>
                显示给 Bot 的设备名（如系统主机名）。保存后同步到已注册列表。
              </FieldDescription>
            </FieldContent>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-auto min-w-40"
                value={currentMachineDraft}
                onChange={(e) => onCurrentMachineDraftChange(e.target.value)}
                maxLength={64}
                placeholder={deviceDisplayName || "设备名称"}
                disabled={machinesBusy || !current}
              />
              <Button
                type="button"
                disabled={
                  machinesBusy ||
                  !current ||
                  !currentMachineDraft.trim() ||
                  currentMachineDraft.trim() === current.label
                }
                onClick={onSaveCurrentMachineName}
              >
                保存
              </Button>
            </div>
          </Field>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>在这台电脑上执行</FieldTitle>
              <FieldDescription>
                始终允许：除硬拒绝（curl|sh、rm -rf /、mkfs）外直接执行，不弹确认卡。用户规则「先询问」命中时仍会确认。
              </FieldDescription>
            </FieldContent>
            <NativeSelect
              value={hostExecPolicy}
              disabled={machinesBusy || !current}
              aria-label="在这台电脑上执行"
              onChange={(e) => {
                if (!current) return;
                onHostExecPolicyChange(normalizeMachineExecPolicy(e.target.value));
              }}
            >
              {MACHINE_EXEC_POLICY_OPTIONS.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {!current ? (
            <FieldDescription>
              尚未登记本机。点击下方「重新注册本机」以启用。
            </FieldDescription>
          ) : (
            <FieldDescription>
              状态：
              {machineIsOnline(current) ? "在线" : "离线"}
              {current.connected ? " · 可操作" : ""}
              {current.platform ? ` · ${current.platform}` : ""}
              {hostWritesOn ? "" : " · 本机写入已关"}
            </FieldDescription>
          )}
        </FieldGroup>
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

      <DesktopCapturePermissions clientEnv={clientEnv} />

      <SettingsSection
        title="已注册"
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={onRefreshMachines} disabled={machinesBusy}>
              刷新
            </Button>
            {shouldRegisterAsHost(clientEnv) ? (
              <Button type="button" size="sm" disabled={machinesBusy} onClick={onReregisterHost}>
                重新注册本机
              </Button>
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
                  <div className="min-w-0 flex-1">
                    {renamingMachineId === m.id ? (
                      <Field className="mb-1 max-w-sm">
                        <FieldLabel htmlFor={`rename-${m.id}`}>设备名称</FieldLabel>
                        <Input
                          id={`rename-${m.id}`}
                          value={renameDraft}
                          onChange={(e) => onRenameDraftChange(e.target.value)}
                          maxLength={64}
                          placeholder="例如：MacBook Pro"
                          autoFocus
                          onKeyDown={(e) => onRenameKeyDown(m.id, e)}
                        />
                      </Field>
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
                    <div className="agent-desc whitespace-normal overflow-visible wrap-anywhere">
                      {m.platform}
                      {m.os ? ` · ${m.os}` : ""}
                      {m.arch ? ` · ${m.arch}` : ""}
                      {m.app ? ` · ${m.app}` : ""}
                      {m.device_type ? ` · ${m.device_type}` : ""}
                      {isLoginOnlyMachine(m)
                        ? ""
                        : ` · ${normalizeMachineExecPolicy(m.exec_policy) === "allow" ? "始终允许" : normalizeMachineExecPolicy(m.exec_policy) === "ask" ? "每次询问" : "不允许"}`}
                      {m.last_seen ? ` · 最近 ${formatRelativeTime(m.last_seen)}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {renamingMachineId === m.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={machinesBusy || !renameDraft.trim()}
                          onClick={() => onSaveRename(m.id)}
                        >
                          保存
                        </Button>
                        <Button type="button" variant="ghost" size="sm" disabled={machinesBusy} onClick={onCancelRename}>
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={machinesBusy}
                        onClick={() => onStartRename(m.id, m.label)}
                      >
                        重命名
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={machinesBusy}
                      onClick={() => onDeleteMachine(m)}
                    >
                      {isLoginOnlyMachine(m) ? "移除" : "删除"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {machinesMsg ? <p className="settings-status m-0">{machinesMsg}</p> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
