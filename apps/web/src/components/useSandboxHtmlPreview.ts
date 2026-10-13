import { useCallback, useState } from "react";
import { downloadSandboxFile, downloadTextFile, readSandboxFile } from "../api";
import {
  friendlyFileError,
  friendlyOpenError,
  looksLikeHtml,
  normalizeWorkspacePath,
  previewTitleFromPath,
} from "./htmlPreviewModel";

export type SandboxPreviewState = {
  open: boolean;
  title: string;
  path: string | null;
  html: string | null;
  loading: boolean;
  error: string | null;
};

const CLOSED: SandboxPreviewState = {
  open: false,
  title: "",
  path: null,
  html: null,
  loading: false,
  error: null,
};

function wrapPlainAsHtml(content: string, title: string): string {
  const escaped = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:16px;white-space:pre-wrap;word-break:break-word;color:#1a1a1b;background:#fafafa}</style>
</head><body>${escaped}</body></html>`;
}

export type UseSandboxHtmlPreview = {
  preview: SandboxPreviewState;
  downloading: boolean;
  downloadError: string | null;
  openHtml: (html: string, title: string) => void;
  openPath: (path: string) => Promise<void>;
  download: () => Promise<void>;
  downloadPath: (path: string) => Promise<void>;
  close: () => void;
  /** True while a path download is in flight for this exact workspace path. */
  isDownloadingPath: (path: string) => boolean;
};

/**
 * Deep module: path/html → preview modal state (fetch, wrap non-HTML, download, errors).
 */
export function useSandboxHtmlPreview(agentId?: string): UseSandboxHtmlPreview {
  const [preview, setPreview] = useState<SandboxPreviewState>(CLOSED);
  const [downloading, setDownloading] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const close = useCallback(() => {
    setPreview(CLOSED);
    setDownloadError(null);
  }, []);

  const openHtml = useCallback((html: string, title: string) => {
    setDownloadError(null);
    setPreview({ open: true, title, path: null, html, loading: false, error: null });
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      const wp = normalizeWorkspacePath(path);
      const title = previewTitleFromPath(wp);
      setDownloadError(null);
      setPreview({ open: true, title, path: wp, html: null, loading: true, error: null });
      try {
        const { content: fileContent } = await readSandboxFile(
          wp,
          agentId ? { agent_id: agentId } : undefined,
        );
        const html = looksLikeHtml(fileContent, wp)
          ? fileContent
          : wrapPlainAsHtml(fileContent, title);
        setPreview({ open: true, title, path: wp, html, loading: false, error: null });
      } catch (err) {
        setPreview({
          open: true,
          title,
          path: wp,
          html: null,
          loading: false,
          error: friendlyOpenError(err),
        });
      }
    },
    [agentId],
  );

  const downloadPath = useCallback(
    async (path: string) => {
      const wp = normalizeWorkspacePath(path);
      setDownloadingPath(wp);
      setDownloading(true);
      setDownloadError(null);
      try {
        await downloadSandboxFile(wp, agentId ? { agent_id: agentId } : undefined);
      } catch (err) {
        setDownloadError(friendlyFileError(err, "下载"));
      } finally {
        setDownloadingPath(null);
        setDownloading(false);
      }
    },
    [agentId],
  );

  const download = useCallback(async () => {
    if (preview.path) {
      await downloadPath(preview.path);
      return;
    }
    if (!preview.html) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const name = preview.title && !preview.title.includes("/") ? preview.title : "preview.html";
      const filename = /\.html?$/i.test(name) ? name : `${name}.html`;
      downloadTextFile(filename, preview.html, "text/html;charset=utf-8");
    } catch (err) {
      setDownloadError(friendlyFileError(err, "下载"));
    } finally {
      setDownloading(false);
    }
  }, [downloadPath, preview.html, preview.path, preview.title]);

  const isDownloadingPath = useCallback(
    (path: string) => downloadingPath === normalizeWorkspacePath(path),
    [downloadingPath],
  );

  return {
    preview,
    downloading,
    downloadError,
    openHtml,
    openPath,
    download,
    downloadPath,
    close,
    isDownloadingPath,
  };
}
