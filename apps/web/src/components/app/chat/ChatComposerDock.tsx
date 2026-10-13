import { ChevronDown } from "lucide-react";
import type { RefObject } from "react";
import { pinStick } from "../../../lib/scrollStick";
import { resolveActiveAgent, resolveActiveChannel } from "../../../lib/app/workspaceDerived";
import {
  applyScrollStick,
  setInput,
  setPendingFiles,
  setReplyTarget,
  useChatStore,
} from "../../../stores/chat";
import { chatSessionActions, shellSessionActions } from "../../../stores/sessionActions";
import { useWorkspaceStore } from "../../../stores/workspace";
import { Composer } from "../../Composer";
import { isChatProcessing } from "../transcriptView";

export function ChatComposerDock({ messagesRef }: { messagesRef: RefObject<HTMLDivElement | null> }) {
  const agents = useWorkspaceStore((s) => s.agents);
  const agentId = useWorkspaceStore((s) => s.agentId);
  const conversation = useWorkspaceStore((s) => s.conversation);
  const channels = useWorkspaceStore((s) => s.channels);
  const viewingRunActive = useWorkspaceStore((s) => s.viewingRunActive);
  const defaultLLM = useWorkspaceStore((s) => s.defaultLLM);
  const composerMentionItems = useWorkspaceStore((s) => s.composerMentionItems);
  const composerSkills = useWorkspaceStore((s) => s.composerSkills);
  const input = useChatStore((s) => s.input);
  const pendingFiles = useChatStore((s) => s.pendingFiles);
  const replyTarget = useChatStore((s) => s.replyTarget);
  const approvalGate = useChatStore((s) => s.approvalGate);
  const sending = useChatStore((s) => s.sending);
  const taskBusy = useChatStore((s) => s.taskBusy);
  const showScrollBottom = useChatStore((s) => s.showScrollBottom);

  const activeAgent = resolveActiveAgent(agentId, agents);
  const activeChannel = resolveActiveChannel(conversation, channels);
  const chatProcessing = isChatProcessing({ sending, taskBusy, viewingRunActive });
  /** No user/org LLM connection — chatting would only return「无法调用模型」. */
  const needsModelSetup = !defaultLLM;
  const chat = chatSessionActions();

  const scrollToBottom = (smooth = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
    applyScrollStick(pinStick());
  };

  return (
    <div className="composer-wrap">
      {needsModelSetup ? (
        <div className="approval-gate-card" role="status">
          <span className="approval-gate-text">尚未配置可用模型，聊天无法调用助手</span>
          <div className="approval-gate-actions">
            <button type="button" className="btn-primary" onClick={() => void shellSessionActions().openSettings("llm")}>
              去配置模型
            </button>
          </div>
        </div>
      ) : null}
      {approvalGate && conversation?.id === approvalGate.conversationId ? (
        <div className="approval-gate-card" role="status">
          <span className="approval-gate-text">工具需要你确认后才能继续</span>
          <div className="approval-gate-actions">
            <button type="button" className="btn-secondary" onClick={() => chat.onApprovalDeny()}>
              拒绝
            </button>
            <button type="button" className="btn-primary" onClick={() => chat.onApprovalAllow()}>
              批准
            </button>
          </div>
        </div>
      ) : null}
      {showScrollBottom ? (
        <button type="button" className="scroll-bottom-btn" title="滚到底部" onClick={() => scrollToBottom(true)}>
          <ChevronDown size={16} strokeWidth={2.2} aria-hidden />
        </button>
      ) : null}
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={(e) => void chat.onSubmit(e)}
        onStop={() => chat.stopCurrentRun({ markStopped: true })}
        sending={chatProcessing}
        disabled={needsModelSetup}
        agentName={activeChannel ? activeChannel.name : activeAgent?.name}
        files={pendingFiles}
        onFilesChange={setPendingFiles}
        mentionItems={composerMentionItems}
        skillOptions={composerSkills}
        groupChat={Boolean(activeChannel)}
        replyTo={replyTarget}
        onClearReply={() => setReplyTarget(null)}
      />
    </div>
  );
}
