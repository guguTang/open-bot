import { Plus, Users } from "lucide-react";
import { useEffect } from "react";
import { useDialogOpen } from "./useDialogOpen";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreateBot: () => void;
  onCreateGroup: () => void;
};

/**
 * Touch / layout-narrow 「+」 Action Sheet (C-1).
 * Only 新建 Bot / 新建群聊 — machine picker stays in create flow, not here.
 */
export function CreateActionSheet({ open, onClose, onCreateBot, onCreateGroup }: Props) {
  const dialogRef = useDialogOpen(open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog ref={dialogRef} className="action-sheet-root" aria-label="新建">
      <button type="button" className="action-sheet-mask" aria-label="关闭" onClick={onClose} />
      <div className="action-sheet create-action-sheet">
        <div className="action-sheet-handle" aria-hidden />
        <button
          type="button"
          className="action-sheet-row action-sheet-row-icon"
          onClick={() => {
            onClose();
            onCreateBot();
          }}
        >
          <span className="action-sheet-row-leading" aria-hidden>
            <Plus size={20} strokeWidth={2} aria-hidden />
          </span>
          新建 Bot
        </button>
        <button
          type="button"
          className="action-sheet-row action-sheet-row-icon"
          onClick={() => {
            onClose();
            onCreateGroup();
          }}
        >
          <span className="action-sheet-row-leading" aria-hidden>
            <Users size={20} strokeWidth={2} aria-hidden />
          </span>
          新建群聊
        </button>
        <div className="action-sheet-sep" />
        <button type="button" className="action-sheet-row action-sheet-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </dialog>
  );
}
