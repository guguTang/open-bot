import { ONBOARDING_WELCOME, type OnboardingOption } from "../../botOnboarding";
import { BotOnboardingCard } from "../../BotOnboardingCard";
import { ChatMessage } from "../../ChatMessage";
import { chatSessionActions, overlaySessionActions } from "../../../stores/sessionActions";
import { useWorkspaceStore } from "../../../stores/workspace";
import type { TranscriptBanner } from "../transcriptView";

export function ChatTranscriptBanner({
  banner,
  chatProcessing,
}: {
  banner: Exclude<TranscriptBanner, null>;
  chatProcessing: boolean;
}) {
  const agents = useWorkspaceStore((s) => s.agents);
  const chat = chatSessionActions();

  if (banner === "loading") {
    return (
      <div className="empty">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (banner === "onboarding") {
    return (
      <>
        {ONBOARDING_WELCOME.map((text) => (
          <ChatMessage
            key={text}
            message={{ id: `onboard-welcome-${text}`, role: "assistant", content: text }}
          />
        ))}
        <BotOnboardingCard
          disabled={chatProcessing}
          onSelectOption={(opt: OnboardingOption) => chat.onOnboardingSelect(opt)}
          onCustomSubmit={(customText) => chat.onOnboardingCustom(customText)}
          onDismiss={() => chat.onOnboardingDismiss()}
        />
      </>
    );
  }

  return (
    <div className="empty">
      <h2>有什么可以帮你的？</h2>
      <p>
        {agents.length === 0
          ? "还没有助手。点下方创建一位，再选岗位即可开始聊天。"
          : "从左侧选择一位助手进入连续对话；群聊里可用 @ 点名助手。"}
      </p>
      {agents.length === 0 ? (
        <p style={{ marginTop: 12 }}>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const overlay = overlaySessionActions();
              overlay.setNewChatInitialMode("bot");
              overlay.setShowNewChat(true);
            }}
          >
            新建助手
          </button>
        </p>
      ) : null}
    </div>
  );
}
