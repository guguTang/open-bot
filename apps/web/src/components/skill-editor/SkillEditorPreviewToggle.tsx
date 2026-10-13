import { Eye, Pencil } from "lucide-react";

type Props = {
  preview: boolean;
  onPreviewChange: (preview: boolean) => void;
};

export function SkillEditorPreviewToggle({ preview, onPreviewChange }: Props) {
  return (
    <div className="skill-seg" role="group" aria-label="编辑或预览">
      <button type="button" className={!preview ? "on" : ""} onClick={() => onPreviewChange(false)}>
        <Pencil size={13} /> 编辑
      </button>
      <button type="button" className={preview ? "on" : ""} onClick={() => onPreviewChange(true)}>
        <Eye size={13} /> 预览
      </button>
    </div>
  );
}
