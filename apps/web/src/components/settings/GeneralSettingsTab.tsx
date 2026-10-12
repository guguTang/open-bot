import type { UserSettings } from "../../api";
import { accountInitials } from "../app/accountInitials";
import { ApiServerField } from "../ApiServerField";
import { GeneralBotSettings } from "../GeneralBotSettings";
import {
  SettingsCard,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type GeneralSettingsTabProps = {
  sheetForm: boolean;
  settingsGeneralPane: "account" | "server" | "review";
  username: string;
  email?: string | null;
  emailCopied: boolean;
  onCopyEmail: () => void;
  onLogout: () => void;
  onApiServerApplied: () => void;
  defaultModelLabel: string;
  onOpenLlmSettings: () => void;
  onHostExecSettingsChange: (s: UserSettings) => void;
};

export function GeneralSettingsTab({
  sheetForm,
  settingsGeneralPane,
  username,
  email,
  emailCopied,
  onCopyEmail,
  onLogout,
  onApiServerApplied,
  defaultModelLabel,
  onOpenLlmSettings,
  onHostExecSettingsChange,
}: GeneralSettingsTabProps) {
  return (
    <SettingsPage>
      {(!sheetForm || settingsGeneralPane === "account") && (
        <SettingsSection title={sheetForm ? undefined : "账户"}>
          <SettingsCard className="settings-account">
            <div className="settings-account-avatar" aria-hidden>
              {accountInitials(username)}
            </div>
            <div className="settings-account-main">
              <div className="settings-account-name">{username || "账户"}</div>
              {email ? (
                <div className="settings-account-email">
                  <span>{email}</span>
                  <button
                    type="button"
                    className="settings-icon-btn"
                    title={emailCopied ? "已复制" : "复制邮箱"}
                    aria-label="复制邮箱"
                    onClick={onCopyEmail}
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
            <ApiServerField variant="settings" onApplied={onApiServerApplied} />
          </SettingsCard>
        </SettingsSection>
      )}
      {!sheetForm ? (
        <SettingsSection title="模型">
          <SettingsCard>
            <div className="settings-row">
              <span>默认模型</span>
              <button type="button" className="settings-pill" onClick={onOpenLlmSettings}>
                {defaultModelLabel}
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
            onSettingsChange={onHostExecSettingsChange}
          />
        </>
      )}
    </SettingsPage>
  );
}
