import type { SkillPackage } from "../../api";

type Props = {
  pkg: SkillPackage;
  onCopyAsCustom?: (pkg: SkillPackage) => void;
};

export function SkillEditorReadonlyBanner({ pkg, onCopyAsCustom }: Props) {
  return (
    <div className="skill-readonly-banner">
      内置技能，可复制为自建后编辑。
      {onCopyAsCustom ? (
        <button type="button" className="ghost" onClick={() => onCopyAsCustom(pkg)}>
          复制为自建
        </button>
      ) : null}
    </div>
  );
}
