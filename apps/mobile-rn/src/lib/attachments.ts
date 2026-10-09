/**
 * 附件白名单与体积预检。
 *
 * 与后端 `services/api/internal/httpserver/attachments.go` 的 `attachmentAllowed`
 * 保持一致：后端是最终裁决方，这里只是提前拦一道，省掉一次注定失败的往返。
 * **两边都要改**，否则用户会看到「前端放行、后端 400」的割裂体验。
 */

/** 与 Go 侧 maxAttachmentBytes 对齐。 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".toml",
  ".ini",
  ".cfg",
  ".log",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
]);

export type PickedFile = {
  /** 本地唯一 key，用于列表渲染与移除 */
  key: string;
  /** 本地 file:// 或 content:// URI，上传时原样传给 FormData */
  uri: string;
  name: string;
  mime: string;
  /** 选择器不一定给 size（content:// 常常是 undefined），此时上传后由后端兜底 */
  size?: number;
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** 与 Go 侧判定顺序一致：先看扩展名，再看 MIME。 */
export function attachmentAllowed(mime: string, name: string): boolean {
  const mt = (mime || "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_EXT.has(extOf(name))) return true;
  if (mt.startsWith("text/")) return true;
  if (mt === "application/json" || mt === "application/xml" || mt === "application/pdf")
    return true;
  if (mt.startsWith("image/")) return true;
  if (mt === "application/javascript" || mt === "application/typescript") return true;
  if (mt === "application/x-yaml" || mt === "text/yaml") return true;
  return false;
}

/** 预检单个文件；通过返回 null，不通过返回可展示的中文原因。 */
export function validateAttachment(file: PickedFile): string | null {
  if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_BYTES) {
    return `文件超过 20MB 限制：${file.name}`;
  }
  if (!attachmentAllowed(file.mime, file.name)) {
    return `不支持的文件类型：${file.name}（支持图片、文本、pdf、json、md、csv 与代码文件）`;
  }
  return null;
}

let seq = 0;

export function makeKey(name: string): string {
  seq += 1;
  return `${Date.now()}-${seq}-${name}`;
}
