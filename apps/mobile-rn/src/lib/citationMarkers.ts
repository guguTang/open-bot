/**
 * 对齐 `apps/web/src/lib/citationMarkers.ts`：
 * 为检索来源注入 [n] 标记并转成可点的 markdown 链接。
 */

import type { MessageSource } from "@/api/types";
import { normalizeMessageSources } from "@/lib/messageBody";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isAsciiAlphaNum(ch: string): boolean {
  return /^[a-zA-Z0-9]$/.test(ch);
}

function maskCodeSpans(text: string): string {
  let out = text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
  out = out.replace(/`[^`]+`/g, (m) => " ".repeat(m.length));
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureCitationMarkers(
  content: string,
  sources: MessageSource[] | null | undefined
): string {
  const list = normalizeMessageSources(sources);
  if (!content.trim() || list.length === 0) return content;
  let text = content;
  const existing = new Set(
    [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => n > 0)
  );
  for (let i = 0; i < list.length; i++) {
    const n = i + 1;
    if (existing.has(n)) continue;
    const marker = `[${n}]`;
    if (text.includes(marker)) continue;
    const host = hostOf(list[i].url);
    const title = (list[i].title || "").trim();
    const masked = maskCodeSpans(text);
    let insertAt = -1;
    if (host) {
      const hostCandidates = [host];
      const parts = host.split(".");
      if (parts.length >= 2) {
        const parent = parts.slice(-2).join(".");
        if (parent !== host) hostCandidates.push(parent);
      }
      for (const hc of hostCandidates) {
        const hostRe = new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${escapeRegExp(hc)}\\b`, "i");
        const m = hostRe.exec(masked);
        if (m && m.index != null) {
          insertAt = m.index + m[0].length;
          break;
        }
      }
      if (insertAt < 0) {
        const label = host.split(".")[0] || "";
        if (label.length >= 5 && /^[a-z0-9]+$/i.test(label)) {
          const ml = masked.toLowerCase();
          const ll = label.toLowerCase();
          for (let j = 0; j + ll.length <= ml.length; j++) {
            if (ml.slice(j, j + ll.length) !== ll) continue;
            const leftOK = j === 0 || !isAsciiAlphaNum(masked[j - 1]!);
            const rightOK =
              j + ll.length === masked.length || !isAsciiAlphaNum(masked[j + ll.length]!);
            if (leftOK && rightOK) {
              insertAt = j + label.length;
              break;
            }
          }
        }
      }
    }
    if (insertAt < 0 && title.length >= 6) {
      const idx = masked.toLowerCase().indexOf(title.toLowerCase());
      if (idx >= 0) insertAt = idx + title.length;
    }
    if (insertAt < 0 || insertAt > text.length) continue;
    const after = text.slice(insertAt).replace(/^[ \t]+/, "");
    if (after.startsWith("[")) continue;
    text = text.slice(0, insertAt) + marker + text.slice(insertAt);
    existing.add(n);
  }
  return text;
}

export function linkifyCitationMarkers(
  content: string,
  _messageId: string,
  sources: MessageSource[] | null | undefined
): string {
  void _messageId;
  const list = normalizeMessageSources(sources);
  if (!content || list.length === 0) return content;
  const masked = maskCodeSpans(content);
  return content.replace(/\[(\d+)\]/g, (full, num, offset) => {
    if (masked.slice(offset, offset + full.length).trim() === "") return full;
    if (
      offset > 0 &&
      content[offset - 1] === "[" &&
      content.slice(offset + full.length).startsWith("](")
    ) {
      return full;
    }
    const n = Number(num);
    if (!Number.isFinite(n) || n < 1 || n > list.length) return full;
    const url = (list[n - 1]?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return full;
    const href = url.replace(/[()]/g, (ch) => encodeURIComponent(ch));
    return `[[${n}]](${href})`;
  });
}

export function prepareCitedMarkdown(
  content: string,
  messageId: string,
  sources: MessageSource[] | null | undefined
): string {
  const withMarkers = ensureCitationMarkers(content, sources);
  return linkifyCitationMarkers(withMarkers, messageId, sources);
}
