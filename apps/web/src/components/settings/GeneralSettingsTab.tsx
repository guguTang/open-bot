import { ChevronDown, Copy } from "lucide-react";
import type { UserSettings } from "../../api";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldLabel,
} from "@/components/ui/field";
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="settings-icon-btn size-7"
                    title={emailCopied ? "已复制" : "复制邮箱"}
                    aria-label="复制邮箱"
                    onClick={onCopyEmail}
                  >
                    <Copy data-icon="inline-start" aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onLogout}>
              退出登录
            </Button>
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
            <Field orientation="horizontal" className="settings-row px-1">
              <FieldLabel>默认模型</FieldLabel>
              <Button type="button" variant="outline" size="sm" onClick={onOpenLlmSettings}>
                {defaultModelLabel}
                <ChevronDown data-icon="inline-end" aria-hidden />
              </Button>
            </Field>
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
