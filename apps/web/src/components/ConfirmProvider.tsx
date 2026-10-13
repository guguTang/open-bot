import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/buttonVariants";
import { cn } from "@/lib/utils";
import { useSheetFormUi } from "./useIsTouchUi";
import { useDialogChrome } from "./useDialogOpen";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Returns true if a confirm was open and is now dismissed (resolved false). */
type DismissConfirmFn = () => boolean;

const DismissConfirmContext = createContext<DismissConfirmFn>(() => false);

const ConfirmOpenContext = createContext<() => boolean>(() => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const resultRef = useRef<boolean | null>(null);
  const openRef = useRef(false);
  useLayoutEffect(() => {
    openRef.current = open;
  });
  const sheetUi = useSheetFormUi();

  const confirm = useCallback<ConfirmFn>((opts) => {
    resultRef.current = null;
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    if (!resolveRef.current) return;
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resultRef.current = value;
    setOpen(false);
    resolve(value);
  }, []);

  const dismiss = useCallback<DismissConfirmFn>(() => {
    if (!openRef.current || !resolveRef.current) return false;
    settle(false);
    return true;
  }, [settle]);

  const isOpen = useCallback(() => openRef.current, []);

  const cancelLabel = options?.cancelLabel ?? "取消";
  const confirmLabel = options?.confirmLabel ?? (options?.danger ? "删除" : "确认");
  const dismissConfirm = useCallback(() => settle(false), [settle]);
  const { ref: confirmSheetRef, maskProps: confirmMaskProps } = useDialogChrome(
    Boolean(open && options && sheetUi),
    dismissConfirm,
    { maskClassName: "action-sheet-mask" },
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      <DismissConfirmContext.Provider value={dismiss}>
        <ConfirmOpenContext.Provider value={isOpen}>
      {children}
      {sheetUi ? (
        open && options ? (
          <dialog
            ref={confirmSheetRef}
            className="action-sheet-root confirm-sheet-root"
            aria-labelledby="confirm-sheet-title"
            aria-describedby={options.description ? "confirm-sheet-desc" : undefined}
          >
            <button {...confirmMaskProps} />
            <div className="action-sheet confirm-action-sheet">
              <div className="action-sheet-handle" aria-hidden />
              <div id="confirm-sheet-title" className="confirm-sheet-title">
                {options.title}
              </div>
              {options.description ? (
                <div id="confirm-sheet-desc" className="confirm-sheet-desc">
                  {options.description}
                </div>
              ) : null}
              <div className="confirm-sheet-actions">
                <button
                  type="button"
                  className="confirm-sheet-btn confirm-sheet-btn-cancel"
                  onClick={() => settle(false)}
                >
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  className={`confirm-sheet-btn confirm-sheet-btn-confirm${options.danger ? " is-danger" : ""}`}
                  onClick={() => settle(true)}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </dialog>
        ) : null
      ) : (
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (!next) {
              // Escape / overlay / cancel path — Action sets resultRef first.
              settle(resultRef.current ?? false);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{options?.title}</AlertDialogTitle>
              {options?.description ? (
                <AlertDialogDescription>{options.description}</AlertDialogDescription>
              ) : (
                <AlertDialogDescription className="sr-only">确认操作</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  resultRef.current = false;
                }}
              >
                {cancelLabel}
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(options?.danger && buttonVariants({ variant: "destructive" }))}
                onClick={() => {
                  resultRef.current = true;
                }}
              >
                {confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
        </ConfirmOpenContext.Provider>
      </DismissConfirmContext.Provider>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return ctx;
}

/** System-back / gesture: dismiss open confirm as cancel. Safe outside provider (no-op). */
export function useDismissConfirm(): DismissConfirmFn {
  return useContext(DismissConfirmContext);
}

export function useConfirmIsOpen(): () => boolean {
  return useContext(ConfirmOpenContext);
}
