import type { ReactNode } from "react";
import type { Agent, User } from "../../api";
import type { SettingsTab } from "../../types/app-ui";
import { SETTINGS_TITLE } from "../../types/app-ui";
import { MobileSettingsHub, type SettingsHubNav } from "../MobileSettingsHub";
import { SettingsGlyph } from "./SettingsGlyph";
import { accountInitials } from "./accountInitials";
import { getApiBase } from "../../api";

const SETTINGS_NAV: ReadonlyArray<readonly [SettingsTab, string]> = [
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
  ["integrations", "连接应用"],
];

export type AppSettingsDialogProps = {
  open: boolean;
  sheetForm: boolean;
  settingsShellHub: boolean;
  settingsTab: SettingsTab;
  settingsGeneralPane: "account" | "server" | "review";
  user: User | null;
  activeAgent: Agent | null | undefined;
  agents: Agent[];
  preferredMachineLabel?: string;
  onClose: () => void;
  onSelectTab: (tab: SettingsTab) => void;
  onHubNavigate: (tab: SettingsHubNav) => void;
  onOpenBotAvatar: () => void;
  onLogout: () => void;
  onSystemBack: () => void;
  children: ReactNode;
};

function settingsSubheadTitle(
  settingsTab: SettingsTab,
  settingsGeneralPane: "account" | "server" | "review",
): string {
  if (settingsTab !== "general") return SETTINGS_TITLE[settingsTab];
  if (settingsGeneralPane === "account") return "账户";
  if (settingsGeneralPane === "server") return "服务器";
  return "时区与自动审核";
}

export function AppSettingsDialog({
  open,
  sheetForm,
  settingsShellHub,
  settingsTab,
  settingsGeneralPane,
  user,
  activeAgent,
  agents,
  preferredMachineLabel,
  onClose,
  onSelectTab,
  onHubNavigate,
  onOpenBotAvatar,
  onLogout,
  onSystemBack,
  children,
}: AppSettingsDialogProps) {
  if (!open) return null;

  const apiBaseLabel = (() => {
    const raw = getApiBase().replace(/^https?:\/\//i, "");
    return raw.length > 28 ? `${raw.slice(0, 27)}…` : raw;
  })();

  return (
    <div
      className={`modal-backdrop${sheetForm ? " settings-backdrop-shell" : ""}`}
      onClick={onClose}
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
            preferredMachineLabel={preferredMachineLabel}
            apiBaseLabel={apiBaseLabel}
            onClose={onClose}
            onOpenBotAvatar={onOpenBotAvatar}
            onLogout={() => {
              onClose();
              onLogout();
            }}
            onNavigate={onHubNavigate}
          />
        ) : null}
        {sheetForm && !settingsShellHub ? (
          <div className="settings-shell-subhead">
            <button
              type="button"
              className="settings-shell-back"
              aria-label="返回"
              onClick={onSystemBack}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h2>{settingsSubheadTitle(settingsTab, settingsGeneralPane)}</h2>
            <button type="button" className="settings-close" aria-label="关闭" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        ) : null}
        {!(sheetForm && settingsShellHub) ? (
          <>
            <nav className={`settings-nav${sheetForm ? " settings-nav-hidden" : ""}`} aria-label="设置分类">
              {SETTINGS_NAV.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={settingsTab === id ? "active" : ""}
                  onClick={() => onSelectTab(id)}
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
                  <button type="button" className="settings-close" aria-label="关闭" onClick={onClose}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              ) : null}
              <div className="settings-main-body">{children}</div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
