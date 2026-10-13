import { normalizeWorkspacePath, previewTitleFromPath } from "./htmlPreviewModel";

/** Friendly label for artifact cards (hide internal /workspace prefix). */
export function artifactDisplayName(path: string): string {
  return previewTitleFromPath(path);
}

/** Extract internal workspace paths and JSON tool blobs from assistant text. */
export function splitResultOriented(content: string): {
  display: string;
  artifacts: { path: string; kind: string }[];
  collapsedJson: string[];
} {
  const artifacts: { path: string; kind: string }[] = [];
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
        if (typeof parsed.path === "string" && (parsed.ok === true || typeof parsed.content === "string")) {
          const path = normalizeWorkspacePath(String(parsed.path));
          if (!artifacts.some((a) => a.path === path)) {
            artifacts.push({ path, kind: "write" });
          }
        }
        collapsedJson.push(trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed);
        return "\n\n";
      }
    } catch {
      /* keep */
    }
    return full;
  });

  display = display.replace(/(sandbox:(?:\/\/)?)?\/workspace\//gi, (_full, proto?: string) =>
    proto ? `${proto}/workspace/` : "",
  );

  return { display, artifacts, collapsedJson };
}
