import { useMemo, useState } from "react";
import { downloadSandboxFile, readSandboxFile } from "../api";
import { HtmlPreviewModal } from "./HtmlPreviewModal";
import {
  friendlyFileError,
  friendlyOpenError,
  looksLikeHtml,
  normalizeWorkspacePath,
  previewTitleFromPath,
} from "./htmlPreviewModel";
import { artifactDisplayName, splitResultOriented } from "./artifactCardsModel";
import { MarkdownMessage } from "./MarkdownMessage";
import type { MessageSource } from "../api";
import { prepareCitedMarkdown } from "../lib/citationMarkers";

export function ArtifactCards({
  artifacts,
  collapsedJson,
  agentId,
}: {
  artifacts: { path: string; kind: string }[];
  collapsedJson: string[];
  agentId?: string;
}) {
  const [preview, setPreview] = useState<{
    open: boolean;
    title: string;
    path: string | null;
    html: string | null;
    loading: boolean;
    error: string | null;
  }>({ open: false, title: "", path: null, html: null, loading: false, error: null });
  const [openJson, setOpenJson] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadPath = async (path: string) => {
    const wp = normalizeWorkspacePath(path);
    setDownloadingPath(wp);
    setDownloadError(null);
    try {
      await downloadSandboxFile(wp, agentId ? { agent_id: agentId } : undefined);
    } catch (e) {
      setDownloadError(friendlyFileError(e, "下载"));
    } finally {
      setDownloadingPath(null);
    }
  };

  const openPath = async (path: string) => {
    const wp = normalizeWorkspacePath(path);
    setPreview({ open: true, title: previewTitleFromPath(wp), path: wp, html: null, loading: true, error: null });
    try {
      const res = await readSandboxFile(wp, agentId ? { agent_id: agentId } : undefined);
      const content = res.content || "";
      if (looksLikeHtml(content, wp)) {
        setPreview({ open: true, title: previewTitleFromPath(wp), path: wp, html: content, loading: false, error: null });
      } else {
        setPreview({
          open: true,
          title: previewTitleFromPath(wp),
          path: wp,
          html: `<pre style="white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;padding:12px">${escapeHtml(content)}</pre>`,
          loading: false,
          error: null,
        });
      }
    } catch (e) {
      setPreview({
        open: true,
        title: previewTitleFromPath(wp),
        path: wp,
        html: null,
        loading: false,
        error: friendlyOpenError(e),
      });
    }
  };

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
              disabled={downloadingPath === normalizeWorkspacePath(a.path)}
              onClick={() => void downloadPath(a.path)}
            >
              {downloadingPath === normalizeWorkspacePath(a.path) ? "下载中…" : "下载"}
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
        downloading={preview.path != null && downloadingPath === preview.path}
        downloadError={preview.open ? downloadError : null}
        onDownload={preview.path ? () => void downloadPath(preview.path!) : undefined}
        onClose={() => setPreview((p) => ({ ...p, open: false }))}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
