import type { SkillPackage } from "../../api";
import type { TreeNode } from "../../lib/skillPackage";

export type SkillEditorProps = {
  name: string;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (pkg: SkillPackage) => void;
  onCopyAsCustom?: (pkg: SkillPackage) => void;
};

export type Pending =
  | { kind: "new-file"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename"; path: string };

export type ContextMenu = { x: number; y: number; path: string; isFolder: boolean };

export type CloseChoice = "save" | "discard" | "cancel";

export type { TreeNode };
