import { ArrowLeft } from "lucide-react";
import { SkillEditorCloseDialog } from "./SkillEditorCloseDialog";
import { SkillEditorContextMenu } from "./SkillEditorContextMenu";
import { SkillEditorFilePane } from "./SkillEditorFilePane";
import { SkillEditorHeader } from "./SkillEditorHeader";
import { SkillEditorTreeSidebar } from "./SkillEditorTreeSidebar";
import type { SkillEditorProps } from "./types";
import { useSkillEditorModel } from "./useSkillEditorModel";
import "./skill-editor.css";

export function SkillEditorMain(props: SkillEditorProps) {
  const model = useSkillEditorModel(props);

  if (model.loadErr) {
    return (
      <div className="skill-editor">
        <div className="skill-editor-head">
          <button type="button" className="ghost skill-back" onClick={model.onBack}>
            <ArrowLeft size={16} /> 返回
          </button>
        </div>
        <div className="skill-editor-error">
          无法打开技能「{model.name}」：{model.loadErr}
        </div>
      </div>
    );
  }
  if (!model.st || !model.pkg) return <div className="skill-editor-loading">加载中…</div>;

  return (
    <div className="skill-editor">
      <SkillEditorHeader
        pkg={model.pkg}
        st={model.st}
        dirty={model.dirty}
        readOnly={model.readOnly}
        isMd={model.isMd}
        preview={model.preview}
        saving={model.saving}
        onBack={() => void model.goBack()}
        onPreviewChange={model.setPreview}
        onSave={() => void model.doSave()}
        onCopyAsCustom={model.onCopyAsCustom}
      />
      {model.displayedSaveIssues.length ? (
        <div className="skill-fm-errors" role="alert">
          <strong>SKILL.md frontmatter 有误，已拦截保存：</strong>
          <ul>
            {model.displayedSaveIssues.map((issue) => (
              <li key={`${issue.line}:${issue.message}`}>
                第 {issue.line} 行：{issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {model.msg ? <div className="skill-editor-msg">{model.msg}</div> : null}
      <div className="skill-editor-body">
        <SkillEditorTreeSidebar
          pkg={model.pkg}
          st={model.st}
          tree={model.tree}
          active={model.active}
          readOnly={model.readOnly}
          expanded={model.expanded}
          pending={model.pending}
          pendingValue={model.pendingValue}
          pendingErr={model.pendingErr}
          dragOver={model.dragOver}
          dragSrc={model.dragSrc}
          onToggleExpanded={model.toggleExpanded}
          onSetExpanded={model.setExpanded}
          onOpenFile={model.openFile}
          onStartPending={model.startPending}
          onPendingValueChange={model.onPendingValueChange}
          onPendingCommit={model.commitPending}
          onPendingCancel={model.cancelPending}
          onSetMenu={model.setMenu}
          onSetDragOver={model.setDragOver}
          onDragStart={model.onDragStart}
          onDragOverNode={model.onDragOverNode}
          onDropNode={model.onDropNode}
          onDragEnd={model.onDragEnd}
          onContextMenuBlank={model.onContextMenuBlank}
        />
        <SkillEditorFilePane
          tabs={model.tabs}
          active={model.active}
          st={model.st}
          readOnly={model.readOnly}
          preview={model.preview}
          isMd={model.isMd}
          activeFile={model.activeFile}
          fmInfo={model.fmInfo}
          errorLines={model.errorLines}
          errorLineList={model.errorLineList}
          gutterRef={model.gutterRef}
          onSelectTab={model.openFile}
          onCloseTab={model.closeTab}
          onContentChange={model.patchFileContent}
        />
      </div>

      {model.menu ? (
        <SkillEditorContextMenu
          menu={model.menu}
          readOnly={model.readOnly}
          onOpenFile={model.openFile}
          onStartPending={model.startPending}
          onRemovePath={model.removePath}
          onClose={() => model.setMenu(null)}
        />
      ) : null}

      {model.closeAsk ? <SkillEditorCloseDialog path={model.closeAsk.path} onResolve={model.closeAsk.resolve} /> : null}
    </div>
  );
}
