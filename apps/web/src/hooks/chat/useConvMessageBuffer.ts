import { useCallback, useRef } from "react";
import type { Conversation } from "../../api";
import {
  createMessageBuffer,
  type MessagesByConv,
  type PatchConvMessages,
} from "../../lib/app/conversationMessages";
import { setMessages } from "../../stores/chat";

export function useConvMessageBuffer(conversationRef: React.RefObject<Conversation | null>) {
  const messagesByConvRef = useRef<MessagesByConv>(new Map());

  const getViewedConvId = useCallback(() => conversationRef.current?.id, [conversationRef]);

  const { patchConvMessages, snapshotViewedMessages, clearAll } = createMessageBuffer({
    messagesByConvRef,
    getViewedConvId,
    setViewedMessages: setMessages,
  });

  return {
    messagesByConvRef,
    patchConvMessages: patchConvMessages as PatchConvMessages,
    snapshotViewedMessages,
    clearMessageBuffer: clearAll,
  };
}
