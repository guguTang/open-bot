import { useMemo } from "react";
import { ChatMain } from "./ChatMain";
import { sessionActions } from "../../stores/sessionActions";
import { useShellStore } from "../../stores/shell";
import { useWorkspaceStore } from "../../stores/workspace";
import {
  agentNameMap,
  channelMemberProfiles,
  resolveActiveAgent,
  resolveActiveChannel,
} from "../../lib/app/workspaceDerived";

export function AppChatArea() {
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const channels = useWorkspaceStore((s) => s.channels);
  const selectionHydrated = useWorkspaceStore((s) => s.selectionHydrated);
  const viewingRunActive = useWorkspaceStore((s) => s.viewingRunActive);
  const hostExecPolicy = useWorkspaceStore((s) => s.hostExecPolicy);
  const composerMentionItems = useWorkspaceStore((s) => s.composerMentionItems);
  const composerSkills = useWorkspaceStore((s) => s.composerSkills);
  const hostActivity = useShellStore((s) => s.hostActivity);
  const onboardingDismissed = useShellStore((s) => s.onboardingDismissed);

  const agentNameById = useMemo(() => agentNameMap(agents), [agents]);
  const activeAgent = resolveActiveAgent(agentId, agents);
  const activeChannel = resolveActiveChannel(conversation, channels);

  return (
    <ChatMain
      hostActivity={hostActivity}
      onSystemBack={() => sessionActions().onSystemBack()}
      agents={agents}
      activeChannel={activeChannel}
      selectionHydrated={selectionHydrated}
      activeAgent={activeAgent}
      agentId={agentId}
      conversation={conversation}
      channelMemberProfiles={(ch) => channelMemberProfiles(ch, agents, agentNameById)}
      agentNameById={agentNameById}
      onOpenGroupSettings={(ch) => sessionActions().setGroupMembersChannel(ch)}
      onOpenAvatarSettings={(agent) => sessionActions().openAvatarSettings(agent)}
      onOpenTrain={(agent) => sessionActions().setTrainAgent(agent)}
      onboardingDismissed={onboardingDismissed}
      onOnboardingSelect={(opt) => sessionActions().onOnboardingSelect(opt)}
      onOnboardingCustom={(text) => sessionActions().onOnboardingCustom(text)}
      onOnboardingDismiss={() => sessionActions().onOnboardingDismiss()}
      settleHostConfirm={(message, decision) => sessionActions().settleHostConfirm(message, decision)}
      hostExecPolicy={hostExecPolicy}
      setOpenThreadRootId={(id) => sessionActions().setOpenThreadRootId(id)}
      onToggleReaction={(messageId, emoji) => void sessionActions().onToggleReaction(messageId, emoji)}
      openFeedbackForMessage={(msg, source) => sessionActions().openFeedbackForMessage(msg, source)}
      viewingRunActive={viewingRunActive}
      onApprovalDeny={() => sessionActions().onApprovalDeny()}
      onApprovalAllow={() => sessionActions().onApprovalAllow()}
      onSubmit={(e) => void sessionActions().onSubmit(e)}
      stopCurrentRun={(opts) => sessionActions().stopCurrentRun(opts)}
      composerMentionItems={composerMentionItems}
      composerSkills={composerSkills}
    />
  );
}
