import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AppSettingsBundle } from "../../hooks/useAppSettings";
import { patchShell, useShellStore } from "../../stores/shell";
import { useSheetFormUi } from "../useIsTouchUi";
import { McpSettingsTab } from "../settings/McpSettingsTab";
import { ConnectAppsMarket } from "./ConnectAppsMarket";

/** Independent「连接应用」shell. Settings and the sidebar both open this one tree. */
export function ConnectAppsShell({ settings }: { settings: AppSettingsBundle }) {
  const open = useShellStore((s) => s.connectAppsOpen);
  const focus = useShellStore((s) => s.connectAppsFocus);
  const sheetForm = useSheetFormUi();
  const { integrations, mcp, shell } = settings;
  const prefetchIntegrations = shell.prefetch;
  const setMsg = integrations.setMsg;

  useEffect(() => {
    if (!open) return;
    // OAuth return sets a focus before this effect; a plain open should not keep an old banner.
    if (!useShellStore.getState().connectAppsFocus) setMsg("");
    void prefetchIntegrations("integrations");
  }, [open, prefetchIntegrations, setMsg]);

  function close() {
    patchShell({ connectAppsOpen: false, connectAppsFocus: null });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName={cn(sheetForm && "settings-backdrop-shell")}
        className={cn(
          "modal settings-dialog connect-apps-dialog flex min-h-0 flex-col max-w-none gap-0 overflow-clip border-0 p-0 sm:max-w-none",
          sheetForm && "settings-dialog-shell",
        )}
      >
        <DialogTitle className="sr-only">连接应用</DialogTitle>
        <DialogDescription className="sr-only">
          搜索并连接 Gmail、Slack、Telegram、飞书和 GitHub。
        </DialogDescription>
        {open ? (
          <ConnectAppsMarket
            sheetForm={sheetForm}
            focus={focus}
            onFocusConsumed={() => patchShell({ connectAppsFocus: null })}
            onClose={close}
            onRevealAdvanced={() => void shell.prefetch("mcp")}
            advanced={
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
            }
            gmail={integrations.gmail}
            slack={integrations.slack}
            github={integrations.github}
            telegram={integrations.telegram}
            feishu={integrations.feishu}
            busy={integrations.busy}
            loading={integrations.loading}
            loadError={integrations.loadError}
            slackLoadError={integrations.slackLoadError}
            githubLoadError={integrations.githubLoadError}
            telegramLoadError={integrations.telegramLoadError}
            feishuLoadError={integrations.feishuLoadError}
            msg={integrations.msg}
            onConnectGmail={integrations.connectGmail}
            onDisconnectGmail={integrations.disconnect}
            onConnectSlack={integrations.connectSlack}
            onDisconnectSlack={integrations.disconnectSlack}
            onConnectGitHub={integrations.connectGitHub}
            onAttachGitHub={integrations.attachGitHub}
            onDisconnectGitHub={integrations.disconnectGitHub}
            onConnectTelegram={integrations.connectTelegramBot}
            onDisconnectTelegram={integrations.disconnectTelegram}
            onConnectFeishu={integrations.connectFeishuApp}
            onDisconnectFeishu={integrations.disconnectFeishu}
            onCopy={integrations.copyText}
            onRefresh={integrations.refresh}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
