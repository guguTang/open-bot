import { FilePlus, FileText, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { SKILL_ENTRY, dirname } from "../../lib/skillPackage";
import type { ContextMenu, Pending } from "./types";

type Props = {
  menu: ContextMenu;
  readOnly: boolean;
  onOpenFile: (path: string) => void;
  onStartPending: (pending: Pending) => void;
  onRemovePath: (path: string, isFolder: boolean) => void;
  onClose: () => void;
};

export function SkillEditorContextMenu({
  menu,
  readOnly,
  onOpenFile,
  onStartPending,
  onRemovePath,
  onClose,
}: Props) {
  const menuIsEntry = menu.path === SKILL_ENTRY;

  return (
    <div className="skill-ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
      {!menu.isFolder ? (
        <button
          type="button"
          onClick={() => {
            onOpenFile(menu.path);
            onClose();
          }}
        >
          <FileText size={13} /> 在编辑器打开
        </button>
      ) : null}
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          onStartPending({ kind: "new-file", dir: menu.isFolder ? menu.path : dirname(menu.path) });
          onClose();
        }}
      >
        <FilePlus size={13} /> 新建文件
      </button>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => {
          onStartPending({ kind: "new-folder", dir: menu.isFolder ? menu.path : dirname(menu.path) });
          onClose();
        }}
      >
        <FolderPlus size={13} /> 新建文件夹
      </button>
      {menu.path ? (
        <>
          <button
            type="button"
            disabled={readOnly || menuIsEntry}
            title={menuIsEntry ? "入口文件不可改名" : undefined}
            onClick={() => {
              onStartPending({ kind: "rename", path: menu.path });
              onClose();
            }}
          >
            <Pencil size={13} /> 重命名
          </button>
          <button
            type="button"
            className="danger"
            disabled={readOnly || menuIsEntry}
            title={menuIsEntry ? "入口文件不可删" : undefined}
            onClick={() => {
              const snapshot = menu;
              onClose();
              void onRemovePath(snapshot.path, snapshot.isFolder);
            }}
          >
            <Trash2 size={13} /> 删除
          </button>
        </>
      ) : null}
    </div>
  );
}
