/**
 * DiagramCard — in-bubble diagram card (design: bot-diagram-card-design-v1 / v2).
 *
 * Shared shell (`DiagramCardFrame`) + Mermaid card. HTML → `HtmlDiagramCard`;
 * image → `ImageDiagramCard` (auth attachment URL).
 *
 * States: pending (stream, fence unclosed) → rendering → ok | error. The renderer is only
 * called once the fence is closed (or the stream ended); see lib/mermaidFence.ts.
 */
import { ChevronDown, Download, Maximize2, Minus, Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { diagramFilename } from "../lib/mermaidFence";
import { peekDiagram, renderDiagram, type DiagramRenderResult, type DiagramTheme } from "../lib/mermaidRender";
import { copyText, downloadPng, downloadSvg } from "../lib/diagramExport";
import { useAppTheme } from "./useAppTheme";
import { HtmlDiagramCard } from "./HtmlDiagramCard";
import { ImageDiagramCard } from "./ImageDiagramCard";
import { DiagramCardFrame, type DiagramKind, type DiagramOverflowItem } from "./DiagramCardFrame";

export type { DiagramKind, DiagramOverflowItem } from "./DiagramCardFrame";
export { DiagramCardFrame } from "./DiagramCardFrame";

const INLINE_ZOOM = { min: 0.5, max: 2 };
const FULLSCREEN_ZOOM = { min: 0.25, max: 4 };

/* ---------------- icons (16px) ---------------- */

const diagramIcon = {
  size: 16,
  strokeWidth: 1.5,
  "aria-hidden": true as const,
  focusable: false as const,
};

const IconDownload = () => <Download {...diagramIcon} />;
const IconCaret = () => <ChevronDown size={8} strokeWidth={1.3} aria-hidden focusable={false} />;
const IconExpand = () => <Maximize2 {...diagramIcon} />;
const IconClose = () => <X {...diagramIcon} />;
const IconMinus = () => <Minus {...diagramIcon} />;
const IconPlus = () => <Plus {...diagramIcon} />;

/* ---------------- zoom ---------------- */

type Anchor = { vx: number; vy: number; cx: number; cy: number };

/**
 * Zoom by resizing the SVG (stays vector-crisp, native scrollbars pan).
 * Ctrl/Cmd + wheel (and trackpad pinch, which arrives as ctrl+wheel); optional touch pinch.
 */
function useDiagramZoom(
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
      const s = Math.round(Math.min(max, Math.max(min, raw)) * 100) / 100;
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

/* ---------------- svg host ---------------- */

function DiagramSvg({
  svg,
  width,
  height,
  scale,
  animate,
}: {
  svg: string;
  width: number;
  height: number;
  scale: number;
  animate?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => ({ __html: svg }), [svg]);
  useLayoutEffect(() => {
    const el = hostRef.current?.querySelector("svg");
    if (!el) return;
    // Natural size × zoom; drop mermaid's max-width clamp so wide graphs scroll instead of shrinking.
    el.setAttribute("width", String(Math.max(1, Math.round(width * scale))));
    el.setAttribute("height", String(Math.max(1, Math.round(height * scale))));
    el.style.maxWidth = "none";
    el.style.height = "auto";
    el.style.display = "block";
  }, [svg, width, height, scale]);
  return (
    <div
      ref={hostRef}
      className={`diagram-canvas${animate ? " is-enter" : ""}`}
      // SVG comes from mermaid with securityLevel "strict" (DOMPurify-sanitized labels).
      dangerouslySetInnerHTML={html}
    />
  );
}

/* ---------------- toolbar pieces ---------------- */

function DownloadMenu({
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

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    <div className="diagram-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="diagram-btn diagram-btn-icon diagram-btn-download"
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="下载"
        title={disabled ? "图表就绪后可下载" : "下载"}
        onClick={() => setOpen((v) => !v)}
      >
        <IconDownload />
        <IconCaret />
      </button>
      {open ? (
        <div className="diagram-menu" role="menu">
          {(["svg", "png"] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="menuitem"
              className="diagram-menu-item"
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

/* ---------------- fullscreen ---------------- */

function DiagramFullscreen({
  result,
  source,
  showSource,
  canToggle,
  onToggle,
  onCopy,
  onDownload,
  downloading,
  onClose,
}: {
  result: Extract<DiagramRenderResult, { ok: true }>;
  source: string;
  showSource: boolean;
  canToggle: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onDownload: (fmt: "svg" | "png") => void;
  downloading: boolean;
  onClose: () => void;
}) {
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { scale, setScale } = useDiagramZoom(bodyEl, {
    ...FULLSCREEN_ZOOM,
    enabled: !showSource,
    pinch: true,
  });

  const fitScale = useCallback(
    (widthOnly: boolean) => {
      if (!bodyEl) return 1;
      const pad = 32;
      const sw = (bodyEl.clientWidth - pad) / result.width;
      const sh = (bodyEl.clientHeight - pad) / result.height;
      return widthOnly ? Math.min(1, sw) : Math.min(sw, sh);
    },
    [bodyEl, result.width, result.height],
  );

  // Open at 100%, or fit-to-width when the diagram is wider than the viewport.
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (didInit.current || !bodyEl || showSource) return;
    didInit.current = true;
    setScale(fitScale(true));
  }, [bodyEl, fitScale, setScale, showSource]);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="diagram-fs-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="diagram-fs" role="dialog" aria-modal="true" aria-label="Mermaid 图表">
        <div className="diagram-toolbar diagram-fs-toolbar">
          <span className="diagram-pill">Mermaid</span>
          <div className="diagram-zoom" aria-label="缩放">
            <button
              type="button"
              className="diagram-btn diagram-btn-icon diagram-zoom-step"
              aria-label="缩小"
              title="缩小"
              disabled={showSource}
              onClick={() => setScale((s) => s / 1.25)}
            >
              <IconMinus />
            </button>
            <button
              type="button"
              className="diagram-btn diagram-btn-text diagram-zoom-value"
              title="重置为 100%"
              disabled={showSource}
              onClick={() => setScale(1)}
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="diagram-btn diagram-btn-icon diagram-zoom-step"
              aria-label="放大"
              title="放大"
              disabled={showSource}
              onClick={() => setScale((s) => s * 1.25)}
            >
              <IconPlus />
            </button>
            <button
              type="button"
              className="diagram-btn diagram-btn-text diagram-zoom-fit"
              title="适应窗口"
              disabled={showSource}
              onClick={() => setScale(fitScale(false))}
            >
              适应
            </button>
          </div>
          <div className="diagram-actions">
            <button
              type="button"
              className="diagram-btn diagram-btn-text"
              aria-pressed={showSource}
              disabled={!canToggle}
              onClick={onToggle}
            >
              {showSource ? "图表" : "源码"}
            </button>
            <button type="button" className="diagram-btn diagram-btn-text" onClick={onCopy}>
              复制
            </button>
            <DownloadMenu disabled={false} busy={downloading} onPick={onDownload} />
            <button
              ref={closeRef}
              type="button"
              className="diagram-btn diagram-btn-icon"
              aria-label="关闭"
              title="关闭 (Esc)"
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
        </div>
        <div
          ref={setBodyEl}
          className={`diagram-fs-body${showSource ? " is-source" : ""}`}
          onDoubleClick={showSource ? undefined : () => setScale(1)}
        >
          {showSource ? (
            <pre className="diagram-source">{source}</pre>
          ) : (
            <DiagramSvg svg={result.svg} width={result.width} height={result.height} scale={scale} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Mermaid card ---------------- */

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

export function DiagramCard({
  source = "",
  pending = false,
  kind = "mermaid",
  src,
  alt,
  name,
  mime,
}: {
  /** Fence body (mermaid / html source). For image kind, prefer `src`. */
  source?: string;
  /** Streaming and the fence is not closed yet → source preview only, renderer / iframe not loaded. */
  pending?: boolean;
  kind?: DiagramKind;
  /** Image kind: attachment relative path, absolute URL, or blob:/data:. */
  src?: string;
  alt?: string;
  name?: string;
  mime?: string;
}) {
  if (kind === "html") {
    return <HtmlDiagramCard source={source} pending={pending} />;
  }
  if (kind === "image") {
    return <ImageDiagramCard src={src || source} alt={alt} name={name} mime={mime} />;
  }
  return <MermaidDiagramCard source={source} pending={pending} />;
}

function MermaidDiagramCard({
  source,
  pending = false,
}: {
  source: string;
  pending?: boolean;
}) {
  const theme: DiagramTheme = useAppTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [result, setResult] = useState<DiagramRenderResult | null>(() =>
    pending ? null : peekDiagram(source, theme) ?? null,
  );
  const [animate, setAnimate] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLPreElement>(null);

  // Render exactly once per (closed source, theme). Never while pending → no stream flicker.
  useEffect(() => {
    if (pending) return;
    const cached = peekDiagram(source, theme);
    if (cached) {
      setResult(cached);
      return;
    }
    let alive = true;
    void renderDiagram(source, theme).then((r) => {
      if (!alive) return;
      setResult(r);
      setAnimate(r.ok && !reducedMotion);
    });
    return () => {
      alive = false;
    };
    // reducedMotion intentionally not a dep: toggling it must not re-render the diagram.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, theme, pending]);

  const ok = !pending && result?.ok === true ? result : null;
  const failed = !pending && result != null && result.ok === false ? result : null;
  const loading = pending || result == null;
  const viewSource = Boolean(failed) || (Boolean(ok) && showSource);

  const { scale, setScale } = useDiagramZoom(bodyEl, {
    ...INLINE_ZOOM,
    enabled: Boolean(ok) && !viewSource,
  });

  // Streaming preview: keep the newest lines in view.
  useLayoutEffect(() => {
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [source, loading]);

  useEffect(() => {
    if (!ok) setFullscreen(false);
  }, [ok]);

  const onCopy = useCallback(() => {
    copyText(source).then(
      () => toast.success("已复制", { duration: 1500 }),
      () => toast.error("复制失败，请手动选择源码复制"),
    );
  }, [source]);

  const onDownload = useCallback(
    (fmt: "svg" | "png") => {
      if (!ok) return;
      const base = diagramFilename();
      if (fmt === "svg") {
        try {
          downloadSvg(ok.svg, ok.width, ok.height, theme, base);
        } catch {
          toast.error("SVG 导出失败");
        }
        return;
      }
      setDownloading(true);
      downloadPng(ok.svg, ok.width, ok.height, theme, base)
        .catch(() => toast.error("PNG 导出失败，请改用 SVG"))
        .finally(() => setDownloading(false));
    },
    [ok, theme],
  );

  const toggleSource = useCallback(() => setShowSource((v) => !v), []);
  const closeFullscreen = useCallback(() => setFullscreen(false), []);

  const actions = (
    <>
      <button
        type="button"
        className="diagram-btn diagram-btn-text"
        aria-pressed={viewSource}
        disabled={!ok}
        title={failed ? "图表语法有误" : undefined}
        onClick={toggleSource}
      >
        {viewSource ? "图表" : "源码"}
      </button>
      <button type="button" className="diagram-btn diagram-btn-text" onClick={onCopy}>
        复制
      </button>
      <DownloadMenu disabled={!ok} busy={downloading} onPick={onDownload} />
      <button
        type="button"
        className="diagram-btn diagram-btn-icon"
        aria-label="全屏"
        title={ok ? "全屏" : "图表就绪后可全屏"}
        disabled={!ok}
        onClick={() => setFullscreen(true)}
      >
        <IconExpand />
      </button>
    </>
  );

  const overflowItems: DiagramOverflowItem[] = [
    {
      key: "source",
      label: viewSource ? "图表" : "源码",
      disabled: !ok,
      onClick: toggleSource,
    },
    { key: "copy", label: "复制", onClick: onCopy },
    {
      key: "dl-svg",
      label: "下载 SVG",
      disabled: !ok || downloading,
      onClick: () => onDownload("svg"),
    },
    {
      key: "dl-png",
      label: "下载 PNG",
      disabled: !ok || downloading,
      onClick: () => onDownload("png"),
    },
    {
      key: "fs",
      label: "全屏",
      disabled: !ok,
      onClick: () => setFullscreen(true),
    },
  ];

  const zoomBadge =
    ok && !viewSource && scale !== 1 ? (
      <button
        type="button"
        className="diagram-zoom-badge"
        title="重置为 100%"
        onClick={() => setScale(1)}
      >
        {Math.round(scale * 100)}%
      </button>
    ) : null;

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="diagram-body diagram-body-pending" aria-busy="true">
        <div className="diagram-pending-label">
          <span className="diagram-pending-dot" aria-hidden="true" />
          {pending ? "生成中…" : "渲染中…"}
        </div>
        <pre ref={tailRef} className="diagram-source diagram-source-tail">
          {source}
        </pre>
      </div>
    );
  } else if (viewSource) {
    body = (
      <div className="diagram-body diagram-body-source">
        {failed ? (
          <div className="diagram-warning" role="status">
            {failed.reason === "load" ? "图表渲染器加载失败，已显示源码" : "图表语法有误，已显示源码"}
          </div>
        ) : null}
        <pre className="diagram-source">{source}</pre>
      </div>
    );
  } else {
    body = (
      <div
        ref={setBodyEl}
        className="diagram-body diagram-body-render"
        onDoubleClick={() => setScale(1)}
      >
        <DiagramSvg svg={ok!.svg} width={ok!.width} height={ok!.height} scale={scale} animate={animate} />
      </div>
    );
  }

  return (
    <>
      <DiagramCardFrame
        kind="mermaid"
        pending={loading}
        extra={zoomBadge}
        actions={actions}
        overflowItems={overflowItems}
      >
        {body}
      </DiagramCardFrame>
      {fullscreen && ok ? (
        <DiagramFullscreen
          result={ok}
          source={source}
          showSource={showSource}
          canToggle
          onToggle={toggleSource}
          onCopy={onCopy}
          onDownload={onDownload}
          downloading={downloading}
          onClose={closeFullscreen}
        />
      ) : null}
    </>
  );
}
