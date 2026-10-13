import { Suspense, lazy, useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { SKILL_ENTRY, fileKind, isFileDirty, stripFrontmatter, type PkgState } from "../../lib/skillPackage";
import { MarkdownMessage } from "../MarkdownMessage";

const CodeEditor = lazy(() => import("../CodeEditor"));

type FrontmatterPreview = {
  name?: string;
  description?: string;
} | null;

type Props = {
  tabs: string[];
  active: string;
  st: PkgState;
  readOnly: boolean;
  preview: boolean;
  isMd: boolean;
  activeFile: { content: string } | undefined;
  fmInfo: FrontmatterPreview;
  errorLines: Set<number>;
  errorLineList: number[];
  gutterRef: RefObject<HTMLDivElement | null>;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onContentChange: (path: string, value: string) => void;
};

function SkillEditorTabBar({
  tabs,
  active,
  st,
  readOnly,
  onSelect,
  onClose,
}: {
  tabs: string[];
  active: string;
  st: PkgState;
  readOnly: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
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

function SkillEditorPlainEditor({
  activePath,
  content,
  readOnly,
  errorLines,
  gutterRef,
  onContentChange,
}: {
  activePath: string;
  content: string;
  readOnly: boolean;
  errorLines: Set<number>;
  gutterRef: RefObject<HTMLDivElement | null>;
  onContentChange: (path: string, value: string) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const lineCount = content.split("\n").length;
  const editorLabel = `编辑 ${activePath}`;

  return (
    <div className="skill-code">
      <div className="skill-gutter" ref={gutterRef} aria-hidden>
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index} className={errorLines.has(index + 1) ? "err" : ""}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        ref={textRef}
        aria-label={editorLabel}
        className={`skill-textarea kind-${fileKind(activePath)}`}
        value={content}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !readOnly) {
            event.preventDefault();
            const element = event.currentTarget;
            const { selectionStart, selectionEnd, value } = element;
            const next = value.slice(0, selectionStart) + "  " + value.slice(selectionEnd);
            onContentChange(activePath, next);
            requestAnimationFrame(() => {
              if (textRef.current) textRef.current.selectionStart = textRef.current.selectionEnd = selectionStart + 2;
            });
          }
        }}
        onChange={(event) => onContentChange(activePath, event.target.value)}
      />
    </div>
  );
}

export function SkillEditorFilePane({
  tabs,
  active,
  st,
  readOnly,
  preview,
  isMd,
  activeFile,
  fmInfo,
  errorLines,
  errorLineList,
  gutterRef,
  onSelectTab,
  onCloseTab,
  onContentChange,
}: Props) {
  const plainEditor = activeFile ? (
    <SkillEditorPlainEditor
      activePath={active}
      content={activeFile.content}
      readOnly={readOnly}
      errorLines={errorLines}
      gutterRef={gutterRef}
      onContentChange={onContentChange}
    />
  ) : null;

  return (
    <section className="skill-pane" aria-labelledby={active ? `skill-tab-${active}` : undefined}>
      <SkillEditorTabBar tabs={tabs} active={active} st={st} readOnly={readOnly} onSelect={onSelectTab} onClose={onCloseTab} />
      {activeFile ? (
        preview && isMd ? (
          <div className="skill-preview">
            {active === SKILL_ENTRY && fmInfo ? (
              <div className="skill-preview-fm">
                <div>
                  <b>name</b> {fmInfo.name || "—"}
                </div>
                <div>
                  <b>description</b> {fmInfo.description || "—"}
                </div>
              </div>
            ) : null}
            <MarkdownMessage content={active === SKILL_ENTRY ? stripFrontmatter(activeFile.content) : activeFile.content} />
          </div>
        ) : (
          <Suspense fallback={plainEditor}>
            <CodeEditor
              path={active}
              value={activeFile.content}
              readOnly={readOnly}
              errorLines={errorLineList}
              onChange={(value) => onContentChange(active, value)}
            />
          </Suspense>
        )
      ) : (
        <div className="skill-pane-empty">从左侧选择文件</div>
      )}
    </section>
  );
}
