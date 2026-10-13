import type { UiMessage } from "../../types/app-ui";
import { indexMessages, type IndexedMessages } from "./chatTimeline";

export type TranscriptBanner = "loading" | "onboarding" | "empty" | null;

export function isChatProcessing(flags: {
  sending: boolean;
  taskBusy: boolean;
  viewingRunActive: boolean;
}): boolean {
  return flags.sending || flags.taskBusy || flags.viewingRunActive;
}

export type TranscriptView = {
  banner: TranscriptBanner;
  showLiveRun: boolean;
  indexed: IndexedMessages;
};

function assistantIsStreamingText(message: UiMessage): boolean {
  return message.role === "assistant" && Boolean(message.streaming) && Boolean(message.content);
}

/** 这段会话现在画哪一屏：加载、引导、空态，或直接进入时间线；以及运行条是否还要单独出现。 */
export function resolveTranscriptView(input: {
  selectionHydrated: boolean;
  chatSwitchPending: boolean;
  channelId?: string | null;
  onboardingDismissed: boolean;
  chatProcessing: boolean;
  messages: UiMessage[];
}): TranscriptView {
  const { messages } = input;
  const hasChatMessages = messages.some((message) => message.role === "user" || message.role === "assistant");
  const loading = !input.selectionHydrated || (input.chatSwitchPending && messages.length === 0);
  const showOnboarding = Boolean(
    input.selectionHydrated &&
      !input.channelId &&
      !hasChatMessages &&
      !input.onboardingDismissed &&
      !input.chatProcessing &&
      !input.chatSwitchPending,
  );
  let banner: TranscriptBanner = null;
  if (loading) banner = "loading";
  else if (showOnboarding) banner = "onboarding";
  else if (messages.length === 0) banner = "empty";

  return {
    banner,
    showLiveRun: input.chatProcessing && !messages.some(assistantIsStreamingText),
    indexed: indexMessages(messages),
  };
}
