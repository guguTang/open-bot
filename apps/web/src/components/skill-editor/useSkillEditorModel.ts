import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { getSkillPackage, saveSkillPackage, type SkillPackage } from "../../api";
import {
  SKILL_ENTRY,
  buildTree,
  checkSkillFrontmatter,
  createFile,
  createFolder,
  deletePath,
  dirname,
  fileKind,
  isFileDirty,
  isPackageDirty,
  loadPackage,
  markSaved,
  moveInto,
  renamePath,
  serializePackage,
  type OpResult,
  type PkgState,
} from "../../lib/skillPackage";
import { useConfirm } from "../ConfirmProvider";
import type { CloseChoice, ContextMenu, Pending, SkillEditorProps } from "./types";

export function useSkillEditorModel({ name, onBack, onDirtyChange, onSaved, onCopyAsCustom }: SkillEditorProps) {
  const confirm = useConfirm();
  const [pkg, setPkg] = useState<SkillPackage | null>(null);
  const [st, setSt] = useState<PkgState | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingValue, setPendingValue] = useState("");
  const [pendingErr, setPendingErr] = useState("");
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [saveIssues, setSaveIssues] = useState<{ line: number; message: string }[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [closeAsk, setCloseAsk] = useState<{ path: string; resolve: (choice: CloseChoice) => void } | null>(null);
  const dragSrc = useRef<string | null>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const readOnly = Boolean(pkg?.read_only);
  const dirty = st ? isPackageDirty(st) : false;
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-pass-live-state-to-parent -- optional settings-shell hook
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => {
    return () => {
      onDirtyChangeRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadErr("");
    void getSkillPackage(name)
      .then((loaded) => {
        if (cancelled) return;
        const state = loadPackage(loaded.files);
        setPkg(loaded);
        setSt(state);
        const first = SKILL_ENTRY in state.files ? SKILL_ENTRY : Object.keys(state.files)[0] || "";
        setTabs(first ? [first] : []);
        setActive(first);
        setExpanded(new Set(["", ...Object.keys(state.files).map(dirname)]));
      })
      .catch((err) => {
        if (!cancelled) setLoadErr(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const tree = useMemo(() => (st ? buildTree(st) : []), [st]);
  const activeFile = st && active ? st.files[active] : undefined;
  const isMd = active ? fileKind(active) === "md" : false;

  const fmInfo = useMemo(() => {
    if (!st || !(SKILL_ENTRY in st.files)) return null;
    return checkSkillFrontmatter(st.files[SKILL_ENTRY].content, pkg?.custom ? name : undefined);
  }, [st, pkg?.custom, name]);

  const displayedSaveIssues = useMemo(() => {
    if (!saveIssues.length) return saveIssues;
    if (fmInfo && fmInfo.issues.length === 0) return [];
    return saveIssues;
  }, [saveIssues, fmInfo]);

  const errorLines = useMemo(() => {
    const lines = new Set<number>();
    if (active === SKILL_ENTRY) for (const issue of displayedSaveIssues) lines.add(issue.line);
    return lines;
  }, [displayedSaveIssues, active]);
  const errorLineList = useMemo(() => [...errorLines], [errorLines]);

  const apply = (result: OpResult): boolean => {
    if (result.error !== undefined) {
      setMsg(result.error);
      return false;
    }
    if (result.renamed && Object.keys(result.renamed).length) {
      const map = result.renamed;
      setTabs((current) => current.map((tab) => map[tab] ?? tab));
      setActive((current) => map[current] ?? current);
    }
    setSt(result.state);
    setMsg("");
    return true;
  };

  const openFile = (path: string) => {
    if (!st || !(path in st.files)) return;
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
    if (fileKind(path) !== "md") setPreview(false);
  };

  const patchFileContent = useCallback((path: string, value: string) => {
    setSt((current) =>
      current && current.files[path] ? { ...current, files: { ...current.files, [path]: { ...current.files[path], content: value } } } : current,
    );
  }, []);

  const doSave = useCallback(async (): Promise<boolean> => {
    if (!st || !pkg || readOnly) return false;
    const entry = st.files[SKILL_ENTRY];
    if (!entry) {
      setMsg("缺少入口文件 SKILL.md");
      return false;
    }
    const info = checkSkillFrontmatter(entry.content, name);
    if (info.issues.length) {
      setSaveIssues(info.issues);
      setTabs((current) => (current.includes(SKILL_ENTRY) ? current : [SKILL_ENTRY, ...current]));
      setActive(SKILL_ENTRY);
      setPreview(false);
      setMsg("");
      return false;
    }
    setSaveIssues([]);
    setSaving(true);
    setMsg("");
    try {
      const saved = await saveSkillPackage(name, serializePackage(st));
      setPkg(saved);
      setSt((current) => (current ? markSaved(current) : current));
      setMsg("已保存");
      onSaved?.(saved);
      return true;
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [st, pkg, readOnly, name, onSaved]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!readOnly && !saving) void doSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doSave, readOnly, saving]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement)?.closest?.(".skill-ctx-menu")) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const askClose = (path: string) => new Promise<CloseChoice>((resolve) => setCloseAsk({ path, resolve }));

  const closeTab = async (path: string) => {
    if (!st) return;
    const file = st.files[path];
    if (!readOnly && isFileDirty(file)) {
      const choice = await askClose(path);
      setCloseAsk(null);
      if (choice === "cancel") return;
      if (choice === "save") {
        const ok = await doSave();
        if (!ok) return;
      } else if (file) {
        setSt((current) =>
          current
            ? { ...current, files: { ...current.files, [path]: { ...current.files[path], content: current.files[path].saved ?? "" } } }
            : current,
        );
      }
    }
    const closedIndex = tabs.indexOf(path);
    const remainingTabs = tabs.filter((tab) => tab !== path);
    setTabs((current) => current.filter((tab) => tab !== path));
    setActive((current) => {
      if (current !== path) return current;
      return remainingTabs[Math.min(closedIndex, remainingTabs.length - 1)] || "";
    });
  };

  const goBack = async () => {
    if (dirty && !readOnly) {
      const ok = await confirm({
        title: "有未保存的更改",
        description: "返回列表将丢失未保存的修改。",
        confirmLabel: "不保存并返回",
        cancelLabel: "继续编辑",
        danger: true,
      });
      if (!ok) return;
    }
    onBack();
  };

  const startPending = (next: Pending) => {
    if (readOnly) return;
    setPending(next);
    setPendingErr("");
    if (next.kind === "rename") setPendingValue(next.path.split("/").pop() || "");
    else {
      setPendingValue("");
      setExpanded((current) => new Set([...current, next.dir]));
    }
  };

  const commitPending = () => {
    if (!pending || !st) return;
    let result: OpResult;
    if (pending.kind === "new-file") result = createFile(st, pending.dir, pendingValue);
    else if (pending.kind === "new-folder") result = createFolder(st, pending.dir, pendingValue);
    else result = renamePath(st, pending.path, pendingValue);
    if (result.error !== undefined) {
      setPendingErr(result.error);
      return;
    }
    apply(result);
    if (pending.kind === "new-file") {
      const path = pending.dir ? `${pending.dir}/${pendingValue.trim()}` : pendingValue.trim();
      setTabs((current) => [...current, path]);
      setActive(path);
    } else if (pending.kind === "new-folder") {
      const path = pending.dir ? `${pending.dir}/${pendingValue.trim()}` : pendingValue.trim();
      setExpanded((current) => new Set([...current, path]));
    }
    setPending(null);
  };

  const removePath = async (path: string, isFolder: boolean) => {
    if (!st || readOnly || path === SKILL_ENTRY) return;
    const ok = await confirm({
      title: `删除${isFolder ? "文件夹" : "文件"}「${path}」？`,
      description: isFolder ? "文件夹内的所有文件都会删除；保存后生效。" : "保存后生效。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    const result = deletePath(st, path);
    if (apply(result)) {
      setTabs((current) => current.filter((tab) => !(tab === path || tab.startsWith(`${path}/`))));
      if (active === path || active.startsWith(`${path}/`)) setActive(SKILL_ENTRY);
    }
  };

  const onDragStart = (event: DragEvent, path: string) => {
    if (readOnly || path === SKILL_ENTRY) {
      event.preventDefault();
      return;
    }
    dragSrc.current = path;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", path);
  };

  const dropTargetDir = (node: { kind: string; path: string } | null) =>
    node === null ? "" : node.kind === "folder" ? node.path : dirname(node.path);

  const onDragOverNode = (event: DragEvent, node: { kind: string; path: string } | null) => {
    const src = dragSrc.current;
    if (!src) return;
    const target = dropTargetDir(node);
    if (target === src || target.startsWith(`${src}/`)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragOver(target);
  };

  const onDropNode = (event: DragEvent, node: { kind: string; path: string } | null) => {
    event.preventDefault();
    event.stopPropagation();
    const src = dragSrc.current;
    dragSrc.current = null;
    setDragOver(null);
    if (!src || !st) return;
    const target = dropTargetDir(node);
    if (apply(moveInto(st, src, target))) setExpanded((current) => new Set([...current, target]));
  };

  const toggleExpanded = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onPendingValueChange = useCallback((value: string) => {
    setPendingValue(value);
    setPendingErr("");
  }, []);

  const onDragEnd = useCallback(() => {
    dragSrc.current = null;
    setDragOver(null);
  }, []);

  const cancelPending = useCallback(() => setPending(null), []);

  const onContextMenuBlank = useCallback((event: ReactMouseEvent<Element>) => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, path: "", isFolder: true });
    }
  }, []);

  return {
    name,
    loadErr,
    pkg,
    st,
    tree,
    tabs,
    active,
    readOnly,
    dirty,
    preview,
    setPreview,
    saving,
    msg,
    displayedSaveIssues,
    fmInfo,
    activeFile,
    isMd,
    errorLines,
    errorLineList,
    expanded,
    pending,
    pendingValue,
    pendingErr,
    dragOver,
    dragSrc,
    menu,
    setMenu,
    closeAsk,
    gutterRef,
    onBack,
    goBack,
    doSave,
    openFile,
    closeTab,
    patchFileContent,
    startPending,
    commitPending,
    removePath,
    toggleExpanded,
    setExpanded,
    onPendingValueChange,
    cancelPending,
    setDragOver,
    onDragStart,
    onDragOverNode,
    onDropNode,
    onDragEnd,
    onContextMenuBlank,
    onCopyAsCustom,
  };
}
