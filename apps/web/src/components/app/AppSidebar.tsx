import { ChevronDown, Copy, Plus, Search, Settings, Trash2 } from "lucide-react";
import { memo, useDeferredValue, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { SearchField } from "@/components/ui/search-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Agent, Channel } from "../../api";
import { runSearchHints } from "../../lib/runFace";
import { AccountMenu } from "../AccountMenu";
import { AgentAvatar } from "../AgentAvatar";
import { useIsNarrowLayout, useIsTouchUi, useSheetFormUi } from "../useIsTouchUi";
import {
  channelMemberStackClass,
  runBusyDotClass,
  sidebarAsideClass,
  sidebarIconBtnClass,
  sidebarListClass,
} from "./sidebarUi";
import { useConvLongPressHandlers } from "../../hooks/useConvLongPress";
import { useChatStore } from "../../stores/chat";
import { botIsOnline, usePresenceStore } from "../../stores/presence";
import { sessionActions } from "../../stores/sessionActions";
import { useShellStore } from "../../stores/shell";
import { useMicroAppsStore } from "../../stores/microApps";
import { MicroAppShortcuts } from "../MicroAppShortcuts";
import { isCapacitorNative } from "../../lib/microApp/capabilities";
import { useWorkspaceStore } from "../../stores/workspace";
import { agentNameMap, channelMemberProfiles, resolveActiveAgent } from "../../lib/app/workspaceDerived";
import { cn } from "@/lib/utils";
import { accountInitials } from "./accountInitials";

export type ConvLongPressTarget =
  | { kind: "agent"; agent: Agent }
  | { kind: "channel"; channel: Channel };

export type ChannelMemberProfile = {
  agent_id: string;
  name: string;
  avatar_shape?: Agent["avatar_shape"];
  avatar_color?: Agent["avatar_color"];
  online?: boolean;
};

type ConvListItem =
  | { kind: "agent"; agent: Agent; sortAt: number }
  | { kind: "channel"; channel: Channel; sortAt: number };

function itemSortAt(iso?: string | null) {
  return Date.parse(iso || "") || 0;
}

function AppSidebarInner() {
  const user = useWorkspaceStore((s) => s.user);
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const channels = useWorkspaceStore((s) => s.channels);
  const agentBusy = useWorkspaceStore((s) => s.agentBusy);
  const channelBusy = useWorkspaceStore((s) => s.channelBusy);
  const busySelectionKeys = useWorkspaceStore((s) => s.busySelectionKeys);
  const defaultLLM = useWorkspaceStore((s) => s.defaultLLM);
  const hostActivity = useShellStore((s) => s.hostActivity);
  const createSheetOpen = useShellStore((s) => s.createSheetOpen);
  const showNewChat = useShellStore((s) => s.showNewChat);
  const convSearch = useShellStore((s) => s.convSearch);
  const setConvSearch = useShellStore((s) => s.setConvSearch);
  const presenceByAgent = usePresenceStore((s) => s.presenceByAgent);
  const onlineByAgent = usePresenceStore((s) => s.onlineByAgent);
  const runFaceAgentId = useChatStore((s) => s.runFaceAgentId);
  const runActiveTool = useChatStore((s) => s.runActiveTool);

  const sheetForm = useSheetFormUi();
  const touchUi = useIsTouchUi();
  const isNarrowLayout = useIsNarrowLayout();
  const mobileView = useShellStore((s) => s.mobileView);
  const touchOrSheet = touchUi || sheetForm;
  const { beginConvLongPress, moveConvLongPress, endConvLongPress } = useConvLongPressHandlers(touchUi);

  const actions = sessionActions();
  const activeAgent = resolveActiveAgent(agentId, agents);
  const agentNameById = useMemo(() => agentNameMap(agents), [agents]);
  const searchHints = runSearchHints({
    faceAgentId: runFaceAgentId,
    isGroup: Boolean(conversation?.channel_id),
    activeAgentId: activeAgent?.id,
    runActiveTool,
    hostActivity,
  });
  const isBotOnline = (id?: string | null, snapshot?: boolean) => botIsOnline(onlineByAgent, agents, id, snapshot);
  const deferredConvSearch = useDeferredValue(convSearch);
  const convItems = useMemo(() => {
    const q = deferredConvSearch.trim().toLowerCase();
    const items: ConvListItem[] = [];
    for (const a of agents) {
      if (q) {
        const hay = `${a.name} ${a.description || ""} ${a.id} ${a.last_message || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      items.push({
        kind: "agent",
        agent: a,
        sortAt: itemSortAt(a.conversation_updated_at || a.updated_at || a.created_at),
      });
    }
    for (const ch of channels) {
      if (q) {
        const memberNames = (ch.members || []).map((id) => agentNameById.get(id) || id).join(" ");
        const hay = `${ch.name} ${memberNames}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      items.push({
        kind: "channel",
        channel: ch,
        sortAt: itemSortAt(ch.created_at),
      });
    }
    items.sort((a, b) => b.sortAt - a.sortAt || a.kind.localeCompare(b.kind));
    return items;
  }, [agents, channels, deferredConvSearch, agentNameById]);

  const selectedKey = conversation?.channel_id
    ? `channel:${conversation.channel_id}`
    : conversation?.agent_id || agentId
      ? `agent:${conversation?.agent_id || agentId}`
      : "";
  const selectConv = (key: string) => {
    if (key.startsWith("agent:")) void sessionActions().onSelectAgent(key.slice(6));
    else if (key.startsWith("channel:")) void sessionActions().openChannelChat(key.slice(8));
  };

  const identityFocus =
    activeAgent || agents.find((a) => a.id === agentId) || agents[0] || null;
  const busyKeySet = useMemo(() => new Set(busySelectionKeys), [busySelectionKeys]);

  return (
    <aside
      className={cn(
        sidebarAsideClass({
          sheetForm,
          hideOnMobileChat: isNarrowLayout && mobileView === "chat",
        }),
        !sheetForm && "border border-separator/60 bg-background shadow-none",
      )}
    >
      {sheetForm ? (
        <div className="shrink-0 px-3 pb-1 pt-[max(16px,calc(var(--safe-top,0px)+12px))]">
          <div className="flex min-h-11 items-center justify-between gap-2">
            <button
              type="button"
              className="grid size-11 min-h-11 min-w-11 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 [-webkit-tap-highlight-color:transparent] focus:outline-none active:brightness-[0.96]"
              title={user?.username || "账户"}
              aria-label="打开设置"
              onClick={() => void sessionActions().openSettings("general")}
            >
              <span
                className="grid size-9 place-items-center rounded-full bg-default text-xs font-semibold text-foreground"
                aria-hidden
              >
                {accountInitials(user?.username || "")}
              </span>
            </button>
            <div className="flex items-center gap-1.5">
              <label
                className={cn(
                  "relative grid size-11 min-h-11 min-w-11 cursor-pointer place-items-center overflow-hidden rounded-full bg-(--bg-soft) text-(--muted)",

                  "box-border focus-within:flex focus-within:w-[min(180px,48vw)] focus-within:min-w-11 focus-within:items-center focus-within:justify-start focus-within:gap-1.5 focus-within:rounded-[22px] focus-within:px-3",
                  "[data-theme=dark]:bg-white/10 active:brightness-[0.96] [-webkit-tap-highlight-color:transparent]",
                  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:opacity-70",
                  "[&_input]:absolute [&_input]:inset-0 [&_input]:size-full [&_input]:cursor-pointer [&_input]:border-0 [&_input]:bg-transparent [&_input]:opacity-0 [&_input]:text-base",
                  "focus-within:[&_input]:static focus-within:[&_input]:min-w-0 focus-within:[&_input]:flex-1 focus-within:[&_input]:cursor-text focus-within:[&_input]:opacity-100 focus-within:[&_input]:text-(--text) focus-within:[&_input]:outline-none",
                )}
                title="搜索"
              >
                <Search size={18} strokeWidth={2} aria-hidden />
                <input
                  value={convSearch}
                  onChange={(e) => setConvSearch(e.target.value)}
                  placeholder="搜索"
                  aria-label="搜索助手或群聊"
                />
              </label>
              <button
                ref={actions.newChatBtnRef}
                type="button"
                className={sidebarIconBtnClass({ sheetPlus: true })}
                title="新建"
                aria-haspopup="dialog"
                aria-expanded={createSheetOpen || showNewChat}
                onClick={() => sessionActions().onToggleCreateSheet()}
              >
                <Plus size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1.5 px-2 pb-4 pt-3 text-center">
            <div className="grid size-20 place-items-center">
              {identityFocus ? (
                <AgentAvatar
                  id={identityFocus.id}
                  name={identityFocus.name}
                  size={80}
                  shape={identityFocus.avatar_shape}
                  color={identityFocus.avatar_color}
                  status={presenceByAgent[identityFocus.id] || "idle"}
                  searchingHint={searchHints.listAgentSearching(identityFocus.id)}
                  online={isBotOnline(identityFocus.id)}
                  onClick={() => sessionActions().openAvatarSettings(identityFocus)}
                />
              ) : (
                <span
                  className="grid size-20 place-items-center rounded-full bg-accent text-[22px] font-bold text-accent-foreground"
                  aria-hidden
                >
                  {accountInitials(user?.username || "open bot")}
                </span>
              )}
            </div>
            <div className="max-w-full truncate text-xl font-bold tracking-tight text-(--text)">

              {identityFocus?.name || user?.username || "open bot"}
            </div>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2 py-1 text-[13px] text-(--muted) hover:bg-(--bg-soft) active:bg-(--bg-soft)"

              aria-label="工作区"
            >
              open bot
              <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 px-1 py-0.5">
          <SearchField
            aria-label="搜索助手或群聊"
            value={convSearch}
            onChange={setConvSearch}
            placeholder="搜索助手 / 群聊"
            inputClassName="text-sm md:text-xs"
            className="min-w-0 flex-1"
          />
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button
                ref={actions.newChatBtnRef}
                isIconOnly
                size="sm"
                variant="secondary"
                aria-label="新建聊天"
                aria-haspopup="dialog"
                aria-expanded={showNewChat}
                onClick={() => sessionActions().onOpenNewChatList()}
              >
                <Plus size={16} strokeWidth={2.25} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>新建聊天</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Phase 3 in-app shortcut area (not OS widgets): mobile sheet home vs desktop sidebar. */}
      <MicroAppShortcuts surface={sheetForm || isCapacitorNative() ? "mobile_shortcut" : "desktop_shortcut"} />

      <div className={cn(sidebarListClass(sheetForm), "px-0.5")}>
        <ul className="conv-list m-0 flex min-h-0 flex-1 list-none flex-col border-0 bg-transparent p-0" aria-label="会话列表">
          {convItems.length === 0 ? (
            <li className="list-none">
              <Empty className="px-3 py-6">
                <EmptyHeader>
                  <EmptyTitle>
                    {agents.length === 0 && channels.length === 0 ? "暂无助手" : "无匹配会话"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {agents.length === 0 && channels.length === 0
                      ? "点击「+」新建助手，选好岗位后即可开聊。"
                      : "试试别的关键词。"}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </li>
          ) : (
            convItems.map((row) => {
              if (row.kind === "agent") {
                const a = row.agent;
                const id = `agent:${a.id}`;
                const snippet = (a.last_message || a.description || "").trim() || "尚未开始对话";
                return (
                  <Item
                    key={id}
                    selected={selectedKey === id}
                    className={cn("group", sheetForm && "min-h-16 rounded-none")}
                    onPointerDown={(e) => beginConvLongPress(e, { kind: "agent", agent: a })}
                    onPointerMove={moveConvLongPress}
                    onPointerUp={endConvLongPress}
                    onPointerCancel={endConvLongPress}
                    onContextMenu={(e) => {
                      if (touchUi) e.preventDefault();
                    }}
                  >
                    <ItemContent>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-inherit"
                        onClick={() => selectConv(id)}
                      >
                        <AgentAvatar
                          id={a.id}
                          name={a.name}
                          size={sheetForm ? 46 : 32}
                          shape={a.avatar_shape}
                          color={a.avatar_color}
                          status={presenceByAgent[a.id] || "idle"}
                          searchingHint={searchHints.listAgentSearching(a.id)}
                          online={isBotOnline(a.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <ItemTitle className={cn(sheetForm && "text-[15px]")}>
                            {a.name}
                            {busyKeySet.has(id) ? (
                              <span className={runBusyDotClass()} title="回复中" aria-label="回复中" />
                            ) : null}
                          </ItemTitle>
                          <ItemDescription>{snippet}</ItemDescription>
                        </div>
                      </button>
                    </ItemContent>
                    <ItemActions
                      className={cn(!touchOrSheet && "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label="Bot 设置"
                            disabled={agentBusy}
                            onClick={() => sessionActions().onOpenBotSettings(a.id)}
                          >
                            <Settings size={14} strokeWidth={2} aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Bot 设置</TooltipContent>
                      </Tooltip>
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label="复制助手"
                            disabled={agentBusy}
                            onClick={() => sessionActions().setCloneTarget(a)}
                          >
                            <Copy size={14} strokeWidth={2} aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>复制助手</TooltipContent>
                      </Tooltip>
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="danger-soft"
                            aria-label="删除助手"
                            disabled={agentBusy}
                            onClick={() => void sessionActions().removeAgent(a)}
                          >
                            <Trash2 size={14} strokeWidth={2} aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>删除助手</TooltipContent>
                      </Tooltip>
                    </ItemActions>
                  </Item>
                );
              }
              const ch = row.channel;
              const id = `channel:${ch.id}`;
              const memberNames = (ch.members || []).map((mid) => agentNameById.get(mid) || mid).join("、") || "无成员";
              return (
                <Item
                  key={id}
                  selected={selectedKey === id}
                  className={cn("group", sheetForm && "min-h-16 rounded-none")}
                  onPointerDown={(e) => beginConvLongPress(e, { kind: "channel", channel: ch })}
                  onPointerMove={moveConvLongPress}
                  onPointerUp={endConvLongPress}
                  onPointerCancel={endConvLongPress}
                  onContextMenu={(e) => {
                    if (touchUi) e.preventDefault();
                  }}
                >
                  <ItemContent>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-inherit"
                      onClick={() => selectConv(id)}
                    >
                      <div className={channelMemberStackClass} aria-hidden>
                        {channelMemberProfiles(ch, agents, agentNameById)
                          .slice(0, 3)
                          .map((p) => (
                            <AgentAvatar
                              key={p.agent_id}
                              id={p.agent_id}
                              name={p.name}
                              size={sheetForm ? 28 : 22}
                              shape={p.avatar_shape}
                              color={p.avatar_color}
                              online={isBotOnline(p.agent_id, p.online)}
                            />
                          ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <ItemTitle className={cn(sheetForm && "text-[15px]")}>
                          {ch.name}
                          {busyKeySet.has(id) ? (
                            <span className={runBusyDotClass()} title="回复中" aria-label="回复中" />
                          ) : null}
                        </ItemTitle>
                        <ItemDescription>{memberNames}</ItemDescription>
                      </div>
                    </button>
                  </ItemContent>
                  <ItemActions
                    className={cn(!touchOrSheet && "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="danger-soft"
                          aria-label="删除群聊"
                          disabled={channelBusy}
                          onClick={() => void sessionActions().removeChannel(ch)}
                        >
                          <Trash2 size={14} strokeWidth={2} aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>删除群聊</TooltipContent>
                    </Tooltip>
                  </ItemActions>
                </Item>
              );
            })
          )}
        </ul>
      </div>

      {!sheetForm ? (
        <div className="mt-auto flex shrink-0 flex-col gap-2 pt-1">
          <AccountMenu
            username={user?.username || "账户"}
            llm={defaultLLM}
            onOpenSettings={() => void sessionActions().openSettings("general")}
            onChangeModel={() => void sessionActions().openSettings("llm")}
            onOpenMicroApps={() => useMicroAppsStore.getState().setHubOpen(true)}
            onLogout={() => sessionActions().onLogout()}
          />
        </div>
      ) : null}
    </aside>
  );
}

export const AppSidebar = memo(AppSidebarInner);
