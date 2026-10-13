import { useMemo } from "react";
import { agentNameMap, resolveActiveAgent, resolveActiveChannel } from "../../../lib/app/workspaceDerived";
import { resolveChatRunFace } from "../../../lib/runFace";
import { useChatStore } from "../../../stores/chat";
import { usePresenceStore } from "../../../stores/presence";
import { useShellStore } from "../../../stores/shell";
import { useWorkspaceStore } from "../../../stores/workspace";
import { RunStatus } from "../../RunStatus";
import { isChatProcessing } from "../transcriptView";

export function LiveRunStatus() {
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const channels = useWorkspaceStore((s) => s.channels);
  const viewingRunActive = useWorkspaceStore((s) => s.viewingRunActive);
  const hostActivity = useShellStore((s) => s.hostActivity);
  const runLabel = useChatStore((s) => s.runLabel);
  const runActiveTool = useChatStore((s) => s.runActiveTool);
  const runFaceAgentId = useChatStore((s) => s.runFaceAgentId);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const presenceByAgent = usePresenceStore((s) => s.presenceByAgent);

  const agentNameById = useMemo(() => agentNameMap(agents), [agents]);
  const activeAgent = resolveActiveAgent(agentId, agents);
  const activeChannel = resolveActiveChannel(conversation, channels);
  const face = resolveChatRunFace({
    faceAgentId: runFaceAgentId,
    isGroup: Boolean(activeChannel),
    activeAgentId: activeAgent?.id,
    runActiveTool,
    hostActivity,
    activeAgent,
    agents,
    activeChannel,
    agentNameById,
    runLive: isChatProcessing({ sending, taskBusy, viewingRunActive }),
    runLabel,
    sending,
    taskBusy,
    viewingRunActive,
    presenceByAgent,
  });

  return (
    <RunStatus
      label={face.label}
      agentId={face.agentId}
      agentName={face.agentName}
      shape={face.shape}
      avatarColor={face.avatarColor}
      color={face.color}
      status={face.status}
      searchingHint={face.searchingHint}
    />
  );
}
