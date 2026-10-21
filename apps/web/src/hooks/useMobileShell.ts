import { useCallback, useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { installSafeAreaInsets } from "../lib/safeAreaInsets";
import {
  EXIT_TOAST_COPY,
  LIST_ROOT_EXIT_WINDOW_MS,
  handleSystemBack,
  installCapacitorBackButton,
  notifySystemBackOverlays,
  type SystemBackResult,
} from "../lib/mobileSystemBack";
import { useIsNarrowLayout, useIsTouchUi, useSheetFormUi } from "../components/useIsTouchUi";
import { patchShell, shellState } from "../stores/shell";

export type UseMobileShellOptions = {
  showSettings: boolean;
  closeSettings: () => void;
  dismissConfirm: () => boolean;
  secretPromptOpen: boolean;
  dismissSecretPrompt: () => void;
};

export function useMobileShell(opts: UseMobileShellOptions) {
  const { showSettings, closeSettings, dismissConfirm, secretPromptOpen, dismissSecretPrompt } = opts;

  const touchUi = useIsTouchUi();
  const sheetForm = useSheetFormUi();
  const isNarrowLayout = useIsNarrowLayout();

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void installSafeAreaInsets().then((c) => {
      if (cancelled) {
        c();
        return;
      }
      cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!sheetForm) {
      document.documentElement.style.removeProperty("--vv-height");
      document.documentElement.style.removeProperty("--vv-offset-top");
      document.documentElement.style.removeProperty("--keyboard-inset");
      return;
    }
    const root = document.documentElement;
    const sync = () => {
      const vv = window.visualViewport;
      if (!vv) {
        root.style.setProperty("--vv-height", `${window.innerHeight}px`);
        root.style.setProperty("--vv-offset-top", "0px");
        root.style.setProperty("--keyboard-inset", "0px");
        return;
      }
      root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-offset-top", `${Math.round(vv.offsetTop)}px`);
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
    };
    sync();
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-offset-top");
      root.style.removeProperty("--keyboard-inset");
    };
  }, [sheetForm]);

  const lastListRootBackAtRef = useRef<number | null>(null);

  const runSystemBack = useCallback((): SystemBackResult => {
    const shell = shellState();
    const result = handleSystemBack(
      {
        dismissConfirm,
        secretPromptOpen,
        dismissSecretPrompt,
        feedbackOpen: Boolean(shell.feedbackTarget),
        dismissFeedback: () => patchShell({ feedbackTarget: null }),
        trainOpen: Boolean(shell.trainAgent),
        dismissTrain: () => patchShell({ trainAgent: null }),
        avatarSettingsOpen: Boolean(shell.avatarSettingsAgent),
        dismissAvatarSettings: () => patchShell({ avatarSettingsAgent: null }),
        createSheetOpen: shell.createSheetOpen,
        dismissCreateSheet: () => patchShell({ createSheetOpen: false }),
        newChatOpen: shell.showNewChat,
        dismissNewChat: () => patchShell({ showNewChat: false, newChatInitialMode: "list" }),
        convSheetOpen: Boolean(shell.convSheet),
        dismissConvSheet: () => patchShell({ convSheet: null }),
        showSettings,
        settingsShellHub: shell.settingsShellHub,
        setSettingsShellHub: (v) => patchShell({ settingsShellHub: v }),
        closeSettings,
        mobileView: shell.mobileView,
        setMobileView: (v) => patchShell({ mobileView: v }),
        isNarrowLayout,
      },
      {
        lastListRootBackAt: lastListRootBackAtRef.current,
        onExitPrompt: () => {
          lastListRootBackAtRef.current = Date.now();
          toast.message(EXIT_TOAST_COPY, { duration: LIST_ROOT_EXIT_WINDOW_MS });
        },
        notifyChildOverlays: notifySystemBackOverlays,
      },
    );
    if (result.action === "exit-ready") {
      lastListRootBackAtRef.current = null;
    }
    return result;
  }, [
    closeSettings,
    dismissConfirm,
    dismissSecretPrompt,
    isNarrowLayout,
    secretPromptOpen,
    showSettings,
  ]);

  useEffect(() => {
    if (shellState().mobileView === "chat" || showSettings) {
      lastListRootBackAtRef.current = null;
    }
  }, [showSettings]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void installCapacitorBackButton({
      onBack: () => runSystemBack(),
    }).then((c) => {
      if (cancelled) {
        c();
        return;
      }
      cleanup = c;
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [runSystemBack]);

  return {
    isNarrowLayout,
    touchUi,
    sheetForm,
    runSystemBack,
  };
}
