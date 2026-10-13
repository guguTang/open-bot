/**
 * Shared pending / source / warning body fragments for diagram cards.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  diagramBodyClass,
  diagramBodyPendingClass,
  diagramPendingDotClass,
  diagramPendingLabelClass,
  diagramSourceClass,
  diagramSourceTailClass,
  diagramWarningClass,
} from "./diagramUi";

/** Keep the streaming source tail scrolled to the newest lines. */
export function useDiagramSourceTailScroll(source: string, active: boolean) {
  const tailRef = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (!active) return;
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [source, active]);
  return tailRef;
}

export function DiagramPendingBody({
  source,
  label = "生成中…",
}: {
  source: string;
  label?: string;
}) {
  const tailRef = useDiagramSourceTailScroll(source, true);
  return (
    <div className={diagramBodyPendingClass} aria-busy="true">
      <div className={diagramPendingLabelClass}>
        <span className={diagramPendingDotClass} aria-hidden="true" />
        {label}
      </div>
      <pre ref={tailRef} className={diagramSourceTailClass}>
        {source}
      </pre>
    </div>
  );
}

export function DiagramSourceBody({
  source,
  warning,
  children,
}: {
  source?: string;
  warning?: ReactNode;
  /** Optional extra content when there is no source pre (e.g. empty state). */
  children?: ReactNode;
}) {
  return (
    <div className={diagramBodyClass}>
      {warning ? (
        <div className={diagramWarningClass} role="status">
          {warning}
        </div>
      ) : null}
      {source != null ? <pre className={diagramSourceClass}>{source}</pre> : null}
      {children}
    </div>
  );
}
