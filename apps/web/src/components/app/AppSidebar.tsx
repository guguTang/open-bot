import { ChevronDown, Copy, Plus, Search, Settings } from "lucide-react";
import { memo, useDeferredValue, useMemo } from "react";
import type { Agent, Channel } from "../../api";
import { toolNameLooksLikeSearch } from "../avatarColor";
import { AccountMenu } from "../AccountMenu";
import { AgentAvatar } from "../AgentAvatar";
import { useIsNarrowLayout, useIsTouchUi, useSheetFormUi } from "../useIsTouchUi";
import {
  channelMemberStackClass,
  runBusyDotClass,
  sidebarAsideClass,
  sidebarConvActionClass,
  sidebarConvRowClass,
  sidebarIconBtnClass,
  sidebarListClass,
  sidebarSearchFieldClass,
  sidebarSectionFoldHeadClass,
  sidebarSectionLabelClass,
} from "./sidebarUi";
import { useConvLongPressHandlers } from "../../hooks/useConvLongPress";
import { useChatStore } from "../../stores/chat";
import { botIsOnline, usePresenceStore } from "../../stores/presence";
import { sessionActions } from "../../stores/sessionActions";
import { useShellStore } from "../../stores/shell";
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

function AppSidebarInner() {
  const user = useWorkspaceStore((s) => s.user);
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const channels = useWorkspaceStore((s) => s.channels);
  const assistantsCollapsed = useWorkspaceStore((s) => s.assistantsCollapsed);
  const groupsCollapsed = useWorkspaceStore((s) => s.groupsCollapsed);
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
  const searchingHintNow = toolNameLooksLikeSearch(runActiveTool) || toolNameLooksLikeSearch(hostActivity);
  const isBotOnline = (id?: string | null, snapshot?: boolean) => botIsOnline(onlineByAgent, agents, id, snapshot);
  const deferredConvSearch = useDeferredValue(convSearch);
  const filteredAgents = useMemo(() => {
    const q = deferredConvSearch.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const hay = `${a.name} ${a.description || ""} ${a.id} ${a.last_message || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [agents, deferredConvSearch]);
  const filteredChannels = useMemo(() => {
    const q = deferredConvSearch.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((ch) => {
      const memberNames = (ch.members || []).map((id) => agentNameById.get(id) || id).join(" ");
      const hay = `${ch.name} ${memberNames}`.toLowerCase();
      return hay.includes(q);
    });
  }, [channels, deferredConvSearch, agentNameById]);

  const identityFocus =
    activeAgent || agents.find((a) => a.id === agentId) || agents[0] || null;
  const busyKeySet = useMemo(() => new Set(busySelectionKeys), [busySelectionKeys]);

  return (
    <aside
      className={sidebarAsideClass({
        sheetForm,
        hideOnMobileChat: isNarrowLayout && mobileView === "chat",
      })}
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
                className="grid size-9 place-items-center rounded-full bg-[#e5e7eb] text-xs font-semibold text-[#374151]"
                aria-hidden
              >
                {accountInitials(user?.username || "")}
              </span>
            </button>
            <div className="flex items-center gap-1.5">
              <label
                className={cn(
                  "relative grid size-11 min-h-11 min-w-11 cursor-pointer place-items-center overflow-hidden rounded-full bg-[var(--bg-soft)] text-[var(--muted)]",
                  "box-border focus-within:flex focus-within:w-[min(180px,48vw)] focus-within:min-w-11 focus-within:items-center focus-within:justify-start focus-within:gap-1.5 focus-within:rounded-[22px] focus-within:px-3",
                  "[data-theme=dark]:bg-white/10 active:brightness-[0.96] [-webkit-tap-highlight-color:transparent]",
                  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:opacity-70",
                  "[&_input]:absolute [&_input]:inset-0 [&_input]:size-full [&_input]:cursor-pointer [&_input]:border-0 [&_input]:bg-transparent [&_input]:opacity-0 [&_input]:text-base",
                  "focus-within:[&_input]:static focus-within:[&_input]:min-w-0 focus-within:[&_input]:flex-1 focus-within:[&_input]:cursor-text focus-within:[&_input]:opacity-100 focus-within:[&_input]:text-[var(--text)] focus-within:[&_input]:outline-none",
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
                  searchingHint={Boolean(
                    (runFaceAgentId
                      ? identityFocus.id === runFaceAgentId
                      : !conversation?.channel_id && activeAgent && identityFocus.id === activeAgent.id) &&
                      searchingHintNow,
                  )}
                  online={isBotOnline(identityFocus.id)}
                  onClick={() => sessionActions().openAvatarSettings(identityFocus)}
                />
              ) : (
                <span
                  className="grid size-20 place-items-center rounded-full bg-[#111827] text-[22px] font-bold text-white"
                  aria-hidden
                >
                  {accountInitials(user?.username || "open bot")}
                </span>
              )}
            </div>
            <div className="max-w-full truncate text-xl font-bold tracking-tight text-[var(--text)]">
              {identityFocus?.name || user?.username || "open bot"}
            </div>
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2 py-1 text-[13px] text-[var(--muted)] hover:bg-[var(--bg-soft)] active:bg-[var(--bg-soft)]"
              aria-label="工作区"
            >
              open bot
              <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 px-1 py-0.5">
          <label className={sidebarSearchFieldClass()}>
            <Search size={16} strokeWidth={2} aria-hidden />
            <input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="搜索助手 / 群聊"
              aria-label="搜索助手或群聊"
            />
          </label>
          <button
            ref={actions.newChatBtnRef}
            type="button"
            className={sidebarIconBtnClass()}
            title="新建聊天"
            aria-haspopup="dialog"
            aria-expanded={showNewChat}
            onClick={() => sessionActions().onOpenNewChatList()}
          >
            <Plus size={18} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

      {sheetForm ? (
        <button
          type="button"
          className={sidebarSectionFoldHeadClass()}
          aria-expanded={!assistantsCollapsed}
          onClick={() => sessionActions().toggleAssistantsCollapsed()}
        >
          <span className="min-w-0 flex-1">助手</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
            {assistantsCollapsed ? (
              <span className="text-xs font-medium opacity-85">{filteredAgents.length}</span>
            ) : null}
            <span className="inline-grid size-[18px] place-items-center opacity-70" aria-hidden>
              {assistantsCollapsed ? "▸" : "▾"}
            </span>
          </span>
        </button>
      ) : (
        <div className={sidebarSectionLabelClass(sheetForm)}>助手</div>
      )}
      {!(sheetForm && assistantsCollapsed) ? (
        <nav className={sidebarListClass(sheetForm)} aria-label="助手列表">
          {agents.length === 0 ? (
            <div className="muted small" style={{ padding: "8px 10px", lineHeight: 1.5 }}>
              暂无助手。点击右上角「+」创建第一个助手。
            </div>
          ) : filteredAgents.length === 0 ? (
            <div className="muted small" style={{ padding: "4px 10px" }}>
              无匹配助手
            </div>
          ) : (
            filteredAgents.map((a) => {
              const active =
                !conversation?.channel_id &&
                (conversation?.agent_id === a.id || (!conversation && a.id === agentId));
              const snippet = (a.last_message || a.description || "").trim();
              return (
                <div
                  key={a.id}
                  className={sidebarConvRowClass({ sheetForm, active })}
                  onClick={() => sessionActions().onSelectAgent(a.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      sessionActions().onSelectAgent(a.id);
                    }
                  }}
                  onPointerDown={(e) => beginConvLongPress(e, { kind: "agent", agent: a })}
                  onPointerMove={moveConvLongPress}
                  onPointerUp={endConvLongPress}
                  onPointerCancel={endConvLongPress}
                  onContextMenu={(e) => {
                    if (touchUi) e.preventDefault();
                  }}
                >
                  <AgentAvatar
                    id={a.id}
                    name={a.name}
                    size={sheetForm ? 46 : 32}
                    shape={a.avatar_shape}
                    color={a.avatar_color}
                    status={presenceByAgent[a.id] || "idle"}
                    searchingHint={Boolean(
                      (runFaceAgentId
                        ? a.id === runFaceAgentId
                        : !conversation?.channel_id && activeAgent && a.id === activeAgent.id) &&
                        searchingHintNow,
                    )}
                    online={isBotOnline(a.id)}
                    onClick={() => sessionActions().openAvatarSettings(a)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={cn("agent-name", sheetForm && "text-[15px]")}>
                      {a.name}
                      {busyKeySet.has(`agent:${a.id}`) ? (
                        <span className={runBusyDotClass()} title="回复中" aria-label="回复中" />
                      ) : null}
                    </div>
                    <div className={cn("agent-desc", sheetForm && "mt-0.5")}>{snippet || "尚未开始对话"}</div>
                  </div>
                  <button
                    type="button"
                    className={sidebarConvActionClass({ touchOrSheet, variant: "settings" })}
                    title="Bot 设置"
                    aria-label="Bot 设置"
                    disabled={agentBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      sessionActions().onOpenBotSettings(a.id);
                    }}
                  >
                    <Settings size={14} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={sidebarConvActionClass({ touchOrSheet, variant: "clone" })}
                    title="复制助手"
                    aria-label="复制助手"
                    disabled={agentBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      sessionActions().setCloneTarget(a);
                    }}
                  >
                    <Copy size={14} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={sidebarConvActionClass({ touchOrSheet, variant: "del" })}
                    title="删除助手"
                    disabled={agentBusy}
                    onClick={(e) => void sessionActions().removeAgent(a, e)}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </nav>
      ) : null}

      {sheetForm && channels.length === 0 ? null : (
        <>
          {sheetForm ? (
            <button
              type="button"
              className={sidebarSectionFoldHeadClass()}
              aria-expanded={!groupsCollapsed}
              onClick={() => sessionActions().toggleGroupsCollapsed()}
            >
              <span className="min-w-0 flex-1">群聊</span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--muted)]">
                {groupsCollapsed ? (
                  <span className="text-xs font-medium opacity-85">{filteredChannels.length}</span>
                ) : null}
                <span className="inline-grid size-[18px] place-items-center opacity-70" aria-hidden>
                  {groupsCollapsed ? "▸" : "▾"}
                </span>
              </span>
            </button>
          ) : (
            <div className={sidebarSectionLabelClass(sheetForm)}>群聊</div>
          )}
          {!(sheetForm && groupsCollapsed) ? (
            <div className={sidebarListClass(sheetForm)} role="list">
              {filteredChannels.length === 0 ? (
                <div className="muted small" style={{ padding: "4px 10px" }}>
                  {channels.length === 0 ? "暂无群聊，可从「+」创建" : "无匹配群聊"}
                </div>
              ) : (
                filteredChannels.map((ch) => {
                  const memberNames = (ch.members || []).map((id) => agentNameById.get(id) || id).join("、");
                  return (
                    <div
                      key={ch.id}
                      className={sidebarConvRowClass({
                        sheetForm,
                        active:
                          conversation?.channel_id === ch.id || conversation?.id === ch.conversation_id,
                        channel: true,
                      })}
                      title={memberNames}
                      role="button"
                      tabIndex={0}
                      onClick={() => void sessionActions().openChannelChat(ch.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).click();
                        }
                      }}
                      onPointerDown={(e) => beginConvLongPress(e, { kind: "channel", channel: ch })}
                      onPointerMove={moveConvLongPress}
                      onPointerUp={endConvLongPress}
                      onPointerCancel={endConvLongPress}
                      onContextMenu={(e) => {
                        if (touchUi) e.preventDefault();
                      }}
                    >
                      <div className={channelMemberStackClass} aria-hidden>
                        {channelMemberProfiles(ch, agents, agentNameById)
                          .slice(0, 3)
                          .map((p) => (
                            <AgentAvatar
                              key={p.agent_id}
                              id={p.agent_id}
                              name={p.name}
                              size={22}
                              shape={p.avatar_shape}
                              color={p.avatar_color}
                              online={isBotOnline(p.agent_id, p.online)}
                            />
                          ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={cn("agent-name", sheetForm && "text-[15px]")}>
                          {ch.name}
                          {busyKeySet.has(`channel:${ch.id}`) ? (
                            <span className={runBusyDotClass()} title="回复中" aria-label="回复中" />
                          ) : null}
                        </div>
                        <div className={cn("agent-desc", sheetForm && "mt-0.5")}>
                          {memberNames || "无成员"} · 点击打开群聊
                        </div>
                      </div>
                      <button
                        type="button"
                        className={sidebarConvActionClass({ touchOrSheet, variant: "del" })}
                        title="删除群聊"
                        disabled={channelBusy}
                        onClick={(e) => void sessionActions().removeChannel(ch, e)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </>
      )}

      {!sheetForm ? (
        <div className="flex shrink-0 items-center px-1 pb-0.5 pt-2">
          <AccountMenu
            username={user?.username || "账户"}
            llm={defaultLLM}
            onOpenSettings={() => void sessionActions().openSettings("general")}
            onChangeModel={() => void sessionActions().openSettings("llm")}
            onLogout={() => sessionActions().onLogout()}
          />
        </div>
      ) : null}
    </aside>
  );
}

export const AppSidebar = memo(AppSidebarInner);
