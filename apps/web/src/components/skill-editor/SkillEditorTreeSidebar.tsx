import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  File as FileIcon,
  FileCode2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  SquareTerminal,
  Star,
  Trash2,
} from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  SKILL_ENTRY,
  dirname,
  fileKind,
  isFileDirty,
  type PkgState,
  type TreeNode,
} from "../../lib/skillPackage";
import type { SkillPackage } from "../../api";
import type { ContextMenu, Pending } from "./types";

type Props = {
  pkg: SkillPackage;
  st: PkgState;
  tree: TreeNode[];
  active: string;
  readOnly: boolean;
  expanded: Set<string>;
  pending: Pending | null;
  pendingValue: string;
  pendingErr: string;
  dragOver: string | null;
  dragSrc: RefObject<string | null>;
  onToggleExpanded: (path: string) => void;
  onSetExpanded: (updater: (prev: Set<string>) => Set<string>) => void;
  onOpenFile: (path: string) => void;
  onStartPending: (pending: Pending) => void;
  onPendingValueChange: (value: string) => void;
  onPendingCommit: () => void;
  onPendingCancel: () => void;
  onSetMenu: (menu: ContextMenu | null) => void;
  onSetDragOver: (target: string | null) => void;
  onDragStart: (event: DragEvent, path: string) => void;
  onDragOverNode: (event: DragEvent, node: TreeNode | null) => void;
  onDropNode: (event: DragEvent, node: TreeNode | null) => void;
  onDragEnd: () => void;
  onContextMenuBlank: (event: React.MouseEvent) => void;
};

function NodeIcon({ node, open }: { node: TreeNode; open?: boolean }) {
  if (node.kind === "folder") return open ? <FolderOpen size={15} /> : <Folder size={15} />;
  if (node.path === SKILL_ENTRY) return <Star size={15} className="skill-tree-star" />;
  switch (fileKind(node.path)) {
    case "md":
      return <FileText size={15} />;
    case "py":
    case "code":
      return <FileCode2 size={15} />;
    case "sh":
      return <SquareTerminal size={15} />;
    default:
      return <FileIcon size={15} />;
  }
}

function PendingNameInput({
  value,
  label,
  placeholder,
  error,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  label: string;
  placeholder: string;
  error?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onCancel}
      />
      {error ? <div className="skill-tree-pending-err">{error}</div> : null}
    </>
  );
}

function PendingRow({
  depth,
  kind,
  pendingValue,
  pendingErr,
  onPendingValueChange,
  onPendingCommit,
  onPendingCancel,
}: {
  depth: number;
  kind: "file" | "folder";
  pendingValue: string;
  pendingErr: string;
  onPendingValueChange: (value: string) => void;
  onPendingCommit: () => void;
  onPendingCancel: () => void;
}) {
  const label = kind === "folder" ? "新建文件夹名称" : "新建文件名称";
  return (
    <div className="skill-tree-row pending" style={{ paddingLeft: 8 + depth * 14 }}>
      <PendingNameInput
        value={pendingValue}
        label={label}
        placeholder={kind === "folder" ? "文件夹名" : "文件名，如 tips.md"}
        error={pendingErr || undefined}
        onChange={onPendingValueChange}
        onCommit={onPendingCommit}
        onCancel={onPendingCancel}
      />
    </div>
  );
}

function TreeNodes({
  nodes,
  depth,
  dir,
  props,
}: {
  nodes: TreeNode[];
  depth: number;
  dir: string;
  props: Props;
}) {
  const {
    st,
    active,
    readOnly,
    expanded,
    pending,
    pendingValue,
    pendingErr,
    dragOver,
    onToggleExpanded,
    onOpenFile,
    onStartPending,
    onPendingValueChange,
    onPendingCommit,
    onPendingCancel,
    onSetMenu,
    onSetDragOver,
    onDragStart,
    onDragOverNode,
    onDropNode,
    onDragEnd,
  } = props;

  return (
    <>
      {pending && pending.kind !== "rename" && pending.dir === dir ? (
        <PendingRow
          depth={depth}
          kind={pending.kind === "new-folder" ? "folder" : "file"}
          pendingValue={pendingValue}
          pendingErr={pendingErr}
          onPendingValueChange={onPendingValueChange}
          onPendingCommit={onPendingCommit}
          onPendingCancel={onPendingCancel}
        />
      ) : null}
      {nodes.map((node) => {
        const isOpen = node.kind === "folder" && expanded.has(node.path);
        const renaming = pending?.kind === "rename" && pending.path === node.path;
        const isEntry = node.path === SKILL_ENTRY;
        const fileDirty = node.kind === "file" ? isFileDirty(st.files[node.path]) : false;
        const rowLabel = node.kind === "folder" ? `展开或折叠文件夹 ${node.path}` : `打开文件 ${node.path}`;

        return (
          <div key={node.path}>
            {renaming ? (
              <div className="skill-tree-row pending" style={{ paddingLeft: 8 + depth * 14 }}>
                <NodeIcon node={node} open={isOpen} />
                <PendingNameInput
                  value={pendingValue}
                  label={`重命名 ${node.path}`}
                  placeholder={node.name}
                  error={pendingErr || undefined}
                  onChange={onPendingValueChange}
                  onCommit={onPendingCommit}
                  onCancel={onPendingCancel}
                />
              </div>
            ) : (
              <div
                className={[
                  "skill-tree-row",
                  node.kind === "file" && active === node.path ? "active" : "",
                  node.kind === "folder" && dragOver === node.path ? "drop" : "",
                ].join(" ")}
                style={{ paddingLeft: 8 + depth * 14 }}
                onDragOver={(event) => onDragOverNode(event, node)}
                onDragLeave={() => onSetDragOver(null)}
                onDrop={(event) => onDropNode(event, node)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSetMenu({ x: event.clientX, y: event.clientY, path: node.path, isFolder: node.kind === "folder" });
                }}
              >
                <button
                  type="button"
                  className="skill-tree-row-main"
                  draggable={!readOnly && !isEntry}
                  aria-label={rowLabel}
                  title={node.path}
                  onDragStart={(event) => onDragStart(event, node.path)}
                  onDragEnd={onDragEnd}
                  onClick={() => {
                    if (node.kind === "folder") onToggleExpanded(node.path);
                    else onOpenFile(node.path);
                  }}
                  onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (node.kind === "folder") onToggleExpanded(node.path);
                    else onOpenFile(node.path);
                  }}
                >
                  <span className="skill-tree-caret">
                    {node.kind === "folder" ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
                  </span>
                  <NodeIcon node={node} open={isOpen} />
                  <span className="skill-tree-name">{node.name}</span>
                  {isEntry ? <span className="skill-entry-pill">入口</span> : null}
                  {fileDirty ? <span className="skill-dirty-dot" aria-label="未保存" /> : null}
                </button>
                {!readOnly ? (
                  <span className="skill-tree-actions">
                    {node.kind === "folder" ? (
                      <button
                        type="button"
                        title="在此新建文件"
                        aria-label={`在 ${node.path} 新建文件`}
                        onClick={() => onStartPending({ kind: "new-file", dir: node.path })}
                      >
                        <Plus size={13} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title="更多"
                      aria-label={`${node.path} 更多操作`}
                      onClick={(event) => {
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        onSetMenu({ x: rect.left, y: rect.bottom + 2, path: node.path, isFolder: node.kind === "folder" });
                      }}
                    >
                      <Ellipsis size={13} />
                    </button>
                  </span>
                ) : null}
              </div>
            )}
            {node.kind === "folder" && isOpen ? <TreeNodes nodes={node.children} depth={depth + 1} dir={node.path} props={props} /> : null}
          </div>
        );
      })}
    </>
  );
}

export function SkillEditorTreeSidebar(props: Props) {
  const {
    pkg,
    readOnly,
    expanded,
    dragOver,
    tree,
    onSetExpanded,
    onStartPending,
    onDragOverNode,
    onDropNode,
    onContextMenuBlank,
  } = props;

  return (
    <aside
      className={`skill-tree ${dragOver === "" ? "drop" : ""}`}
      onDragOver={(event) => onDragOverNode(event, null)}
      onDrop={(event) => onDropNode(event, null)}
      onContextMenu={onContextMenuBlank}
    >
      <div className="skill-tree-root">
        <button
          type="button"
          className="skill-tree-root-name"
          onClick={() =>
            onSetExpanded((previous) => {
              const next = new Set(previous);
              if (next.has("")) next.delete("");
              else next.add("");
              return next;
            })
          }
        >
          {expanded.has("") ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{pkg.name}</span>
        </button>
        {!readOnly ? (
          <span className="skill-tree-root-actions">
            <button type="button" title="新建文件" aria-label="在根目录新建文件" onClick={() => onStartPending({ kind: "new-file", dir: "" })}>
              <FilePlus size={14} />
            </button>
            <button
              type="button"
              title="新建文件夹"
              aria-label="在根目录新建文件夹"
              onClick={() => onStartPending({ kind: "new-folder", dir: "" })}
            >
              <FolderPlus size={14} />
            </button>
          </span>
        ) : null}
      </div>
      {expanded.has("") ? <TreeNodes nodes={tree} depth={1} dir="" props={props} /> : null}
    </aside>
  );
}

type ContextMenuProps = {
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
}: ContextMenuProps) {
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
