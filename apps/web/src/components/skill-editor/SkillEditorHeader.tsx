import { ArrowLeft, Save } from "lucide-react";
import type { SkillPackage } from "../../api";
import type { PkgState } from "../../lib/skillPackage";
import { isStructureDirty } from "../../lib/skillPackage";
import { SkillEditorPreviewToggle } from "./SkillEditorPreviewToggle";
import { SkillEditorReadonlyBanner } from "./SkillEditorReadonlyBanner";

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
          {isMd ? <SkillEditorPreviewToggle preview={preview} onPreviewChange={onPreviewChange} /> : null}
          {!readOnly ? (
            <button type="button" className="primary" disabled={saving || !dirty} title="保存全部（Ctrl/⌘+S）" onClick={onSave}>
              <Save size={14} /> {saving ? "保存中…" : "保存全部"}
            </button>
          ) : null}
        </div>
      </div>
      {readOnly ? <SkillEditorReadonlyBanner pkg={pkg} onCopyAsCustom={onCopyAsCustom} /> : null}
    </>
  );
}
