/**
 * HTML diagram card — design bot-diagram-card-design-v2 §1.
 * Reuses DiagramCardFrame; preview via iframe sandbox="" + sanitized srcdoc.
 */
import { Download, Maximize2, X } from "lucide-react";
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
import { copyText, downloadHtml } from "../lib/diagramExport";
import {
  HTML_DIAGRAM_MAX_BYTES,
  htmlSourceByteLength,
  sanitizeHtmlDiagram,
} from "../lib/htmlDiagramSanitize";
import { DiagramCardFrame, type DiagramOverflowItem } from "./DiagramCardFrame";
import {
  diagramActionsClass,
  diagramBodyClass,
  diagramBodyHtmlClass,
  diagramBodyPendingClass,
  diagramBtnIconClass,
  diagramBtnTextClass,
  diagramFsBackdropClass,
  diagramFsBodyClass,
  diagramFsShellClass,
  diagramFsToolbarClass,
  diagramHtmlIframeClass,
  diagramHtmlIframeFsClass,
  diagramPendingDotClass,
  diagramPendingLabelClass,
  diagramPillClass,
  diagramSourceClass,
  diagramSourceFsClass,
  diagramSourceTailClass,
  diagramWarningClass,
} from "./diagram/diagramUi";
import { useAppTheme } from "./useAppTheme";

const diagramIcon = {
  size: 16,
  strokeWidth: 1.5,
  "aria-hidden": true as const,
  focusable: false as const,
};

const IconDownload = () => <Download {...diagramIcon} />;
const IconExpand = () => <Maximize2 {...diagramIcon} />;
const IconClose = () => <X {...diagramIcon} />;

type PreviewState =
  | { mode: "pending" }
  | { mode: "empty" }
  | { mode: "oversized" }
  | { mode: "source-only"; reason: "sanitize" | "error"; tip: string }
  | { mode: "ok"; srcdoc: string; blockedExternal: number };

function buildPreview(source: string, theme: "light" | "dark", pending: boolean): PreviewState {
  if (pending) return { mode: "pending" };
  if (!source.trim()) return { mode: "empty" };
  if (htmlSourceByteLength(source) > HTML_DIAGRAM_MAX_BYTES) return { mode: "oversized" };
  try {
    const result = sanitizeHtmlDiagram(source, theme);
    if (result.empty) return { mode: "empty" };
    return { mode: "ok", srcdoc: result.html, blockedExternal: result.blockedExternal };
  } catch {
    return {
      mode: "source-only",
      reason: "error",
      tip: "无法预览，已显示源码",
    };
  }
}

function HtmlFullscreen({
  source,
  srcdoc,
  showSource,
  onToggle,
  onCopy,
  onDownload,
  onClose,
}: {
  source: string;
  srcdoc: string;
  showSource: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
      className={diagramFsBackdropClass}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={diagramFsShellClass} role="dialog" aria-modal="true" aria-label="HTML 图表">
        <div className={diagramFsToolbarClass}>
          <span className={diagramPillClass}>HTML</span>
          <div className={diagramActionsClass}>
            <button
              type="button"
              className={diagramBtnTextClass}
              aria-pressed={showSource}
              onClick={onToggle}
            >
              {showSource ? "预览" : "源码"}
            </button>
            <button type="button" className={diagramBtnTextClass} onClick={onCopy}>
              复制
            </button>
            <button
              type="button"
              className={diagramBtnIconClass}
              aria-label="下载 HTML"
              title="下载 HTML"
              onClick={onDownload}
            >
              <IconDownload />
            </button>
            <button
              ref={closeRef}
              type="button"
              className={diagramBtnIconClass}
              aria-label="关闭"
              title="关闭 (Esc)"
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
        </div>
        <div className={diagramFsBodyClass({ source: showSource, html: !showSource })}>
          {showSource ? (
            <pre className={diagramSourceFsClass}>{source}</pre>
          ) : (
            <iframe
              className={diagramHtmlIframeFsClass}
              title="HTML 图表全屏预览"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={srcdoc}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function HtmlDiagramCard({ source, pending = false }: { source: string; pending?: boolean }) {
  const theme = useAppTheme();
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const toastOnceRef = useRef(false);
  const tailRef = useRef<HTMLPreElement>(null);

  const preview = useMemo(() => buildPreview(source, theme, pending), [source, theme, pending]);

  useEffect(() => {
    setPreviewFailed(false);
    toastOnceRef.current = false;
  }, [source, theme]);

  useLayoutEffect(() => {
    const el = tailRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [source, pending]);

  const canPreview = preview.mode === "ok" && !previewFailed;
  const viewSource =
    preview.mode === "pending" ||
    preview.mode === "empty" ||
    preview.mode === "oversized" ||
    preview.mode === "source-only" ||
    previewFailed ||
    (canPreview && showSource);

  const ready = canPreview; // download / fullscreen only when previewable

  useEffect(() => {
    if (!ready) setFullscreen(false);
  }, [ready]);

  const onCopy = useCallback(() => {
    copyText(source).then(
      () => toast.success("已复制", { duration: 1500 }),
      () => toast.error("复制失败，请手动选择源码复制"),
    );
  }, [source]);

  const onDownload = useCallback(() => {
    try {
      downloadHtml(source, diagramFilename());
    } catch {
      toast.error("下载失败");
    }
  }, [source]);

  const toggleSource = useCallback(() => setShowSource((v) => !v), []);
  const closeFullscreen = useCallback(() => setFullscreen(false), []);

  const onIframePointer = useCallback(() => {
    if (preview.mode !== "ok" || preview.blockedExternal <= 0 || toastOnceRef.current) return;
    toastOnceRef.current = true;
    toast.message("已拦截外链", { duration: 1800 });
  }, [preview]);

  const onIframeError = useCallback(() => {
    setPreviewFailed(true);
  }, []);

  const actions = (
    <>
      <button
        type="button"
        className={diagramBtnTextClass}
        aria-pressed={viewSource && ready}
        disabled={!ready}
        title={!ready ? "预览就绪后可切换" : undefined}
        onClick={toggleSource}
      >
        {viewSource && ready ? "预览" : "源码"}
      </button>
      <button type="button" className={diagramBtnTextClass} onClick={onCopy}>
        复制
      </button>
      <button
        type="button"
        className={diagramBtnIconClass}
        aria-label="下载 HTML"
        title={ready ? "下载 HTML" : "图表就绪后可下载"}
        disabled={!ready}
        onClick={onDownload}
      >
        <IconDownload />
      </button>
      <button
        type="button"
        className={diagramBtnIconClass}
        aria-label="全屏"
        title={ready ? "全屏" : "图表就绪后可全屏"}
        disabled={!ready}
        onClick={() => setFullscreen(true)}
      >
        <IconExpand />
      </button>
    </>
  );

  const overflowItems: DiagramOverflowItem[] = [
    {
      key: "source",
      label: viewSource && ready ? "预览" : "源码",
      disabled: !ready,
      onClick: toggleSource,
    },
    { key: "copy", label: "复制", onClick: onCopy },
    {
      key: "download",
      label: "下载",
      disabled: !ready,
      onClick: onDownload,
    },
    {
      key: "fs",
      label: "全屏",
      disabled: !ready,
      onClick: () => setFullscreen(true),
    },
  ];

  let body: ReactNode;
  if (preview.mode === "pending") {
    body = (
      <div className={diagramBodyPendingClass} aria-busy="true">
        <div className={diagramPendingLabelClass}>
          <span className={diagramPendingDotClass} aria-hidden="true" />
          生成中…
        </div>
        <pre ref={tailRef} className={diagramSourceTailClass}>
          {source}
        </pre>
      </div>
    );
  } else if (preview.mode === "empty") {
    body = (
      <div className={diagramBodyClass}>
        <div className={diagramWarningClass} role="status">
          无内容
        </div>
      </div>
    );
  } else if (preview.mode === "oversized") {
    body = (
      <div className={diagramBodyClass}>
        <div className={diagramWarningClass} role="status">
          内容过大，仅显示源码
        </div>
        <pre className={diagramSourceClass}>{source}</pre>
      </div>
    );
  } else if (preview.mode === "source-only" || previewFailed || (ready && showSource)) {
    body = (
      <div className={diagramBodyClass}>
        {preview.mode === "source-only" || previewFailed ? (
          <div className={diagramWarningClass} role="status">
            {preview.mode === "source-only" ? preview.tip : "无法预览，已显示源码"}
          </div>
        ) : null}
        <pre className={diagramSourceClass}>{source}</pre>
      </div>
    );
  } else {
    body = (
      <div className={diagramBodyHtmlClass}>
        <iframe
          className={diagramHtmlIframeClass}
          title="HTML 图表预览"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={preview.mode === "ok" ? preview.srcdoc : ""}
          onError={onIframeError}
          onPointerDown={onIframePointer}
        />
      </div>
    );
  }

  return (
    <>
      <DiagramCardFrame
        kind="html"
        pending={preview.mode === "pending"}
        actions={actions}
        overflowItems={overflowItems}
      >
        {body}
      </DiagramCardFrame>
      {fullscreen && ready && preview.mode === "ok" ? (
        <HtmlFullscreen
          source={source}
          srcdoc={preview.srcdoc}
          showSource={showSource}
          onToggle={toggleSource}
          onCopy={onCopy}
          onDownload={onDownload}
          onClose={closeFullscreen}
        />
      ) : null}
    </>
  );
}
