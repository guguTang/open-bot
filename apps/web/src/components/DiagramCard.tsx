/**
 * DiagramCard — in-bubble diagram card (design: bot-diagram-card-design-v1 / v2).
 *
 * Shared shell (`DiagramCardFrame`) + Mermaid card. HTML → `HtmlDiagramCard`;
 * image → `ImageDiagramCard` (auth attachment URL).
 *
 * Interaction chrome (fullscreen, toolbar, pending/source) lives under `./diagram`.
 * States: pending (stream, fence unclosed) → rendering → ok | error. The renderer is only
 * called once the fence is closed (or the stream ended); see lib/mermaidFence.ts.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/lib/toast";
import { diagramFilename } from "../lib/mermaidFence";
import { peekDiagram, renderDiagram, type DiagramRenderResult, type DiagramTheme } from "../lib/mermaidRender";
import { downloadPng, downloadSvg } from "../lib/diagramExport";
import { useAppTheme } from "./useAppTheme";
import { HtmlDiagramCard } from "./HtmlDiagramCard";
import { ImageDiagramCard } from "./ImageDiagramCard";
import { DiagramCardFrame } from "./DiagramCardFrame";
import { type DiagramKind, type DiagramOverflowItem } from "./diagramCardFrameModel";
import {
  copyDiagramText,
  DIAGRAM_FULLSCREEN_ZOOM,
  DIAGRAM_INLINE_ZOOM,
  DiagramCopyButton,
  DiagramDownloadMenu,
  DiagramExpandButton,
  DiagramFullscreenShell,
  DiagramIconMinus,
  DiagramIconPlus,
  DiagramPendingBody,
  DiagramSourceBody,
  DiagramSourceToggleButton,
  diagramOverflowItems,
  useDiagramCardChrome,
  useDiagramZoom,
} from "./diagram";
import {
  diagramBodyRenderClass,
  diagramCanvasClass,
  diagramFsBodyClass,
  diagramSourceFsClass,
  diagramZoomBadgeClass,
  diagramZoomFitClass,
  diagramZoomGroupClass,
  diagramZoomStepClass,
  diagramZoomValueClass,
} from "./diagram/diagramUi";

export type { DiagramKind, DiagramOverflowItem } from "./diagramCardFrameModel";
export { DiagramCardFrame } from "./DiagramCardFrame";

/* ---------------- svg host ---------------- */

function DiagramSvg({
  svg,
  width,
  height,
  scale,
  animate,
  fullscreen,
}: {
  svg: string;
  width: number;
  height: number;
  scale: number;
  animate?: boolean;
  fullscreen?: boolean;
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
      className={diagramCanvasClass({ enter: animate, fullscreen })}
      // SVG comes from mermaid with securityLevel "strict" (DOMPurify-sanitized labels).
      dangerouslySetInnerHTML={html}
    />
  );
}

/* ---------------- fullscreen ---------------- */

function MermaidFullscreen({
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
  const { scale, setScale } = useDiagramZoom(bodyEl, {
    ...DIAGRAM_FULLSCREEN_ZOOM,
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

  return (
    <DiagramFullscreenShell
      label="Mermaid"
      ariaLabel="Mermaid 图表"
      toolbarCenter={
        <div className={diagramZoomGroupClass} aria-label="缩放">
          <button
            type="button"
            className={diagramZoomStepClass}
            aria-label="缩小"
            title="缩小"
            disabled={showSource}
            onClick={() => setScale((s) => s / 1.25)}
          >
            <DiagramIconMinus />
          </button>
          <button
            type="button"
            className={diagramZoomValueClass}
            title="重置为 100%"
            disabled={showSource}
            onClick={() => setScale(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className={diagramZoomStepClass}
            aria-label="放大"
            title="放大"
            disabled={showSource}
            onClick={() => setScale((s) => s * 1.25)}
          >
            <DiagramIconPlus />
          </button>
          <button
            type="button"
            className={diagramZoomFitClass}
            title="适应窗口"
            disabled={showSource}
            onClick={() => setScale(fitScale(false))}
          >
            适应
          </button>
        </div>
      }
      actions={
        <>
          <DiagramSourceToggleButton
            viewSource={showSource}
            ready={canToggle}
            previewLabel="图表"
            onClick={onToggle}
          />
          <DiagramCopyButton onClick={onCopy} />
          <DiagramDownloadMenu disabled={false} busy={downloading} onPick={onDownload} />
        </>
      }
      bodyRef={setBodyEl}
      bodyClassName={diagramFsBodyClass()}
      onBodyDoubleClick={showSource ? undefined : () => setScale(1)}
      onClose={onClose}
    >
      {showSource ? (
        <pre className={diagramSourceFsClass}>{source}</pre>
      ) : (
        <DiagramSvg
          svg={result.svg}
          width={result.width}
          height={result.height}
          scale={scale}
          fullscreen
        />
      )}
    </DiagramFullscreenShell>
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
  const [downloading, setDownloading] = useState(false);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);

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
  const ready = Boolean(ok);

  const { showSource, toggleSource, fullscreen, openFullscreen, closeFullscreen } =
    useDiagramCardChrome({ ready });

  const viewSource = Boolean(failed) || (Boolean(ok) && showSource);

  const { scale, setScale } = useDiagramZoom(bodyEl, {
    ...DIAGRAM_INLINE_ZOOM,
    enabled: Boolean(ok) && !viewSource,
  });

  const onCopy = useCallback(() => copyDiagramText(source), [source]);

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

  const actions = (
    <>
      <DiagramSourceToggleButton
        viewSource={viewSource}
        ready={ready}
        pressed={viewSource}
        disabledTitle={failed ? "图表语法有误" : undefined}
        previewLabel="图表"
        onClick={toggleSource}
      />
      <DiagramCopyButton onClick={onCopy} />
      <DiagramDownloadMenu disabled={!ok} busy={downloading} onPick={onDownload} />
      <DiagramExpandButton ready={ready} onClick={openFullscreen} />
    </>
  );

  const overflowItems: DiagramOverflowItem[] = diagramOverflowItems(
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
      onClick: openFullscreen,
    },
  );

  const zoomBadge =
    ok && !viewSource && scale !== 1 ? (
      <button
        type="button"
        className={diagramZoomBadgeClass}
        title="重置为 100%"
        onClick={() => setScale(1)}
      >
        {Math.round(scale * 100)}%
      </button>
    ) : null;

  let body: ReactNode;
  if (loading) {
    body = <DiagramPendingBody source={source} label={pending ? "生成中…" : "渲染中…"} />;
  } else if (viewSource) {
    body = (
      <DiagramSourceBody
        source={source}
        warning={
          failed
            ? failed.reason === "load"
              ? "图表渲染器加载失败，已显示源码"
              : "图表语法有误，已显示源码"
            : null
        }
      />
    );
  } else {
    body = (
      <div
        ref={setBodyEl}
        className={diagramBodyRenderClass}
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
        <MermaidFullscreen
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
