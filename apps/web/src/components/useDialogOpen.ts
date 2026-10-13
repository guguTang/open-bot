import { useEffect, useRef, type RefObject } from "react";

export type UseDialogOpenOptions = {
  /** When false, use `show()` instead of `showModal()`. Default true. */
  modal?: boolean;
  /** When true, block Escape / cancel from closing. */
  blockDismiss?: boolean;
  /** Return false to keep the dialog open (e.g. nested back navigation). */
  onDismiss?: () => boolean | void;
};

/**
 * Syncs `open` with a native `<dialog>` via showModal/show/close and wires cancel → onClose.
 * Suppresses the `close` event callback when closing from the `open` prop going false.
 */
export function useDialogOpen(
  open: boolean,
  onClose: () => void,
  options: UseDialogOpenOptions = {},
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const optionsRef = useRef(options);
  onCloseRef.current = onClose;
  optionsRef.current = options;
  const suppressCloseEventRef = useRef(false);

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
      if (optionsRef.current.blockDismiss) {
        event.preventDefault();
        return;
      }
      if (optionsRef.current.onDismiss?.() === false) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onCloseRef.current();
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
  }, []);

  return ref;
}
