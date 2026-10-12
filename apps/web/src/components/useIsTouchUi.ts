import { useEffect, useState } from "react";

/**
 * Breakpoint tokens (bot-breakpoints-p1.md) — keep CSS @media in sync.
 * Orthogonal: wide + coarse = dual pane + touch gestures; narrow + fine = single pane + hover ok.
 *
 * | Token          | Condition                         | Controls                                      |
 * | layout-narrow  | max-width: 860px                  | sidebar↔chat master-detail, mobileView, sheet |
 * | touch-ui       | pointer: coarse OR max-width 767  | Action Sheet / hide hover / html.touch-ui     |
 * | panel-compact  | max-width: 720px                  | thread full-bleed, settings nav, msg-actions  |
 */
export const LAYOUT_NARROW_MQ = "(max-width: 860px)";
export const TOUCH_UI_WIDTH_MQ = "(max-width: 767px)";
export const PANEL_COMPACT_MQ = "(max-width: 720px)";
export const POINTER_COARSE_MQ = "(pointer: coarse)";

const TOUCH_UI_CLASS = "touch-ui";

function readTouchUi(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia(POINTER_COARSE_MQ).matches ||
    window.matchMedia(TOUCH_UI_WIDTH_MQ).matches
  );
}

function syncTouchUiClass(on: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(TOUCH_UI_CLASS, on);
}

/**
 * touch-ui token: Action Sheet, no hover-only bars.
 * `pointer: coarse` OR width ≤767. Wide touch tablets get the sheet.
 * Also toggles `html.touch-ui` so CSS matches the same rule.
 */
export function useIsNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(LAYOUT_NARROW_MQ).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(LAYOUT_NARROW_MQ);
    const sync = () => setNarrow(mq.matches);
    sync();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", sync);
      return () => mq.removeEventListener("change", sync);
    }
    mq.addListener(sync);
    return () => mq.removeListener(sync);
  }, []);

  return narrow;
}

export function useIsTouchUi(): boolean {
  const [touch, setTouch] = useState(readTouchUi);

  useEffect(() => {
    const pointerMq = window.matchMedia(POINTER_COARSE_MQ);
    const narrowMq = window.matchMedia(TOUCH_UI_WIDTH_MQ);
    const sync = () => {
      const next = pointerMq.matches || narrowMq.matches;
      setTouch(next);
      syncTouchUiClass(next);
    };
    sync();
    pointerMq.addEventListener("change", sync);
    narrowMq.addEventListener("change", sync);
    return () => {
      pointerMq.removeEventListener("change", sync);
      narrowMq.removeEventListener("change", sync);
    };
  }, []);

  return touch;
}

/**
 * Create Bot / settings form: full-width bottom sheet when touch-ui OR layout-narrow (≤860).
 */
export function useSheetFormUi(): boolean {
  const touch = useIsTouchUi();
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(LAYOUT_NARROW_MQ).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(LAYOUT_NARROW_MQ);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return touch || narrow;
}
