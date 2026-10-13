import { ChevronsUpDown, Cpu, LogOut, Settings } from "lucide-react";
import type { LLMConnection } from "../api";
import { accountInitials } from "./app/accountInitials";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  username: string;
  llm?: LLMConnection;
  onOpenSettings: () => void;
  onChangeModel: () => void;
  onLogout: () => void;
};

export function AccountMenu({ username, llm, onOpenSettings, onChangeModel, onLogout }: AccountMenuProps) {
  const modelLabel = llm?.model || llm?.name || "未配置模型";
  const initials = accountInitials(username);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent p-2 text-left shadow-none outline-none",
            "hover:bg-accent hover:text-accent-foreground",
            "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
            "focus-visible:ring-0 focus-visible:outline-none",
          )}
          aria-label="账户菜单"
        >
          <Avatar className="size-8 rounded-md">
            <AvatarFallback className="rounded-md bg-muted text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{username}</span>
            <span
              className={cn(
                "truncate text-xs text-muted-foreground",
                !llm && "text-amber-700",
              )}
            >
              {modelLabel}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-md border-0 shadow-md"
        side="top"
        align="start"
        sideOffset={4}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md bg-muted text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{username}</span>
              <span
                className={cn(
                  "truncate text-xs text-muted-foreground",
                  !llm && "text-amber-700",
                )}
              >
                {modelLabel}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onChangeModel}>
            <Cpu />
            更改模型
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings />
            设置
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
