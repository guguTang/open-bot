import { useMemo, useState } from "react";
import { HtmlPreviewModal } from "./HtmlPreviewModal";
import { artifactDisplayName, splitResultOriented } from "./artifactCardsModel";
import { MarkdownMessage } from "./MarkdownMessage";
import type { MessageSource } from "../api";
import { prepareCitedMarkdown } from "../lib/citationMarkers";
import { useSandboxHtmlPreview } from "./useSandboxHtmlPreview";

export function ArtifactCards({
  artifacts,
  collapsedJson,
  agentId,
}: {
  artifacts: { path: string; kind: string }[];
  collapsedJson: string[];
  agentId?: string;
}) {
  const {
    preview,
    downloadError,
    openPath,
    downloadPath,
    close,
    isDownloadingPath,
  } = useSandboxHtmlPreview(agentId);
  const [openJson, setOpenJson] = useState(false);

  if (!artifacts.length && !collapsedJson.length) return null;

  return (
    <div className="artifact-row">
      {artifacts.map((a) => (
        <div key={a.path} className="artifact-card">
          <span className="artifact-kind">{a.kind}</span>
          <span className="artifact-path">{artifactDisplayName(a.path)}</span>
          <span className="artifact-actions">
            <button type="button" className="artifact-action" onClick={() => void openPath(a.path)}>
              打开
            </button>
            <button
              type="button"
              className="artifact-action"
              disabled={isDownloadingPath(a.path)}
              onClick={() => void downloadPath(a.path)}
            >
              {isDownloadingPath(a.path) ? "下载中…" : "下载"}
            </button>
          </span>
        </div>
      ))}
      {downloadError ? <div className="artifact-download-error">{downloadError}</div> : null}
      {collapsedJson.length > 0 ? (
        <button type="button" className="tool-chip" onClick={() => setOpenJson((v) => !v)}>
          {openJson ? "收起工具详情" : `工具结果 ×${collapsedJson.length}`}
        </button>
      ) : null}
      {openJson
        ? collapsedJson.map((j) => (
            <pre key={j} className="tool-json-collapsed">
              {j}
            </pre>
          ))
        : null}
      <HtmlPreviewModal
        open={preview.open}
        title={preview.title}
        html={preview.html}
        loading={preview.loading}
        error={preview.error}
        downloading={preview.path != null && isDownloadingPath(preview.path)}
        downloadError={preview.open ? downloadError : null}
        onDownload={preview.path ? () => void downloadPath(preview.path!) : undefined}
        onClose={close}
      />
    </div>
  );
}

export function ResultOrientedMessage({
  content,
  streaming,
  agentId,
  messageId,
  sources,
}: {
  content: string;
  streaming?: boolean;
  agentId?: string;
  messageId?: string;
  sources?: MessageSource[] | null;
}) {
  const { display, artifacts, collapsedJson } = useMemo(() => splitResultOriented(content), [content]);
  const md = useMemo(() => {
    const base = display.trim();
    if (streaming || !sources?.length || !messageId) return base;
    return prepareCitedMarkdown(base, messageId, sources);
  }, [display, streaming, messageId, sources]);
  return (
    <>
      <MarkdownMessage content={md} streaming={streaming} agentId={agentId} />
      {!streaming ? (
        <ArtifactCards artifacts={artifacts} collapsedJson={collapsedJson} agentId={agentId} />
      ) : null}
    </>
  );
}
