import { useRef, type RefObject } from "react";
import { fileKind } from "../../lib/skillPackage";

type Props = {
  activePath: string;
  content: string;
  readOnly: boolean;
  errorLines: Set<number>;
  gutterRef: RefObject<HTMLDivElement | null>;
  onContentChange: (path: string, value: string) => void;
};

export function SkillEditorPlainEditor({
  activePath,
  content,
  readOnly,
  errorLines,
  gutterRef,
  onContentChange,
}: Props) {
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
