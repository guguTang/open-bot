import { createPortal } from "react-dom";
import { withPreviewStorage } from "./htmlPreviewModel";
import { useDialogChrome } from "./useDialogOpen";

type Props = {
  open: boolean;
  title: string;
  html: string | null;
  loading?: boolean;
  error?: string | null;
  downloading?: boolean;
  downloadError?: string | null;
  onDownload?: () => void;
  onClose: () => void;
};

/** Safe in-app HTML preview: srcDoc + sandbox without allow-same-origin. */
export function HtmlPreviewModal({
  open,
  title,
  html,
  loading,
  error,
  downloading,
  downloadError,
  onDownload,
  onClose,
}: Props) {
  const { ref: dialogRef, maskProps } = useDialogChrome(open, onClose, { systemBack: true });

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal-backdrop preview-backdrop"
      aria-label={title || "HTML 预览"}
    >
      <button {...maskProps} />
      <div className="modal preview-modal">
        <div className="modal-head">
          <h3>{title || "HTML 预览"}</h3>
          <div className="modal-head-actions">
            {onDownload ? (
              <button type="button" className="ghost" onClick={onDownload} disabled={downloading || loading}>
                {downloading ? "下载中…" : "下载"}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        {loading ? <div className="preview-status">加载中…</div> : null}
        {error ? <div className="preview-error">{error}</div> : null}
        {downloadError ? <div className="preview-error">{downloadError}</div> : null}
        {!loading && !error && html != null ? (
          <iframe
            className="preview-iframe"
            title={title || "HTML 预览"}
            sandbox="allow-scripts allow-forms allow-modals"
            referrerPolicy="no-referrer"
            srcDoc={withPreviewStorage(html)}
          />
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}
