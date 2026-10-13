import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { agentNameMap, channelMemberProfiles, resolveActiveAgent, resolveActiveChannel } from "../../../lib/app/workspaceDerived";
import { runSearchHints } from "../../../lib/runFace";
import { useChatStore } from "../../../stores/chat";
import { botIsOnline, usePresenceStore } from "../../../stores/presence";
import { overlaySessionActions, shellSessionActions } from "../../../stores/sessionActions";
import { useShellStore } from "../../../stores/shell";
import { useWorkspaceStore } from "../../../stores/workspace";
import { AgentAvatar } from "../../AgentAvatar";
import { channelMemberStackClass } from "../sidebarUi";

export function ChatTopbar() {
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const channels = useWorkspaceStore((s) => s.channels);
  const selectionHydrated = useWorkspaceStore((s) => s.selectionHydrated);
  const hostActivity = useShellStore((s) => s.hostActivity);
  const presenceByAgent = usePresenceStore((s) => s.presenceByAgent);
  const onlineByAgent = usePresenceStore((s) => s.onlineByAgent);
  const runFaceAgentId = useChatStore((s) => s.runFaceAgentId);
  const runActiveTool = useChatStore((s) => s.runActiveTool);

  const agentNameById = useMemo(() => agentNameMap(agents), [agents]);
  const activeAgent = resolveActiveAgent(agentId, agents);
  const activeChannel = resolveActiveChannel(conversation, channels);
  const hints = runSearchHints({
    faceAgentId: runFaceAgentId,
    isGroup: Boolean(activeChannel),
    activeAgentId: activeAgent?.id,
    runActiveTool,
    hostActivity,
  });
  const isOnline = (id?: string | null, snapshot?: boolean) => botIsOnline(onlineByAgent, agents, id, snapshot);

  return (
    <header className="topbar">
      <button type="button" className="topbar-back" aria-label="返回" onClick={() => shellSessionActions().onSystemBack()}>
        <ChevronLeft size={18} strokeWidth={2} aria-hidden />
        <span className="topbar-back-label">返回</span>
      </button>
      <div className="agent-pill">
        {activeChannel ? (
          <button
            type="button"
            className="agent-pill-channel"
            aria-label={`群设置 ${activeChannel.name}`}
            title="群设置"
            onClick={() => overlaySessionActions().setGroupMembersChannel(activeChannel)}
          >
            <span className={channelMemberStackClass} aria-hidden>
              {channelMemberProfiles(activeChannel, agents, agentNameById).map((p) => (
                <AgentAvatar
                  key={p.agent_id}
                  id={p.agent_id}
                  name={p.name}
                  size={24}
                  shape={p.avatar_shape}
                  color={p.avatar_color}
                  status={presenceByAgent[p.agent_id] || "idle"}
                  searchingHint={hints.memberSearching(presenceByAgent[p.agent_id])}
                  online={isOnline(p.agent_id, p.online)}
                />
              ))}
            </span>
            <span className="agent-pill-name">{activeChannel.name}</span>
            <span className="agent-pill-members muted small" style={{ marginLeft: 8 }}>
              {(activeChannel.members || []).map((id) => agentNameById.get(id) || id).join("、")}
            </span>
          </button>
        ) : !selectionHydrated ? (
          <span className="agent-pill-name muted">加载中…</span>
        ) : (
          <>
            <AgentAvatar
              id={activeAgent?.id}
              name={activeAgent?.name ?? "助手"}
              size={28}
              shape={activeAgent?.avatar_shape}
              color={activeAgent?.avatar_color}
              status={(activeAgent && presenceByAgent[activeAgent.id]) || "idle"}
              searchingHint={hints.listAgentSearching(activeAgent?.id || "")}
              online={isOnline(activeAgent?.id)}
              onClick={activeAgent ? () => overlaySessionActions().openAvatarSettings(activeAgent) : undefined}
            />
            <span className="agent-pill-name">{activeAgent?.name ?? "助手"}</span>
            {activeAgent ? (
              <button
                type="button"
                className="ghost train-entry-btn"
                title="训练：确认 / 停用从反馈生成的经验"
                onClick={() => overlaySessionActions().setTrainAgent(activeAgent)}
              >
                训练
              </button>
            ) : null}
          </>
        )}
      </div>
    </header>
  );
}
