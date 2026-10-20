import { Pin, Trash2, Upload } from "lucide-react";
import { useDialogChrome } from "./useDialogOpen";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  canPin?: boolean;
  canUpload?: boolean;
  /** When true, label is「重新上传」; when false/missing and no bundle,「手动上传（可选）」 */
  hasBundle?: boolean;
  canArchive?: boolean;
  onPin?: () => void;
  onUpload?: () => void;
  onArchive?: () => void;
};

/**
 * Micro-app shell 「更多」— same bottom Action Sheet chrome as session「+」.
 */
export function MicroAppMoreSheet({
  open,
  onClose,
  title,
  canPin,
  canUpload = true,
  hasBundle = false,
  canArchive = true,
  onPin,
  onUpload,
  onArchive,
}: Props) {
  const { ref: dialogRef, maskProps } = useDialogChrome(open, onClose, {
    maskClassName: "action-sheet-mask",
  });

  if (!open) return null;

  return (
    <dialog ref={dialogRef} className="action-sheet-root" aria-label={title ? `${title} 更多` : "更多"}>
      <button {...maskProps} />
      <div className="action-sheet">
        <div className="action-sheet-handle" aria-hidden />
        {title ? <div className="action-sheet-title">{title}</div> : null}
        {canPin && onPin ? (
          <button
            type="button"
            className="action-sheet-row action-sheet-row-icon"
            onClick={() => {
              onClose();
              onPin();
            }}
          >
            <span className="action-sheet-row-leading" aria-hidden>
              <Pin size={20} strokeWidth={2} aria-hidden />
            </span>
            固定到我的工具
          </button>
        ) : null}
        {canUpload && onUpload ? (
          <button
            type="button"
            className="action-sheet-row action-sheet-row-icon"
            onClick={() => {
              onClose();
              onUpload();
            }}
          >
            <span className="action-sheet-row-leading" aria-hidden>
              <Upload size={20} strokeWidth={2} aria-hidden />
            </span>
            {hasBundle ? "重新上传 Bundle" : "手动上传 Bundle（可选）"}
          </button>
        ) : null}
        {canArchive && onArchive ? (
          <button
            type="button"
            className="action-sheet-row action-sheet-row-icon action-sheet-row-danger"
            onClick={() => {
              onClose();
              onArchive();
            }}
          >
            <span className="action-sheet-row-leading" aria-hidden>
              <Trash2 size={20} strokeWidth={2} aria-hidden />
            </span>
            下架
          </button>
        ) : null}
        <div className="action-sheet-sep" />
        <button type="button" className="action-sheet-row action-sheet-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </dialog>
  );
}
