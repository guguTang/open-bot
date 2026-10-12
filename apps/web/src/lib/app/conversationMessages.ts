import type { MutableRefObject } from "react";
import type { Conversation } from "../../api";
import type { UiMessage } from "../../types/app-ui";
import { viewedMessages } from "../../stores/chat";

export type MessagesByConv = Map<string, UiMessage[]>;

export type PatchConvMessages = (
  convId: string,
  updater: (prev: UiMessage[]) => UiMessage[],
) => void;

export function createMessageBuffer(deps: {
  messagesByConvRef: MutableRefObject<MessagesByConv>;
  getViewedConvId: () => string | undefined;
  setViewedMessages: (next: UiMessage[]) => void;
}): {
  patchConvMessages: PatchConvMessages;
  snapshotViewedMessages: () => void;
  clearAll: () => void;
} {
  const patchConvMessages: PatchConvMessages = (convId, updater) => {
    const prev = deps.messagesByConvRef.current.get(convId) ?? [];
    const next = updater(prev);
    deps.messagesByConvRef.current.set(convId, next);
    if (deps.getViewedConvId() === convId) {
      deps.setViewedMessages(next);
    }
  };

  const snapshotViewedMessages = () => {
    const id = deps.getViewedConvId();
    if (!id) return;
    deps.messagesByConvRef.current.set(id, viewedMessages());
  };

  const clearAll = () => {
    deps.messagesByConvRef.current.clear();
  };

  return { patchConvMessages, snapshotViewedMessages, clearAll };
}

export function selectionKeyForConv(conv: Conversation) {
  return conv.channel_id ? `channel:${conv.channel_id}` : `agent:${conv.agent_id}`;
}
