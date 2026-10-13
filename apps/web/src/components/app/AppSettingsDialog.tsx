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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_NAV.some(([id]) => id === value);
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

  const showHub = sheetForm && settingsShellHub;
  const showSubhead = sheetForm && !settingsShellHub;

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

        {showHub ? (
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

        {showSubhead ? (
          <header className="settings-shell-subhead">
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
            <DialogTitle className="text-center text-base font-semibold tracking-tight">
              {heading}
            </DialogTitle>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="settings-close"
                aria-label="关闭"
              >
                <X aria-hidden />
              </Button>
            </DialogClose>
          </header>
        ) : null}

        {!showHub ? (
          <Tabs
            orientation="vertical"
            value={settingsTab}
            onValueChange={(value) => {
              if (isSettingsTab(value)) onSelectTab(value);
            }}
            className="settings-tabs gap-0"
          >
            <aside
              className={cn("settings-nav", sheetForm && "settings-nav-hidden")}
              aria-label="设置分类"
            >
              <ScrollArea className="h-full">
                <TabsList
                  variant="default"
                  className="h-auto w-full flex-col items-stretch gap-0.5 rounded-none bg-transparent p-0 max-[720px]:w-max max-[720px]:flex-row"
                >
                  {SETTINGS_NAV.map(([id, label]) => (
                    <TabsTrigger
                      key={id}
                      value={id}
                      className="h-auto flex-none justify-start gap-2.5 px-3 py-2 text-[14px] font-medium"
                    >
                      <SettingsGlyph id={id} />
                      <span>{label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </ScrollArea>
            </aside>

            <Separator
              orientation="vertical"
              className="settings-tabs-separator hidden min-[721px]:block"
            />

            <TabsContent
              value={settingsTab}
              forceMount
              className="settings-main mt-0 flex min-h-0 min-w-0 flex-col outline-none data-[state=inactive]:hidden"
            >
              {!sheetForm ? (
                <DialogHeader className="settings-main-head flex-row items-center justify-between text-left">
                  <DialogTitle className="text-xl font-semibold tracking-tight">
                    {heading}
                  </DialogTitle>
                  <DialogClose asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="settings-close"
                      aria-label="关闭"
                    >
                      <X aria-hidden />
                    </Button>
                  </DialogClose>
                </DialogHeader>
              ) : null}
              <div className="settings-main-body">
                <div className="settings-main-body-inner">{children}</div>
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
