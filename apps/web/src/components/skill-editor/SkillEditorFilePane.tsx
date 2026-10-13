import { Suspense, lazy, type RefObject } from "react";
import { SKILL_ENTRY, stripFrontmatter } from "../../lib/skillPackage";
import { MarkdownMessage } from "../MarkdownMessage";
import { SkillEditorPlainEditor } from "./SkillEditorPlainEditor";
import { SkillEditorTabBar } from "./SkillEditorTabBar";
import type { PkgState } from "../../lib/skillPackage";

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
