/**
 * 工作区路径与产物解析。
 *
 * 逐行对齐 `apps/web/src/components/HtmlPreviewModal.tsx` 与 `ArtifactCards.tsx`，
 * 两端对同一段助手输出必须得出完全一致的结论（尤其是「内部 /workspace 前缀对用户不可见」这条）。
 */

/** 把任意用户/工具产出的路径映射到 /workspace/... （绝不留下裸 `/tetris.html`）。 */
export function normalizeWorkspacePath(raw: string): string {
  let p = (raw || "").trim();
  if (!p) return "/workspace";
  p = p.replace(/^sandbox:(?:\/\/)?/i, "").trim();
  if (!p) return "/workspace";
  if (!p.startsWith("/")) {
    p = `/workspace/${p}`;
  } else if (p !== "/workspace" && !p.startsWith("/workspace/")) {
    // 绝对路径但在工作区根之外 → 当作工作区相对路径处理
    p = `/workspace${p}`;
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** `sandbox:/workspace/foo.html` → `/workspace/foo.html` */
export function parseSandboxHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const m = /^sandbox:(?:\/\/)?(.+)$/i.exec(href.trim());
  if (!m) return null;
  const path = normalizeWorkspacePath(m[1]);
  return path || null;
}

export function previewTitleFromPath(path: string): string {
  return path.split("/").filter(Boolean).pop() || path;
}

export function looksLikeHtml(content: string, hintPathOrLang?: string): boolean {
  const hint = (hintPathOrLang || "").toLowerCase();
  if (/\.(html?|xhtml|svg)$/.test(hint) || hint === "html" || hint === "htm" || hint === "svg") {
    return true;
  }
  const head = (content || "").trimStart().slice(0, 256).toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<svg") ||
    (head.startsWith("<") && /<(html|head|body|div|style|meta)\b/.test(head))
  );
}

/**
 * 把 API / OS 的原始报错软化，保证 UI 里不出现宿主机路径或 /workspace 这类内部信息。
 * 与 Web 端 `friendlyOpenError` 行为一致。
 */
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

/** 产物卡片的展示名（隐藏内部 /workspace 前缀）。 */
export function artifactDisplayName(path: string): string {
  return previewTitleFromPath(path);
}

export type Artifact = { path: string; kind: string };

/**
 * 从助手正文里抽出「结果导向」的部分：
 * - `/workspace/...` 路径 → 产物卡片，正文里不再裸露前缀
 * - 工具吐出的 ```json 代码块 → 折叠起来，正文里留空
 */
export function splitResultOriented(content: string): {
  display: string;
  artifacts: Artifact[];
  collapsedJson: string[];
} {
  const artifacts: Artifact[] = [];
  const collapsedJson: string[] = [];
  let display = content || "";

  const pathRe = /(?:sandbox:(?:\/\/)?)?(\/workspace\/[^\s`"'<>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(content || "")) !== null) {
    const path = normalizeWorkspacePath(m[1].replace(/[.,;:!?)]+$/, ""));
    if (!artifacts.some((a) => a.path === path)) {
      artifacts.push({ path, kind: path.split(".").pop() || "file" });
    }
  }

  display = display.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (full, body: string) => {
    const trimmed = body.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return full;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        if (
          typeof parsed.path === "string" &&
          (parsed.ok === true || typeof parsed.content === "string")
        ) {
          const path = normalizeWorkspacePath(String(parsed.path));
          if (!artifacts.some((a) => a.path === path)) {
            artifacts.push({ path, kind: "write" });
          }
        }
        collapsedJson.push(trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed);
        return "\n\n";
      }
    } catch {
      /* 不是合法 JSON，保留原样 */
    }
    return full;
  });

  // 正文里的裸 /workspace/ 前缀隐藏掉；sandbox:… 链接保留协议头给点击处理
  display = display.replace(/(sandbox:(?:\/\/)?)?\/workspace\//gi, (_full, proto?: string) =>
    proto ? `${proto}/workspace/` : ""
  );

  return { display, artifacts, collapsedJson };
}
