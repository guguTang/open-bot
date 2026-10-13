import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { OPENBOT_SYSTEM_BACK_EVENT } from "../lib/mobileSystemBack";

export type UseDialogChromeOptions = {
  /** When false, use `show()` instead of `showModal()`. Default true. */
  modal?: boolean;
  /** When true, block Escape / mask / system-back from closing. */
  blockDismiss?: boolean;
  /** Return false to keep the dialog open (e.g. nested back navigation). */
  onDismiss?: () => boolean | void;
  /** Lock `document.body` overflow while open. Default true. */
  lockScroll?: boolean;
  /**
   * Listen for `OPENBOT_SYSTEM_BACK_EVENT` and dismiss via the same path as Escape/mask.
   * Default false — parent shell already owns many overlays; opt in for child overlays
   * and modals not on that stack.
   */
  systemBack?: boolean;
  /** Class for the backdrop mask button. Default `modal-backdrop-mask`. */
  maskClassName?: string;
  /** aria-label for the backdrop mask. Default `关闭`. */
  maskAriaLabel?: string;
};

/** @deprecated Use UseDialogChromeOptions */
export type UseDialogOpenOptions = UseDialogChromeOptions;

export type DialogChromeMaskProps = {
  type: "button";
  className: string;
  "aria-label": string;
  disabled: boolean;
  onClick: () => void;
};

export type DialogChrome = {
  ref: RefObject<HTMLDialogElement | null>;
  /** Shared dismiss path for Escape, mask, and optional system back. */
  dismiss: () => void;
  maskProps: DialogChromeMaskProps;
};

/** Shared dismiss policy for Escape / mask / system-back. */
export function resolveDialogDismiss(opts: {
  blockDismiss?: boolean;
  onDismiss?: () => boolean | void;
}): "blocked" | "nested" | "close" {
  if (opts.blockDismiss) return "blocked";
  if (opts.onDismiss?.() === false) return "nested";
  return "close";
}

/**
 * Dialog chrome: syncs native `<dialog>` open state and owns dismiss policy,
 * optional scroll lock, optional system-back, and backdrop-mask props.
 */
export function useDialogChrome(
  open: boolean,
  onClose: () => void,
  options: UseDialogChromeOptions = {},
): DialogChrome {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const optionsRef = useRef(options);
  const suppressCloseEventRef = useRef(false);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    optionsRef.current = options;
  });

  const dismiss = useCallback(() => {
    if (resolveDialogDismiss(optionsRef.current) !== "close") return;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const modal = options.modal !== false;
    if (open) {
      if (modal) {
        if (!dialog.open) dialog.showModal();
      } else if (!dialog.open) {
        dialog.show();
      }
    } else if (dialog.open) {
      suppressCloseEventRef.current = true;
      dialog.close();
      suppressCloseEventRef.current = false;
    }
  }, [open, options.modal]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const onCancel = (event: Event) => {
      event.preventDefault();
      dismiss();
    };

    const onDialogClose = () => {
      if (suppressCloseEventRef.current) return;
      onCloseRef.current();
    };

    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onDialogClose);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onDialogClose);
    };
  }, [dismiss]);

  const lockScroll = options.lockScroll !== false;
  useEffect(() => {
    if (!open || !lockScroll) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, lockScroll]);

  const systemBack = options.systemBack === true;
  useEffect(() => {
    if (!open || !systemBack) return;
    const onSystemBack = (event: Event) => {
      event.preventDefault();
      dismiss();
    };
    document.addEventListener(OPENBOT_SYSTEM_BACK_EVENT, onSystemBack);
    return () => document.removeEventListener(OPENBOT_SYSTEM_BACK_EVENT, onSystemBack);
  }, [open, systemBack, dismiss]);

  const maskClassName = options.maskClassName ?? "modal-backdrop-mask";
  const maskAriaLabel = options.maskAriaLabel ?? "关闭";

  return {
    ref,
    dismiss,
    maskProps: {
      type: "button",
      className: maskClassName,
      "aria-label": maskAriaLabel,
      disabled: Boolean(options.blockDismiss),
      onClick: dismiss,
    },
  };
}

/**
 * Syncs `open` with a native `<dialog>` via showModal/show/close and wires cancel → onClose.
 * Prefer {@link useDialogChrome} when you also need scroll lock, system back, or mask props.
 */
export function useDialogOpen(
  open: boolean,
  onClose: () => void,
  options: UseDialogChromeOptions = {},
): RefObject<HTMLDialogElement | null> {
  return useDialogChrome(open, onClose, options).ref;
}
