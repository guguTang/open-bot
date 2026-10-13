/**
 * Shared fullscreen portal shell for diagram cards.
 * Handles backdrop click, Escape, focus restore; kind adapters supply toolbar + body.
 */
import { cn } from "@/lib/utils";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { useDialogOpen } from "@/components/useDialogOpen";
import { DiagramIconClose } from "./diagramIcons";
import {
  diagramActionsClass,
  diagramBtnIconClass,
  diagramFsBackdropClass,
  diagramFsBackdropImageClass,
  diagramFsBodyClass,
  diagramFsShellClass,
  diagramFsShellImageClass,
  diagramFsToolbarClass,
  diagramPillClass,
} from "./diagramUi";

export type DiagramFullscreenShellProps = {
  /** Kind pill text (Mermaid / HTML / 图片). */
  label: string;
  ariaLabel: string;
  /** Darker shell for image lightbox. */
  variant?: "default" | "image";
  /** Optional center toolbar cluster (e.g. Mermaid zoom). */
  toolbarCenter?: ReactNode;
  /** Right-side actions excluding the close button (close is always appended). */
  actions: ReactNode;
  bodyClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
  onBodyDoubleClick?: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function DiagramFullscreenShell({
  label,
  ariaLabel,
  variant = "default",
  toolbarCenter,
  actions,
  bodyClassName,
  bodyRef,
  onBodyDoubleClick,
  onClose,
  children,
}: DiagramFullscreenShellProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogOpen(true, onClose);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      prevFocus?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className={cn(
        "relative m-0 max-h-none max-w-none border-none p-0 text-inherit",
        diagramFsBackdropClass,
        variant === "image" && diagramFsBackdropImageClass,
      )}
      aria-label={ariaLabel}
    >
      <button type="button" className="modal-backdrop-mask" aria-label="关闭" onClick={onClose} />
      <div
        className={cn(
          "relative z-1",
          variant === "image" ? diagramFsShellImageClass : diagramFsShellClass,
        )}
      >
        <div className={diagramFsToolbarClass}>
          <span className={diagramPillClass}>{label}</span>
          {toolbarCenter}
          <div className={diagramActionsClass}>
            {actions}
            <button
              ref={closeRef}
              type="button"
              className={diagramBtnIconClass}
              aria-label="关闭"
              title="关闭 (Esc)"
              onClick={onClose}
            >
              <DiagramIconClose />
            </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          className={bodyClassName ?? diagramFsBodyClass()}
          onDoubleClick={onBodyDoubleClick}
        >
          {children}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
