import { useDialogChrome } from "./useDialogOpen";

type Props = {
  open: boolean;
  title?: string;
  onClose: () => void;
  onDelete: () => void;
  /** When set (agent long-press), show non-danger「复制助手」above delete. */
  onClone?: () => void;
  /** When set (agent long-press), show「Bot 设置」to open Bot settings / 人设. */
  onSettings?: () => void;
  /** When set (channel long-press), show「群设置」for member management. */
  onGroupSettings?: () => void;
};

/**
 * Bottom sheet for conversation / agent / channel row long-press (touch UI).
 * Agents: Bot 设置 + 复制助手 + destructive delete.
 * Channels: 群设置 + destructive delete.
 */
export function ConvActionSheet({
  open,
  title,
  onClose,
  onDelete,
  onClone,
  onSettings,
  onGroupSettings,
}: Props) {
  const { ref: dialogRef, maskProps } = useDialogChrome(open, onClose, {
    maskClassName: "action-sheet-mask",
  });

  if (!open) return null;

  return (
    <dialog ref={dialogRef} className="action-sheet-root" aria-label={title || "会话操作"}>
      <button {...maskProps} />
      <div className="action-sheet">
        <div className="action-sheet-handle" aria-hidden />
        {title ? <div className="action-sheet-title">{title}</div> : null}
        {onSettings ? (
          <button
            type="button"
            className="action-sheet-row"
            onClick={() => {
              onClose();
              onSettings();
            }}
          >
            Bot 设置
          </button>
        ) : null}
        {onGroupSettings ? (
          <button
            type="button"
            className="action-sheet-row"
            onClick={() => {
              onClose();
              onGroupSettings();
            }}
          >
            群设置
          </button>
        ) : null}
        {onClone ? (
          <button
            type="button"
            className="action-sheet-row"
            onClick={() => {
              onClose();
              onClone();
            }}
          >
            复制助手
          </button>
        ) : null}
        <button
          type="button"
          className="action-sheet-row action-sheet-row-danger"
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          删除会话
        </button>
        <button type="button" className="action-sheet-row action-sheet-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </dialog>
  );
}
