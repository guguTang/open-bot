/**
 * Shared diagram-card shell (pill + toolbar + body). Used by Mermaid / HTML / 图片 cards.
 * P1-A: when the card is too narrow for pill + action buttons, collapse actions into a ⋯ menu.
 */
import { cn } from "@/lib/utils";
import { Ellipsis } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  diagramActionsClass,
  diagramActionsInlineClass,
  diagramActionsMoreClass,
  diagramBtnIconClass,
  diagramCardClass,
  diagramMenuItemClass,
  diagramMenuWrapClass,
  diagramOverflowMenuClass,
  diagramPillClass,
  diagramToolbarClass,
  diagramToolbarExtraClass,
} from "./diagram/diagramUi";

export type DiagramKind = "mermaid" | "html" | "image";

export const KIND_LABEL: Record<DiagramKind, string> = {
  mermaid: "Mermaid",
  html: "HTML",
  image: "图片",
};

/** Flat items shown in the toolbar ⋯ menu when inline actions do not fit. */
export type DiagramOverflowItem = {
  key: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
};

function IconMore() {
  return <Ellipsis size={16} aria-hidden focusable={false} />;
}

function DiagramOverflowMenu({ items }: { items: DiagramOverflowItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={diagramMenuWrapClass} ref={wrapRef}>
      <button
        type="button"
        className={diagramBtnIconClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多"
        title="更多"
        onClick={() => setOpen((v) => !v)}
      >
        <IconMore />
      </button>
      {open ? (
        <div className={diagramOverflowMenuClass} role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={diagramMenuItemClass}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                if (!item.disabled) item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function DiagramCardFrame({
  kind,
  pending,
  extra,
  actions,
  overflowItems,
  children,
}: {
  kind: DiagramKind;
  pending?: boolean;
  extra?: ReactNode;
  actions: ReactNode;
  /** When set, toolbar collapses to ⋯ if pill + actions cannot fit the card width. */
  overflowItems?: DiagramOverflowItem[];
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const inlineWidthRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const canCollapse = Boolean(overflowItems && overflowItems.length > 0);

  useLayoutEffect(() => {
    if (!canCollapse) {
      setCollapsed(false);
      return;
    }
    const card = cardRef.current;
    const toolbar = toolbarRef.current;
    const inline = inlineRef.current;
    if (!card || !toolbar) return;

    const measure = () => {
      // Prefer live inline width; fall back to last known when hidden for measure.
      if (inline && inline.offsetWidth > 0) {
        inlineWidthRef.current = inline.offsetWidth;
      }
      const pill = toolbar.querySelector("[data-diagram-pill]") as HTMLElement | null;
      const extraEl = toolbar.querySelector("[data-diagram-toolbar-extra]") as HTMLElement | null;
      const pad = 18;
      const gap = 6;
      const chrome =
        (pill?.offsetWidth ?? 0) +
        (extraEl && extraEl.offsetWidth > 0 ? extraEl.offsetWidth + gap : 0) +
        pad;
      const needInline = chrome + Math.max(inlineWidthRef.current, 1);
      const w = card.clientWidth;

      if (collapsed) {
        if (w >= needInline + 4) setCollapsed(false);
      } else if (inlineWidthRef.current > 0) {
        if (toolbar.scrollWidth > toolbar.clientWidth + 1 || w < needInline) {
          setCollapsed(true);
        }
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, [canCollapse, collapsed]);

  return (
    <div
      ref={cardRef}
      data-diagram-card
      data-kind={kind}
      data-pending={pending ? "" : undefined}
      className={cn(diagramCardClass, pending && "is-pending")}
    >
      <div className={diagramToolbarClass} ref={toolbarRef}>
        <span className={diagramPillClass} data-diagram-pill>
          {KIND_LABEL[kind]}
        </span>
        {extra ? (
          <div className={diagramToolbarExtraClass} data-diagram-toolbar-extra>
            {extra}
          </div>
        ) : null}
        <div className={diagramActionsClass}>
          <div
            className={diagramActionsInlineClass(collapsed)}
            ref={inlineRef}
            aria-hidden={collapsed}
          >
            {actions}
          </div>
          {canCollapse ? (
            <div className={diagramActionsMoreClass(collapsed)}>
              <DiagramOverflowMenu items={overflowItems!} />
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
