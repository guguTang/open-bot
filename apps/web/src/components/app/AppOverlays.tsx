import { toast } from "sonner";
import type { Agent, Channel } from "../../api";
import { FeedbackModal } from "../FeedbackModal";
import { TrainPanel } from "../TrainPanel";
import { NewChatPopover } from "../NewChatPopover";
import { BotAvatarSettings } from "../BotAvatarSettings";
import { ConvActionSheet } from "../ConvActionSheet";
import { CreateActionSheet } from "../CreateActionSheet";
import { SecretPromptModal } from "../SecretPromptModal";
import { CloneAgentModal } from "../CloneAgentModal";
import { GroupMembersSettings } from "../GroupMembersSettings";
import type { AppSettingsBundle } from "../../hooks/useAppSettings";
import { sessionActions } from "../../stores/sessionActions";
import { setShell, useShellStore } from "../../stores/shell";
import { useWorkspaceStore } from "../../stores/workspace";

export type ConvSheetTarget =
  | { kind: "agent"; agent: Agent }
  | { kind: "channel"; channel: Channel }
  | null;

export function AppOverlays({ settings }: { settings: AppSettingsBundle }) {
  const agents = useWorkspaceStore((s) => s.agents);
  const createSheetOpen = useShellStore((s) => s.createSheetOpen);
  const showNewChat = useShellStore((s) => s.showNewChat);
  const newChatInitialMode = useShellStore((s) => s.newChatInitialMode);
  const convSheet = useShellStore((s) => s.convSheet);
  const groupMembersChannel = useShellStore((s) => s.groupMembersChannel);
  const cloneTarget = useShellStore((s) => s.cloneTarget);
  const avatarSettingsAgent = useShellStore((s) => s.avatarSettingsAgent);
  const feedbackTarget = useShellStore((s) => s.feedbackTarget);
  const trainAgent = useShellStore((s) => s.trainAgent);
  const trainReload = useShellStore((s) => s.trainReload);

  const { shell, secrets } = settings;
  const { secretPrompt, setSecretPrompt, setShow: setShowSettings } = shell;
  const actions = sessionActions();

  return (
    <>
      <CreateActionSheet
        open={createSheetOpen}
        onClose={() => sessionActions().setCreateSheetOpen(false)}
        onCreateBot={() => {
          sessionActions().setCreateSheetOpen(false);
          sessionActions().setNewChatInitialMode("bot");
          sessionActions().setShowNewChat(true);
        }}
        onCreateGroup={() => {
          sessionActions().setCreateSheetOpen(false);
          sessionActions().setNewChatInitialMode("group");
          sessionActions().setShowNewChat(true);
        }}
      />

      <NewChatPopover
        open={showNewChat}
        agents={agents}
        anchorRef={actions.newChatBtnRef}
        initialMode={newChatInitialMode}
        onClose={() => {
          sessionActions().setShowNewChat(false);
          sessionActions().setNewChatInitialMode("list");
        }}
        onSelectAgent={(a) => void sessionActions().startChatWithAgent(a)}
        onCreateBot={(input) => sessionActions().createBotFromPopover(input)}
        onCreateGroup={(name, ids) => sessionActions().createGroupFromPopover(name, ids)}
      />

      <ConvActionSheet
        open={Boolean(convSheet)}
        title={
          convSheet?.kind === "agent"
            ? convSheet.agent.name
            : convSheet?.kind === "channel"
              ? convSheet.channel.name
              : undefined
        }
        onClose={() => sessionActions().setConvSheet(null)}
        onSettings={
          convSheet?.kind === "agent"
            ? () => {
                const agent = convSheet.agent;
                sessionActions().setConvSheet(null);
                void sessionActions().onSelectAgent(agent.id);
                void sessionActions().openSettings("bot");
              }
            : undefined
        }
        onGroupSettings={
          convSheet?.kind === "channel"
            ? () => {
                const ch = convSheet.channel;
                sessionActions().setConvSheet(null);
                sessionActions().setGroupMembersChannel(ch);
              }
            : undefined
        }
        onClone={
          convSheet?.kind === "agent"
            ? () => {
                const agent = convSheet.agent;
                sessionActions().setConvSheet(null);
                sessionActions().setCloneTarget(agent);
              }
            : undefined
        }
        onDelete={() => {
          const target = convSheet;
          sessionActions().setConvSheet(null);
          if (!target) return;
          if (target.kind === "agent") void sessionActions().removeAgent(target.agent);
          else void sessionActions().removeChannel(target.channel);
        }}
      />

      <GroupMembersSettings
        open={Boolean(groupMembersChannel)}
        channel={groupMembersChannel}
        agents={agents}
        onClose={() => sessionActions().setGroupMembersChannel(null)}
        onChanged={(ch) => {
          sessionActions().setChannels((prev) => {
            const i = prev.findIndex((c) => c.id === ch.id);
            if (i < 0) return prev;
            const next = prev.slice();
            next[i] = { ...prev[i], ...ch, name: ch.name || prev[i].name };
            return next;
          });
          setShell("groupMembersChannel", (cur) =>
            cur && cur.id === ch.id ? { ...cur, ...ch, name: ch.name || cur.name } : cur,
          );
          void sessionActions().refreshChannels().catch(() => {});
        }}
      />

      <CloneAgentModal
        agent={cloneTarget}
        onClose={() => sessionActions().setCloneTarget(null)}
        onCloned={(res) => {
          const created = res.agent;
          void sessionActions()
            .refreshAgents()
            .then(() => {
              setShowSettings(false);
              void sessionActions().onSelectAgentRef.current(created.id);
            })
            .catch(() => {});
          const extras: string[] = [];
          if (res.memories_copied) extras.push(`${res.memories_copied} 条记忆`);
          if (res.routines_copied) extras.push(`${res.routines_copied} 个例行任务（已暂停）`);
          toast.success(`已复制为「${created.name}」${extras.length ? `，含 ${extras.join("、")}` : ""}`);
        }}
      />

      <SecretPromptModal
        request={secretPrompt}
        onClose={() => setSecretPrompt(null)}
        onResolved={() => void secrets.refreshSecrets()}
      />

      <BotAvatarSettings
        open={Boolean(avatarSettingsAgent)}
        agent={avatarSettingsAgent}
        onClose={() => sessionActions().setAvatarSettingsAgent(null)}
        onSave={(id, patch) => sessionActions().saveAvatarSettings(id, patch)}
      />

      <FeedbackModal
        target={feedbackTarget}
        onClose={() => sessionActions().setFeedbackTarget(null)}
        onSubmit={(input) => sessionActions().submitFeedback(input)}
      />

      <TrainPanel
        open={Boolean(trainAgent)}
        agent={trainAgent}
        reloadToken={trainReload}
        onClose={() => sessionActions().setTrainAgent(null)}
      />
    </>
  );
}
