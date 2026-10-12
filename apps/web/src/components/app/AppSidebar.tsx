import { ChevronDown, Copy, Plus, Search, Settings } from "lucide-react";
import { memo, useDeferredValue, useMemo } from "react";
import type { Agent, Channel } from "../../api";
import { toolNameLooksLikeSearch } from "../avatarColor";
import { AccountMenu } from "../AccountMenu";
import { AgentAvatar } from "../AgentAvatar";
import { useIsTouchUi, useSheetFormUi } from "../useIsTouchUi";
import { useConvLongPressHandlers } from "../../hooks/useConvLongPress";
import { useChatStore } from "../../stores/chat";
import { botIsOnline, usePresenceStore } from "../../stores/presence";
import { sessionActions } from "../../stores/sessionActions";
import { useShellStore } from "../../stores/shell";
import { useWorkspaceStore } from "../../stores/workspace";
import { agentNameMap, channelMemberProfiles, resolveActiveAgent } from "../../lib/app/workspaceDerived";
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
    <aside className="sidebar">
      {sheetForm ? (
        <div className="sidebar-shell-head">
          <div className="sidebar-shell-topbar">
            <button
              type="button"
              className="sidebar-shell-user"
              title={user?.username || "账户"}
              aria-label="打开设置"
              onClick={() => void sessionActions().openSettings("general")}
            >
              <span className="sidebar-shell-user-avatar" aria-hidden>
                {accountInitials(user?.username || "")}
              </span>
            </button>
            <div className="sidebar-shell-top-actions">
              <label className="sidebar-shell-search-btn" title="搜索">
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
                className={`icon-btn sidebar-shell-plus${createSheetOpen || showNewChat ? " active-plus" : ""}`}
                title="新建"
                aria-haspopup="dialog"
                aria-expanded={createSheetOpen || showNewChat}
                onClick={() => sessionActions().onToggleCreateSheet()}
              >
                <Plus size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>
          <div className="sidebar-identity">
            <div className="sidebar-identity-avatar">
              {identityFocus ? (
                <AgentAvatar
                  id={identityFocus.id}
                  name={identityFocus.name}
                  size={80}
                  shape={identityFocus.avatar_shape}
                  color={identityFocus.avatar_color}
                  status={presenceByAgent[identityFocus.id] || "idle"}
                  searchingHint={Boolean(
                    (runFaceAgentId ? identityFocus.id === runFaceAgentId : activeAgent && identityFocus.id === activeAgent.id) &&
                      searchingHintNow,
                  )}
                  online={isBotOnline(identityFocus.id)}
                  onClick={() => sessionActions().openAvatarSettings(identityFocus)}
                />
              ) : (
                <span className="sidebar-identity-fallback" aria-hidden>
                  {accountInitials(user?.username || "open bot")}
                </span>
              )}
            </div>
            <div className="sidebar-identity-name">{identityFocus?.name || user?.username || "open bot"}</div>
            <button type="button" className="sidebar-identity-workspace" aria-label="工作区">
              open bot
              <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        <div className="sidebar-top">
          <label className="sidebar-search">
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
            className={`icon-btn${showNewChat ? " active-plus" : ""}`}
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
          className="section-fold-head"
          aria-expanded={!assistantsCollapsed}
          onClick={() => sessionActions().toggleAssistantsCollapsed()}
        >
          <span className="section-fold-title">助手</span>
          <span className="section-fold-meta">
            {assistantsCollapsed ? <span className="section-fold-count">{filteredAgents.length}</span> : null}
            <span className="section-fold-chevron" aria-hidden>
              {assistantsCollapsed ? "▸" : "▾"}
            </span>
          </span>
        </button>
      ) : (
        <div className="section-label">助手</div>
      )}
      {!(sheetForm && assistantsCollapsed) ? (
        <nav className="agent-list">
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
                  className={`agent-item conv-item ${active ? "active" : ""}`}
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
                      (runFaceAgentId ? a.id === runFaceAgentId : activeAgent && a.id === activeAgent.id) &&
                        searchingHintNow,
                    )}
                    online={isBotOnline(a.id)}
                    onClick={() => sessionActions().openAvatarSettings(a)}
                  />
                  <div className="agent-item-body">
                    <div className="agent-name">
                      {a.name}
                      {busyKeySet.has(`agent:${a.id}`) ? (
                        <span className="run-busy-dot" title="回复中" aria-label="回复中" />
                      ) : null}
                    </div>
                    <div className="agent-desc">{snippet || "尚未开始对话"}</div>
                  </div>
                  <button
                    type="button"
                    className="conv-settings"
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
                    className="conv-clone"
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
                    className="conv-del"
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
              className="section-fold-head"
              aria-expanded={!groupsCollapsed}
              onClick={() => sessionActions().toggleGroupsCollapsed()}
            >
              <span className="section-fold-title">群聊</span>
              <span className="section-fold-meta">
                {groupsCollapsed ? <span className="section-fold-count">{filteredChannels.length}</span> : null}
                <span className="section-fold-chevron" aria-hidden>
                  {groupsCollapsed ? "▸" : "▾"}
                </span>
              </span>
            </button>
          ) : (
            <div className="section-label">群聊</div>
          )}
          {!(sheetForm && groupsCollapsed) ? (
            <div className="conv-list channel-list">
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
                      className={`agent-item conv-item channel-item ${conversation?.channel_id === ch.id || conversation?.id === ch.conversation_id ? "active" : ""}`}
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
                      <div className="channel-member-stack" aria-hidden>
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
                      <div className="conv-item-main">
                        <div className="agent-name">
                          {ch.name}
                          {busyKeySet.has(`channel:${ch.id}`) ? (
                            <span className="run-busy-dot" title="回复中" aria-label="回复中" />
                          ) : null}
                        </div>
                        <div className="agent-desc">{memberNames || "无成员"} · 点击打开群聊</div>
                      </div>
                      <button
                        type="button"
                        className="conv-del"
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
        <div className="sidebar-foot">
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
