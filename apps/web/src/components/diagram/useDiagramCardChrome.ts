/**
 * Shared diagram-card interaction chrome: source toggle + fullscreen open/close.
 * Kind adapters (Mermaid / HTML / image) plug render bodies into this state.
 */
import { useCallback, useState } from "react";

export type UseDiagramCardChromeOptions = {
  /** When false, fullscreen auto-closes (e.g. render failed / still loading). */
  ready: boolean;
};

export type DiagramCardChrome = {
  showSource: boolean;
  setShowSource: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleSource: () => void;
  fullscreen: boolean;
  openFullscreen: () => void;
  closeFullscreen: () => void;
};

/** Source-toggle + fullscreen state shared by Mermaid / HTML / image cards. */
export function useDiagramCardChrome({ ready }: UseDiagramCardChromeOptions): DiagramCardChrome {
  const [showSource, setShowSource] = useState(false);
  const [fullscreenWanted, setFullscreenWanted] = useState(false);

  if (!ready && fullscreenWanted) {
    setFullscreenWanted(false);
  }

  const fullscreen = ready && fullscreenWanted;

  const toggleSource = useCallback(() => setShowSource((v) => !v), []);
  const openFullscreen = useCallback(() => {
    if (ready) setFullscreenWanted(true);
  }, [ready]);
  const closeFullscreen = useCallback(() => setFullscreenWanted(false), []);

  return {
    showSource,
    setShowSource,
    toggleSource,
    fullscreen,
    openFullscreen,
    closeFullscreen,
  };
}
