import { ChevronsUpDown, Cpu, LogOut, Monitor, Moon, Settings, Sun, Wrench } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="账户菜单"
        className="flex w-full items-center gap-2 rounded-lg p-2 text-left outline-none transition-colors hover:bg-default focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-default"
      >
        <Avatar size="sm" className="rounded-md">
          <AvatarFallback className="rounded-md text-xs font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{username}</span>
          {/* Model lives under「更改模型」— avoid duplicating a long model id in the footer. */}
          {!llm ? <span className="truncate text-xs text-warning">未配置模型</span> : null}
        </div>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-60">
        <DropdownMenuItem onSelect={() => onChangeModel()}>
          <Cpu className="size-4 text-muted" aria-hidden />
          更改模型
        </DropdownMenuItem>
        {onOpenMicroApps ? (
          <DropdownMenuItem onSelect={() => onOpenMicroApps()}>
            <Wrench className="size-4 text-muted" aria-hidden />
            我的工具
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => onOpenSettings()}>
          <Settings className="size-4 text-muted" aria-hidden />
          设置
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>外观</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setThemePreference(value as ThemePreference)}
        >
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4 text-muted" aria-hidden />
            跟随系统
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4 text-muted" aria-hidden />
            浅色
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4 text-muted" aria-hidden />
            深色
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onLogout()}>
          <LogOut className="size-4" aria-hidden />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
