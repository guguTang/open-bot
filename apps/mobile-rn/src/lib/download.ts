/**
 * 文件下载与分享。
 *
 * RN 没有 `<a download>`，Web 端的 `triggerBrowserDownload` 在这里完全用不上。
 * 这里的做法是：带鉴权头把字节流落到 cache 目录，再交给系统分享面板
 * （用户可存到「文件」/ 相册 / 微信等）。这是 RN 侧拿到文件的唯一原生路径。
 *
 * 关键点：附件与产物接口都要 `Authorization: Bearer`，所以**不能**把地址直接丢给
 * `Linking.openURL`（那等于把 JWT 暴露在 URL 与系统日志里），必须走带 header 的下载。
 */

import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { absolutizeApiUrl, sandboxFileDownloadURL } from "@/api";
import { getToken } from "@/api/session";
import { previewTitleFromPath } from "@/lib/workspace";

/** 分享不可用时（少见：模拟器 / 未装分享组件）给用户的兜底提示。 */
export class ShareUnavailableError extends Error {
  constructor(public readonly localUri: string) {
    super("当前设备不支持分享，文件已缓存到本地");
    this.name = "ShareUnavailableError";
  }
}

function safeFileName(name: string): string {
  // 文件名里不能带路径分隔符，否则 File 构造会把它当子目录
  const base = previewTitleFromPath(name)
    .replace(/[/\\:*?"<>|]/g, "_")
    .trim();
  return base || "download";
}

async function authHeader(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function downloadDir(): Directory {
  const dir = new Directory(Paths.cache, "openbot-downloads");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** 带鉴权把远端文件抓到 cache 目录，返回本地 File。 */
export async function downloadToCache(opts: {
  url: string;
  filename: string;
  headers?: Record<string, string>;
}): Promise<File> {
  const target = new File(downloadDir(), safeFileName(opts.filename));
  // idempotent：同名文件重复下载直接覆盖，避免第二次报 DestinationAlreadyExists
  const file = await File.downloadFileAsync(opts.url, target, {
    headers: { ...(await authHeader()), ...(opts.headers ?? {}) },
    idempotent: true,
  });
  return file;
}

async function shareFile(file: File, mimeType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new ShareUnavailableError(file.uri);
  }
  await Sharing.shareAsync(file.uri, mimeType ? { mimeType, dialogTitle: file.name } : undefined);
}

/* ------------------------------------------------------------------ 对外入口 */

/** 下载并分享沙箱产物（助手生成的文件）。 */
export async function saveSandboxArtifact(
  path: string,
  opts?: { agent_id?: string }
): Promise<string> {
  const url = sandboxFileDownloadURL(path, opts);
  const file = await downloadToCache({ url, filename: previewTitleFromPath(path) });
  await shareFile(file);
  return file.uri;
}

/** 下载并分享一条消息的附件。 */
export async function saveAttachment(att: {
  url?: string;
  name?: string;
  mime?: string;
}): Promise<string> {
  if (!att.url) throw new Error("附件缺少下载地址");
  const url = absolutizeApiUrl(att.url.split(/[?#]/)[0] || att.url);
  const file = await downloadToCache({ url, filename: att.name || "attachment" });
  await shareFile(file, att.mime);
  return file.uri;
}

/** 导出技能包 zip。 */
export async function exportSkillPackage(name: string): Promise<string> {
  const url = absolutizeApiUrl(`/v1/skills/${encodeURIComponent(name)}/export`);
  const file = await downloadToCache({ url, filename: `${name}.zip` });
  await shareFile(file, "application/zip");
  return file.uri;
}

/** 把内存里的文本落成文件并分享（图表源码、复制不下来的长文本等）。 */
export async function saveTextFile(
  filename: string,
  text: string,
  mime = "text/plain;charset=utf-8"
): Promise<string> {
  const file = new File(downloadDir(), safeFileName(filename));
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  file.write(text);
  await shareFile(file, mime);
  return file.uri;
}

/** 图片附件另存：给分享面板一个明确的 MIME，系统才会进「存储图片」而不是当文本。 */
export async function saveImageAttachment(att: {
  url?: string;
  name?: string;
  mime?: string;
}): Promise<string> {
  return saveAttachment(att);
}
