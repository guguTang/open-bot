import {
  File as FileIcon,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  SquareTerminal,
  Star,
} from "lucide-react";
import { SKILL_ENTRY, fileKind, type TreeNode } from "../../lib/skillPackage";

export function NodeIcon({ node, open }: { node: TreeNode; open?: boolean }) {
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
