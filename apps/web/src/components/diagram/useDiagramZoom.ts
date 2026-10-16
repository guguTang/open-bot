/**
 * Zoom by resizing the host SVG (vector-crisp, native scrollbars pan).
 * Ctrl/Cmd + wheel (and trackpad pinch as ctrl+wheel); optional touch pinch.
 */
import { clamp } from "es-toolkit";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type Anchor = { vx: number; vy: number; cx: number; cy: number };

export const DIAGRAM_INLINE_ZOOM = { min: 0.5, max: 2 } as const;
export const DIAGRAM_FULLSCREEN_ZOOM = { min: 0.25, max: 4 } as const;
/** Image lightbox: allow deep fit-contain under 25% for large screenshots. */
export const DIAGRAM_IMAGE_FULLSCREEN_ZOOM = { min: 0.05, max: 8 } as const;

export function useDiagramZoom(
  el: HTMLElement | null,
  opts: { min: number; max: number; enabled: boolean; pinch?: boolean },
) {
  const { min, max, enabled, pinch } = opts;
  const [scale, setScaleState] = useState(1);
  const scaleRef = useRef(1);
  const anchorRef = useRef<Anchor | null>(null);

  const setScale = useCallback(
    (next: number | ((s: number) => number), at?: { clientX: number; clientY: number }) => {
      const prev = scaleRef.current;
      const raw = typeof next === "function" ? next(prev) : next;
      const s = Math.round(clamp(raw, min, max) * 100) / 100;
      if (s === prev) return;
      if (el) {
        const rect = el.getBoundingClientRect();
        const vx = at ? at.clientX - rect.left : el.clientWidth / 2;
        const vy = at ? at.clientY - rect.top : el.clientHeight / 2;
        anchorRef.current = { vx, vy, cx: (el.scrollLeft + vx) / prev, cy: (el.scrollTop + vy) / prev };
      }
      scaleRef.current = s;
      setScaleState(s);
    },
    [el, min, max],
  );

  // Runs after DiagramSvg's own layout effect resized the <svg> (child effects run first).
  useLayoutEffect(() => {
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!a || !el) return;
    el.scrollLeft = a.cx * scale - a.vx;
    el.scrollTop = a.cy * scale - a.vy;
  }, [el, scale]);

  useEffect(() => {
    if (!el || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel = scroll inside the card
      e.preventDefault();
      setScale((s) => s * Math.exp(-e.deltaY * 0.0015), e);
    };
    let start: { dist: number; scale: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e.touches) || 1, scale: scaleRef.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const mid = {
        clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      setScale(start.scale * (dist(e.touches) / start.dist), mid);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    if (pinch) {
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove", onTouchMove, { passive: false });
      el.addEventListener("touchend", onTouchEnd);
      el.addEventListener("touchcancel", onTouchEnd);
    }
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [el, enabled, pinch, setScale]);

  return { scale, setScale };
}
