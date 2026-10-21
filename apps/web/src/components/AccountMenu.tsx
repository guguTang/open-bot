import { ChevronsUpDown, Cpu, LogOut, Monitor, Moon, Settings, Sun, Wrench } from "lucide-react";
import { Avatar, Dropdown, Header, Label, Separator } from "@heroui/react";
import type { Key } from "react-aria-components";
import type { LLMConnection } from "../api";
import { accountInitials } from "./app/accountInitials";
import { setThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

type AccountMenuProps = {
  username: string;
  llm?: LLMConnection;
  onOpenSettings: () => void;
  onChangeModel: () => void;
  onOpenMicroApps?: () => void;
  onLogout: () => void;
};

export function AccountMenu({ username, llm, onOpenSettings, onChangeModel, onOpenMicroApps, onLogout }: AccountMenuProps) {
  const initials = accountInitials(username);
  const theme = useThemePreference();

  const onAction = (key: Key) => {
    if (key === "model") onChangeModel();
    else if (key === "apps") onOpenMicroApps?.();
    else if (key === "settings") onOpenSettings();
    else if (key === "logout") onLogout();
  };

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="账户菜单"
        className="flex w-full items-center gap-2 rounded-lg p-2 text-left outline-none transition-colors hover:bg-default data-[pressed=true]:bg-default data-[focus-visible=true]:ring-2 data-[focus-visible=true]:ring-focus"
      >
        <Avatar size="sm" className="rounded-md">
          <Avatar.Fallback className="rounded-md text-xs font-semibold">{initials}</Avatar.Fallback>
        </Avatar>
        <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{username}</span>
          {/* Model lives under「更改模型」— avoid duplicating a long model id in the footer. */}
          {!llm ? <span className="truncate text-xs text-warning">未配置模型</span> : null}
        </div>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top start" className="min-w-60">
        <Dropdown.Menu aria-label="账户" onAction={onAction}>
          <Dropdown.Item id="model" textValue="更改模型">
            <Cpu className="size-4 text-muted" aria-hidden />
            <Label>更改模型</Label>
          </Dropdown.Item>
          {onOpenMicroApps ? (
            <Dropdown.Item id="apps" textValue="我的工具">
              <Wrench className="size-4 text-muted" aria-hidden />
              <Label>我的工具</Label>
            </Dropdown.Item>
          ) : null}
          <Dropdown.Item id="settings" textValue="设置">
            <Settings className="size-4 text-muted" aria-hidden />
            <Label>设置</Label>
          </Dropdown.Item>
          <Separator />
          <Dropdown.Section
            selectionMode="single"
            selectedKeys={new Set([theme])}
            onSelectionChange={(keys) => {
              const k = [...(keys as Set<Key>)][0];
              if (k) setThemePreference(k as ThemePreference);
            }}
          >
            <Header>外观</Header>
            <Dropdown.Item id="system" textValue="跟随系统">
              <Monitor className="size-4 text-muted" aria-hidden />
              <Label>跟随系统</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
            <Dropdown.Item id="light" textValue="浅色">
              <Sun className="size-4 text-muted" aria-hidden />
              <Label>浅色</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
            <Dropdown.Item id="dark" textValue="深色">
              <Moon className="size-4 text-muted" aria-hidden />
              <Label>深色</Label>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          </Dropdown.Section>
          <Separator />
          <Dropdown.Item id="logout" textValue="退出登录" variant="danger">
            <LogOut className="size-4" aria-hidden />
            <Label>退出登录</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
