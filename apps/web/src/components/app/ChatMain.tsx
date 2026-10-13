import { useRef } from "react";
import { useShellStore } from "../../stores/shell";
import { ChatComposerDock } from "./chat/ChatComposerDock";
import { ChatTopbar } from "./chat/ChatTopbar";
import { ChatTranscript } from "./chat/ChatTranscript";
import { useChatChromeOverlay } from "./chat/useChatChromeOverlay";
import { useChatScrollPin } from "./chat/useChatScrollPin";

export function ChatMain() {
  const hostActivity = useShellStore((s) => s.hostActivity);
  const mainRef = useRef<HTMLElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  useChatChromeOverlay(mainRef, messagesRef);
  useChatScrollPin(messagesRef);
  return (
    <main className="main" ref={mainRef}>
      {hostActivity ? <div className="status host-activity">{hostActivity}</div> : null}
      <ChatTopbar />
      <ChatTranscript messagesRef={messagesRef} />
      <ChatComposerDock messagesRef={messagesRef} />
    </main>
  );
}
