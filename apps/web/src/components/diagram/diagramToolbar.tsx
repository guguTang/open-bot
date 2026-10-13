/**
 * Shared toolbar action controls + overflow item helpers for diagram cards.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DiagramIconCaret,
  DiagramIconDownload,
  DiagramIconExpand,
} from "./diagramIcons";
import {
  diagramBtnDownloadClass,
  diagramBtnIconClass,
  diagramBtnTextClass,
  diagramMenuClass,
  diagramMenuItemClass,
  diagramMenuWrapClass,
} from "./diagramUi";

export function DiagramTextButton({
  children,
  disabled,
  pressed,
  title,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={diagramBtnTextClass}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function DiagramIconButton({
  ariaLabel,
  title,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={diagramBtnIconClass}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Source ⇄ preview toggle used by Mermaid / HTML. */
export function DiagramSourceToggleButton({
  viewSource,
  ready,
  pressed,
  disabledTitle,
  previewLabel,
  sourceLabel = "源码",
  onClick,
}: {
  viewSource: boolean;
  ready: boolean;
  /** Defaults to `viewSource && ready` (HTML). Mermaid passes `viewSource` so failed→source stays pressed. */
  pressed?: boolean;
  disabledTitle?: string;
  /** Label when currently showing source (click to return to diagram/preview). */
  previewLabel: string;
  sourceLabel?: string;
  onClick: () => void;
}) {
  const showPreviewLabel = viewSource && ready;
  return (
    <DiagramTextButton
      pressed={pressed ?? showPreviewLabel}
      disabled={!ready}
      title={!ready ? disabledTitle : undefined}
      onClick={onClick}
    >
      {showPreviewLabel ? previewLabel : sourceLabel}
    </DiagramTextButton>
  );
}

export function DiagramCopyButton({
  onClick,
  disabled,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <DiagramTextButton onClick={onClick} disabled={disabled} title={title}>
      复制
    </DiagramTextButton>
  );
}

export function DiagramExpandButton({
  ready,
  onClick,
  readyTitle = "全屏",
  disabledTitle = "图表就绪后可全屏",
}: {
  ready: boolean;
  onClick: () => void;
  readyTitle?: string;
  disabledTitle?: string;
}) {
  return (
    <DiagramIconButton
      ariaLabel="全屏"
      title={ready ? readyTitle : disabledTitle}
      disabled={!ready}
      onClick={onClick}
    >
      <DiagramIconExpand />
    </DiagramIconButton>
  );
}

export function DiagramDownloadIconButton({
  onClick,
  disabled,
  ariaLabel,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
}) {
  return (
    <DiagramIconButton ariaLabel={ariaLabel} title={title} disabled={disabled} onClick={onClick}>
      <DiagramIconDownload />
    </DiagramIconButton>
  );
}

/** Mermaid SVG/PNG download split-button. */
export function DiagramDownloadMenu({
  disabled,
  busy,
  onPick,
}: {
  disabled: boolean;
  busy: boolean;
  onPick: (fmt: "svg" | "png") => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuOpen = open && !disabled;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // close the menu first, not the fullscreen modal
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  return (
    <div className={diagramMenuWrapClass} ref={wrapRef}>
      <button
        type="button"
        className={diagramBtnDownloadClass}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="下载"
        title={disabled ? "图表就绪后可下载" : "下载"}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <DiagramIconDownload />
        <DiagramIconCaret />
      </button>
      {menuOpen ? (
        <div className={diagramMenuClass} role="menu">
          {(["svg", "png"] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="menuitem"
              className={diagramMenuItemClass}
              onClick={() => {
                setOpen(false);
                onPick(fmt);
              }}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
