import { ArrowLeft, Eye, Pencil, Save } from "lucide-react";
import type { SkillPackage } from "../../api";
import type { PkgState } from "../../lib/skillPackage";
import { isStructureDirty } from "../../lib/skillPackage";

type Props = {
  pkg: SkillPackage;
  st: PkgState;
  dirty: boolean;
  readOnly: boolean;
  isMd: boolean;
  preview: boolean;
  saving: boolean;
  onBack: () => void;
  onPreviewChange: (preview: boolean) => void;
  onSave: () => void;
  onCopyAsCustom?: (pkg: SkillPackage) => void;
};

export function SkillEditorHeader({
  pkg,
  st,
  dirty,
  readOnly,
  isMd,
  preview,
  saving,
  onBack,
  onPreviewChange,
  onSave,
  onCopyAsCustom,
}: Props) {
  return (
    <>
      <div className="skill-editor-head">
        <button type="button" className="ghost skill-back" onClick={onBack} title="返回技能列表">
          <ArrowLeft size={16} />
        </button>
        <div className="skill-editor-title">
          <span>{pkg.name}</span>
          <span className={`skill-source-pill ${pkg.source}`}>{pkg.source === "builtin" ? "内置" : "自建"}</span>
          {dirty && !readOnly ? (
            <span className="skill-editor-dirty">未保存{isStructureDirty(st) ? "（含结构变更）" : ""}</span>
          ) : null}
        </div>
        <div className="skill-editor-actions">
          {isMd ? (
            <div className="skill-seg" role="group" aria-label="编辑或预览">
              <button type="button" className={!preview ? "on" : ""} onClick={() => onPreviewChange(false)}>
                <Pencil size={13} /> 编辑
              </button>
              <button type="button" className={preview ? "on" : ""} onClick={() => onPreviewChange(true)}>
                <Eye size={13} /> 预览
              </button>
            </div>
          ) : null}
          {!readOnly ? (
            <button type="button" className="primary" disabled={saving || !dirty} title="保存全部（Ctrl/⌘+S）" onClick={onSave}>
              <Save size={14} /> {saving ? "保存中…" : "保存全部"}
            </button>
          ) : null}
        </div>
      </div>
      {readOnly ? (
        <div className="skill-readonly-banner">
          内置技能，可复制为自建后编辑。
          {onCopyAsCustom ? (
            <button type="button" className="ghost" onClick={() => onCopyAsCustom(pkg)}>
              复制为自建
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
