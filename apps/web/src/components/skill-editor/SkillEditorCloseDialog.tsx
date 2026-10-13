import { useEffect, useId, useRef } from "react";
import type { CloseChoice } from "./types";

type Props = {
  path: string;
  onResolve: (choice: CloseChoice) => void;
};

export function SkillEditorCloseDialog({ path, onResolve }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onResolveRef = useRef(onResolve);

  useEffect(() => {
    onResolveRef.current = onResolve;
  }, [onResolve]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onResolveRef.current("cancel");
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="skill-choice-dialog" aria-labelledby={titleId}>
      <div className="skill-choice">
        <h4 id={titleId}>「{path}」有未保存的更改</h4>
        <p>关闭前要保存吗？（保存会写回整个技能包）</p>
        <div className="skill-choice-actions">
          <button type="button" className="ghost" onClick={() => onResolveRef.current("cancel")}>
            取消
          </button>
          <button type="button" className="ghost danger" onClick={() => onResolveRef.current("discard")}>
            不保存
          </button>
          <button type="button" className="primary" onClick={() => onResolveRef.current("save")}>
            保存
          </button>
        </div>
      </div>
    </dialog>
  );
}
