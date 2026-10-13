/**
 * Assistant MessageBody — raw content + sources + streaming → 可渲染分段。
 *
 * Bubble 只负责画；分段 / 引用 / 产物抽取集中在此，流式 vs 终态规则同处。
 */

import type { MessageSource } from "@/api/types";
import { splitDiagrams, type ContentSegment } from "@/lib/chat";
import { prepareCitedMarkdown } from "@/lib/citationMarkers";
import { splitResultOriented, type Artifact } from "@/lib/workspace";

export type { ContentSegment, Artifact };

/** Domain normalize — lived in the HTTP barrel; callers import from here. */
export function normalizeMessageSources(raw: unknown): MessageSource[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MessageSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = String((item as MessageSource).url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const title = String((item as MessageSource).title || "")
      .trim()
      .slice(0, 200);
    out.push(title ? { url, title } : { url });
    if (out.length >= 20) break;
  }
  return out;
}

export type RenderSegment =
  | { kind: "text"; markdown: string }
  | { kind: "diagram"; lang: "mermaid" | "html"; source: string; pending: boolean };

export type AssistantBody = {
  display: string;
  artifacts: Artifact[];
  collapsedJson: string[];
  /** Streaming: single text pass, no diagrams/citations yet. */
  streamingMarkdown: string;
  /** Settled: text/diagram segments with citations applied. */
  segments: RenderSegment[];
  sources: MessageSource[];
};

export function buildAssistantBody(opts: {
  content: string;
  sources?: MessageSource[] | null;
  streaming?: boolean;
  messageId: string;
}): AssistantBody {
  const split = splitResultOriented(opts.content);
  const sources = normalizeMessageSources(opts.sources);
  const streamingMarkdown = split.display.trim();

  if (opts.streaming) {
    return {
      display: split.display,
      artifacts: split.artifacts,
      collapsedJson: split.collapsedJson,
      streamingMarkdown,
      segments: [],
      sources,
    };
  }

  const rawSegs = splitDiagrams(split.display);
  const segments: RenderSegment[] = [];
  for (const seg of rawSegs) {
    if (seg.kind === "diagram") {
      segments.push(seg);
      continue;
    }
    const raw = seg.text.trim();
    if (!raw) continue;
    segments.push({
      kind: "text",
      markdown: prepareCitedMarkdown(raw, opts.messageId, sources),
    });
  }

  return {
    display: split.display,
    artifacts: split.artifacts,
    collapsedJson: split.collapsedJson,
    streamingMarkdown,
    segments,
    sources,
  };
}
