import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { Agent, Channel } from "../api";
import { patchShell } from "../stores/shell";

const CONV_LONG_PRESS_MS = 400;
const CONV_MOVE_CANCEL_PX = 10;

export function useConvLongPressHandlers(touchUi: boolean) {
  const convLongPressTimer = useRef<number | null>(null);
  const convLongPressFired = useRef(false);
  const convLongPressStart = useRef<{ x: number; y: number } | null>(null);

  const clearConvLongPress = useCallback(() => {
    if (convLongPressTimer.current != null) {
      window.clearTimeout(convLongPressTimer.current);
      convLongPressTimer.current = null;
    }
  }, []);

  const beginConvLongPress = useCallback(
    (
      e: ReactPointerEvent,
      target: { kind: "agent"; agent: Agent } | { kind: "channel"; channel: Channel },
    ) => {
      if (!touchUi) return;
      if (e.pointerType === "mouse") return;
      convLongPressStart.current = { x: e.clientX, y: e.clientY };
      convLongPressFired.current = false;
      clearConvLongPress();
      convLongPressTimer.current = window.setTimeout(() => {
        convLongPressTimer.current = null;
        convLongPressFired.current = true;
        patchShell({ convSheet: target });
        try {
          navigator.vibrate?.(10);
        } catch {
          /* ignore */
        }
      }, CONV_LONG_PRESS_MS);
    },
    [touchUi, clearConvLongPress],
  );

  const moveConvLongPress = useCallback(
    (e: ReactPointerEvent) => {
      if (!convLongPressStart.current || convLongPressTimer.current == null) return;
      const dx = Math.abs(e.clientX - convLongPressStart.current.x);
      const dy = Math.abs(e.clientY - convLongPressStart.current.y);
      if (dx + dy > CONV_MOVE_CANCEL_PX) clearConvLongPress();
    },
    [clearConvLongPress],
  );

  const endConvLongPress = useCallback(() => {
    clearConvLongPress();
    convLongPressStart.current = null;
    if (convLongPressFired.current) {
      convLongPressFired.current = false;
      const swallow = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 500);
    }
  }, [clearConvLongPress]);

  return {
    beginConvLongPress,
    moveConvLongPress,
    endConvLongPress,
  };
}
