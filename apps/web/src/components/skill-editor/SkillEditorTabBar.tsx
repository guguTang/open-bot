import { X } from "lucide-react";
import { isFileDirty, type PkgState } from "../../lib/skillPackage";

type Props = {
  tabs: string[];
  active: string;
  st: PkgState;
  readOnly: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

export function SkillEditorTabBar({ tabs, active, st, readOnly, onSelect, onClose }: Props) {
  return (
    <div className="skill-tabs" role="tablist" aria-label="已打开的文件">
      {tabs.map((path) => {
        const file = st.files[path];
        const fileDirty = !readOnly && isFileDirty(file);
        const basename = path.split("/").pop() || path;
        const isActive = path === active;
        return (
          <div key={path} className={`skill-tab ${isActive ? "active" : ""}`}>
            <button
              type="button"
              role="tab"
              id={`skill-tab-${path}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className="skill-tab-label"
              onClick={() => onSelect(path)}
              onAuxClick={(event) => {
                if (event.button === 1) void onClose(path);
              }}
              title={path}
            >
              <span>{basename}</span>
              {fileDirty ? <span className="skill-dirty-dot" aria-label="未保存" /> : null}
            </button>
            <button
              type="button"
              className="skill-tab-x"
              aria-label={`关闭 ${basename}`}
              onClick={(event) => {
                event.stopPropagation();
                void onClose(path);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
