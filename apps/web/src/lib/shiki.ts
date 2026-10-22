import type { HighlighterCore, LanguageRegistration } from "shiki/core";

/**
 * Lazy Shiki highlighter: fine-grained core + JS regex engine, github-light/dark dual themes
 * rendered as CSS variables (`--shiki-light` / `--shiki-dark`) so theme switching never re-highlights.
 */
type LangLoader = () => Promise<{ default: LanguageRegistration[] }>;

const LOADERS: Record<string, LangLoader> = {
  javascript: () => import("@shikijs/langs/javascript"),
  typescript: () => import("@shikijs/langs/typescript"),
  jsx: () => import("@shikijs/langs/jsx"),
  tsx: () => import("@shikijs/langs/tsx"),
  json: () => import("@shikijs/langs/json"),
  python: () => import("@shikijs/langs/python"),
  bash: () => import("@shikijs/langs/bash"),
  shellsession: () => import("@shikijs/langs/shellsession"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  sql: () => import("@shikijs/langs/sql"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  markdown: () => import("@shikijs/langs/markdown"),
  go: () => import("@shikijs/langs/go"),
  rust: () => import("@shikijs/langs/rust"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  swift: () => import("@shikijs/langs/swift"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  php: () => import("@shikijs/langs/php"),
  ruby: () => import("@shikijs/langs/ruby"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  diff: () => import("@shikijs/langs/diff"),
  xml: () => import("@shikijs/langs/xml"),
  vue: () => import("@shikijs/langs/vue"),
};

const ALIASES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", node: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  py: "python", python3: "python",
  sh: "bash", shell: "bash", zsh: "bash", console: "shellsession",
  yml: "yaml", md: "markdown", golang: "go", rs: "rust", kt: "kotlin",
  "c++": "cpp", cc: "cpp", h: "c", hpp: "cpp", cs: "csharp", "c#": "csharp",
  rb: "ruby", docker: "dockerfile", patch: "diff", svg: "xml", htm: "html", xhtml: "html",
  jsonc: "json", json5: "json",
};

export function resolveShikiLang(lang: string | undefined): string | null {
  const l = (lang || "").trim().toLowerCase();
  if (!l) return null;
  const id = ALIASES[l] ?? l;
  return id in LOADERS ? id : null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighter: HighlighterCore | null = null;
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      import("@shikijs/themes/github-light"),
      import("@shikijs/themes/github-dark"),
    ]);
    const h = await createHighlighterCore({
      themes: [light.default, dark.default],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    highlighter = h;
    return h;
  })();
  return highlighterPromise;
}

export function isShikiLangReady(id: string): boolean {
  return highlighter != null && loaded.has(id);
}

export function loadShikiLang(id: string): Promise<void> {
  if (isShikiLangReady(id)) return Promise.resolve();
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      const h = await getHighlighter();
      const mod = await LOADERS[id]();
      await h.loadLanguage(...mod.default);
      loaded.add(id);
    })();
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

/** Sync highlight; only call when `isShikiLangReady(id)`. Returns null on failure (plain fallback). */
export function highlightToHtml(code: string, id: string): string | null {
  if (!highlighter || !loaded.has(id)) return null;
  try {
    return highlighter.codeToHtml(code, {
      lang: id,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
