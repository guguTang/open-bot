/**
 * HTML diagram card — design bot-diagram-card-design-v2 §1.
 * Reuses DiagramCardFrame; preview via iframe sandbox="" + sanitized srcdoc.
 * Interaction chrome from `./diagram`.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "@/lib/toast";
import { diagramFilename } from "../lib/mermaidFence";
import { downloadHtml } from "../lib/diagramExport";
import {
  HTML_DIAGRAM_MAX_BYTES,
  htmlSourceByteLength,
  sanitizeHtmlDiagram,
} from "../lib/htmlDiagramSanitize";
import { DiagramCardFrame } from "./DiagramCardFrame";
import { type DiagramOverflowItem } from "./diagramCardFrameModel";
import {
  copyDiagramText,
  DiagramCopyButton,
  DiagramDownloadIconButton,
  DiagramExpandButton,
  DiagramFullscreenShell,
  DiagramPendingBody,
  DiagramSourceBody,
  DiagramSourceToggleButton,
  diagramOverflowItems,
  useDiagramCardChrome,
} from "./diagram";
import {
  diagramBodyHtmlClass,
  diagramFsBodyClass,
  diagramHtmlIframeClass,
  diagramHtmlIframeFsClass,
  diagramSourceFsClass,
} from "./diagram/diagramUi";
import { useAppTheme } from "./useAppTheme";

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
  return (
    <DiagramFullscreenShell
      label="HTML"
      ariaLabel="HTML 图表"
      actions={
        <>
          <DiagramSourceToggleButton
            viewSource={showSource}
            ready
            previewLabel="预览"
            onClick={onToggle}
          />
          <DiagramCopyButton onClick={onCopy} />
          <DiagramDownloadIconButton
            ariaLabel="下载 HTML"
            title="下载 HTML"
            onClick={onDownload}
          />
        </>
      }
      bodyClassName={diagramFsBodyClass({ source: showSource, html: !showSource })}
      onClose={onClose}
    >
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
    </DiagramFullscreenShell>
  );
}

export function HtmlDiagramCard({ source, pending = false }: { source: string; pending?: boolean }) {
  const theme = useAppTheme();
  const previewScope = useMemo(() => `${source}\0${theme}`, [source, theme]);
  const [failedScope, setFailedScope] = useState<string | null>(null);
  const previewFailed = failedScope === previewScope;
  const toastShownScopeRef = useRef<string | null>(null);

  const preview = useMemo(() => buildPreview(source, theme, pending), [source, theme, pending]);

  const canPreview = preview.mode === "ok" && !previewFailed;
  const ready = canPreview; // download / fullscreen only when previewable

  const { showSource, toggleSource, fullscreen, openFullscreen, closeFullscreen } =
    useDiagramCardChrome({ ready });

  const viewSource =
    preview.mode === "pending" ||
    preview.mode === "empty" ||
    preview.mode === "oversized" ||
    preview.mode === "source-only" ||
    previewFailed ||
    (canPreview && showSource);

  const onCopy = useCallback(() => copyDiagramText(source), [source]);

  const onDownload = useCallback(() => {
    try {
      downloadHtml(source, diagramFilename());
    } catch {
      toast.error("下载失败");
    }
  }, [source]);

  const onIframePointer = useCallback(() => {
    if (preview.mode !== "ok" || preview.blockedExternal <= 0) return;
    if (toastShownScopeRef.current === previewScope) return;
    toastShownScopeRef.current = previewScope;
    toast.message("已拦截外链", { duration: 1800 });
  }, [preview, previewScope]);

  const onIframeError = useCallback(() => {
    setFailedScope(previewScope);
  }, [previewScope]);

  const actions = (
    <>
      <DiagramSourceToggleButton
        viewSource={viewSource}
        ready={ready}
        disabledTitle="预览就绪后可切换"
        previewLabel="预览"
        onClick={toggleSource}
      />
      <DiagramCopyButton onClick={onCopy} />
      <DiagramDownloadIconButton
        ariaLabel="下载 HTML"
        title={ready ? "下载 HTML" : "图表就绪后可下载"}
        disabled={!ready}
        onClick={onDownload}
      />
      <DiagramExpandButton ready={ready} onClick={openFullscreen} />
    </>
  );

  const overflowItems: DiagramOverflowItem[] = diagramOverflowItems(
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
      onClick: openFullscreen,
    },
  );

  let body: ReactNode;
  if (preview.mode === "pending") {
    body = <DiagramPendingBody source={source} />;
  } else if (preview.mode === "empty") {
    body = <DiagramSourceBody warning="无内容" />;
  } else if (preview.mode === "oversized") {
    body = <DiagramSourceBody source={source} warning="内容过大，仅显示源码" />;
  } else if (preview.mode === "source-only" || previewFailed || (ready && showSource)) {
    body = (
      <DiagramSourceBody
        source={source}
        warning={
          preview.mode === "source-only" || previewFailed
            ? preview.mode === "source-only"
              ? preview.tip
              : "无法预览，已显示源码"
            : null
        }
      />
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
