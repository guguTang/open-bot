/**
 * HTML preview helpers (paths, errors, storage shim for sandboxed iframe).
 */

const PREVIEW_STORAGE_SHIM = `<script>(function(){
  function createStorage(){
    var data=Object.create(null);
    var api={
      getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(data,k)?data[k]:null;},
      setItem:function(k,v){data[String(k)]=String(v);},
      removeItem:function(k){delete data[String(k)];},
      clear:function(){Object.keys(data).forEach(function(k){delete data[k];});},
      key:function(i){var keys=Object.keys(data);return keys[i]||null;},
      get length(){return Object.keys(data).length;}
    };
    return new Proxy(api,{
      get:function(t,p){if(p in t)return t[p];if(typeof p==="string")return t.getItem(p);return undefined;},
      set:function(t,p,v){if(p!=="length")t.setItem(p,v);return true;},
      deleteProperty:function(t,p){t.removeItem(p);return true;}
    });
  }
  function install(name){
    var store=createStorage();
    try{
      Object.defineProperty(window,name,{configurable:true,enumerable:true,get:function(){return store;}});
    }catch(e){}
  }
  install("localStorage");
  install("sessionStorage");
})();</script>`;

export function withPreviewStorage(html: string): string {
  if (html.includes('install("localStorage")')) return html;
  return PREVIEW_STORAGE_SHIM + html;
}

export function looksLikeHtml(content: string, hintPathOrLang?: string): boolean {
  const hint = (hintPathOrLang || "").toLowerCase();
  if (/\.(html?|xhtml|svg)$/.test(hint) || hint === "html" || hint === "htm" || hint === "svg") {
    return true;
  }
  const head = content.trimStart().slice(0, 256).toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<svg") ||
    (head.startsWith("<") && /<(html|head|body|div|style|meta)\b/.test(head))
  );
}

/**
 * Decode %XX sequences from remark-rehype / browser URL normalization so
 * sandbox:/workspace/.../中文.html survives the markdown→href pipeline.
 * Malformed escapes are left unchanged.
 */
export function decodeWorkspacePath(raw: string): string {
  const s = raw || "";
  if (!s.includes("%")) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Map any user/tool path onto /workspace/... (never leave bare /tetris.html). */
export function normalizeWorkspacePath(raw: string): string {
  let p = decodeWorkspacePath((raw || "").trim());
  if (!p) return "/workspace";
  p = p.replace(/^sandbox:(?:\/\/)?/i, "").trim();
  p = decodeWorkspacePath(p);
  if (!p) return "/workspace";
  if (!p.startsWith("/")) {
    p = `/workspace/${p}`;
  } else if (p !== "/workspace" && !p.startsWith("/workspace/")) {
    p = `/workspace${p}`;
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** Parse sandbox:/workspace/foo.html → /workspace/foo.html */
export function parseSandboxHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  const m = /^sandbox:(?:\/\/)?(.+)$/i.exec(trimmed);
  if (!m) return null;
  const path = normalizeWorkspacePath(m[1]);
  return path || null;
}

export function previewTitleFromPath(path: string): string {
  const base = path.split("/").filter(Boolean).pop() || path;
  return base;
}

/** Soften API/OS errors so UI never dumps host or /workspace paths. */
export function friendlyFileError(err: unknown, action: "打开" | "下载" = "打开"): string {
  const msg = friendlyOpenError(err);
  if (action === "下载") return msg.replaceAll("打开", "下载");
  return msg;
}

export function friendlyOpenError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();
  if (
    /no such file|not found|enoent|does not exist|path must stay|is a directory/i.test(lower) ||
    /\/workspace|sandbox|docker|container|data\/sandboxes/i.test(raw)
  ) {
    return "无法打开文件，请确认文件仍存在后重试";
  }
  if (!raw.trim() || raw.length > 160 || /[/\\]/.test(raw)) {
    return "无法打开文件";
  }
  return raw;
}
