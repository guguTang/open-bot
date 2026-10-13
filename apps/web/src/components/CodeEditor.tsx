/**
 * CodeMirror 6 editor for the settings「技能」editor. Loaded lazily (React.lazy) so the
 * main bundle does not carry CodeMirror. One EditorView; per-path EditorState is cached
 * so switching tabs keeps undo history and cursor.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { uniq } from "es-toolkit";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- entire CodeEditor is React.lazy-loaded; static imports keep one editor chunk
import { EditorState, StateEffect, StateField, type Extension, RangeSetBuilder, Compartment } from "@codemirror/state";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- entire CodeEditor is React.lazy-loaded; static imports keep one editor chunk
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";

export type CodeEditorProps = {
  /** Package-relative path; picks the language and keys the cached state. */
  path: string;
  value: string;
  readOnly?: boolean;
  /** 1-based lines to mark red (frontmatter errors). */
  errorLines?: number[];
  onChange: (value: string) => void;
};

function languageFor(path: string): Extension {
  const p = path.toLowerCase();
  if (p.endsWith(".md") || p.endsWith(".markdown")) return markdown();
  if (p.endsWith(".py")) return python();
  if (/\.(ts|tsx)$/.test(p)) return javascript({ typescript: true, jsx: p.endsWith("x") });
  if (/\.(js|mjs|cjs|jsx)$/.test(p)) return javascript({ jsx: p.endsWith("x") });
  if (p.endsWith(".json")) return json();
  if (/\.ya?ml$/.test(p)) return yaml();
  if (/\.(sh|bash|zsh)$/.test(p)) return StreamLanguage.define(shell);
  return [];
}

const setErrorLines = StateEffect.define<number[]>();
const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLines)) {
        const b = new RangeSetBuilder<Decoration>();
        const lines = uniq(e.value).filter((n) => n >= 1 && n <= tr.state.doc.lines).sort((a, b) => a - b);
        for (const n of lines) b.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, Decoration.line({ class: "cm-skill-err-line" }));
        deco = b.finish();
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px", backgroundColor: "#fff" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "19px" },
  ".cm-gutters": { backgroundColor: "#fff", borderRight: "1px solid #f3f4f6", color: "#c4c9d1" },
  ".cm-activeLineGutter": { backgroundColor: "#f5f7fb", color: "#6b7280" },
  ".cm-activeLine": { backgroundColor: "#f8fafc" },
  ".cm-skill-err-line": { backgroundColor: "#fee2e2" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "10px 0" },
});

export default function CodeEditor({ path, value, readOnly, errorLines, onChange }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const statesRef = useRef(new Map<string, EditorState>());
  const pathRef = useRef(path);
  const onChangeRef = useRef(onChange);
  const roComp = useRef<Compartment | null>(null);
  if (roComp.current === null) roComp.current = new Compartment();
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  const makeState = (p: string, doc: string, ro: boolean) =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorState.tabSize.of(2),
        languageFor(p),
        errorLineField,
        theme,
        roComp.current!.of([EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });

  // Mount once.
  useEffect(() => {
    const view = new EditorView({ state: makeState(path, value, Boolean(readOnly)), parent: hostRef.current! });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab switch: stash old state, restore/create new one.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pathRef.current === path) return;
    statesRef.current.set(pathRef.current, view.state);
    pathRef.current = path;
    const cached = statesRef.current.get(path);
    view.setState(cached && cached.doc.toString() === value ? cached : makeState(path, value, Boolean(readOnly)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // External value change (e.g. 「不保存」revert, rename) → sync doc.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || pathRef.current !== path) return;
    const cur = view.state.doc.toString();
    if (cur !== value) view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value, path]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: roComp.current!.reconfigure([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly, path]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setErrorLines.of(errorLines ?? []) });
  }, [errorLines, path]);

  return <div ref={hostRef} className="skill-cm" data-path={path} />;
}
