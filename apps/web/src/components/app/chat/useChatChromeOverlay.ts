import { type RefObject, useEffect } from "react";
import { chatScrollRef } from "../../../stores/chat";

/** Size the transcript's scroll padding to the floating topbar and composer. */
export function useChatChromeOverlay(
  mainRef: RefObject<HTMLElement | null>,
  messagesRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const topbar = main.querySelector<HTMLElement>(":scope > .topbar");
    const composer = main.querySelector<HTMLElement>(":scope > .composer-wrap");
    if (!topbar || !composer) return;

    const apply = () => {
      main.style.setProperty("--chat-top-overlay", `${topbar.offsetHeight}px`);
      main.style.setProperty("--chat-composer-overlay", `${composer.offsetHeight}px`);
      const el = messagesRef.current;
      if (el && chatScrollRef.stickToBottom) {
        chatScrollRef.suppressStick = true;
        el.scrollTop = 0;
        chatScrollRef.suppressStick = false;
      }
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(topbar);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [mainRef, messagesRef]);
}
