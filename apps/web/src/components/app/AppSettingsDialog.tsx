import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import type { Agent, User } from "../../api";
import type { SettingsTab } from "../../types/app-ui";
import { SETTINGS_TITLE } from "../../types/app-ui";
import { MobileSettingsHub, type SettingsHubNav } from "../MobileSettingsHub";
import { SettingsGlyph } from "./SettingsGlyph";
import { accountInitials } from "./accountInitials";
import { getApiBase } from "../../api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
  const apiBaseLabel = (() => {
    const raw = getApiBase().replace(/^https?:\/\//i, "");
    return raw.length > 28 ? `${raw.slice(0, 27)}…` : raw;
  })();

  const heading = sheetForm
    ? settingsSubheadTitle(settingsTab, settingsGeneralPane)
    : SETTINGS_TITLE[settingsTab];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName={cn(sheetForm && "settings-backdrop-shell")}
        className={cn(
          "modal settings-dialog max-w-none gap-0 overflow-hidden p-0 sm:max-w-none",
          sheetForm && "settings-dialog-shell",
        )}
      >
        <DialogDescription className="sr-only">应用设置</DialogDescription>
        {sheetForm && settingsShellHub ? (
          <>
            <DialogTitle className="sr-only">设置</DialogTitle>
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
          </>
        ) : null}
        {sheetForm && !settingsShellHub ? (
          <div className="settings-shell-subhead">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="settings-shell-back"
              aria-label="返回"
              onClick={onSystemBack}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <DialogTitle>{heading}</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="settings-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : null}
        {!(sheetForm && settingsShellHub) ? (
          <>
            <nav
              className={cn("settings-nav", sheetForm && "settings-nav-hidden")}
              aria-label="设置分类"
            >
              {SETTINGS_NAV.map(([id, label]) => (
                <Button
                  key={id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "justify-start",
                    settingsTab === id && "active",
                  )}
                  onClick={() => onSelectTab(id)}
                >
                  <SettingsGlyph id={id} />
                  <span>{label}</span>
                </Button>
              ))}
            </nav>
            <div className="settings-main">
              {!sheetForm ? (
                <div className="settings-main-head">
                  <DialogTitle>{heading}</DialogTitle>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="settings-close"
                    aria-label="关闭"
                    onClick={onClose}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
              ) : null}
              <div className="settings-main-body">{children}</div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
