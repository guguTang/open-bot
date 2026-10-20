/**
 * 把助手正文切成「Markdown 文本 / OpenUI 围栏」片段（纯函数，无 RN 依赖）。
 *
 * 与 lib/chat.ts 的 splitDiagrams 同一套围栏规则：行首 0-3 空格 + ≥3 个 ` 或 ~，
 * 闭合围栏用同一字符且不短于开围栏；没闭合 = pending（流式中）。
 */

export type OpenUiSplitSegment =
  { kind: "text"; text: string } | { kind: "openui"; source: string; pending: boolean };

const OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(openui-lang|openui)[ \t]*$/gim;

export function hasOpenUiFence(content: string): boolean {
  OPEN.lastIndex = 0;
  const hit = OPEN.test(content || "");
  OPEN.lastIndex = 0;
  return hit;
}

export function splitOpenUi(content: string): OpenUiSplitSegment[] {
  const text = content || "";
  if (!text) return [];
  const out: OpenUiSplitSegment[] = [];
  const open = new RegExp(OPEN.source, OPEN.flags);
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    const marker = m[1]!;
    const bodyStart = Math.min(text.length, m.index + m[0].length + 1);
    const close = new RegExp(
      `^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`,
      "m"
    );
    const rest = text.slice(bodyStart);
    const end = close.exec(rest);
    if (m.index > cursor) out.push({ kind: "text", text: text.slice(cursor, m.index) });
    out.push({
      kind: "openui",
      source: (end ? rest.slice(0, end.index) : rest).replace(/\n$/, ""),
      pending: !end,
    });
    cursor = end ? bodyStart + end.index + end[0].length : text.length;
    open.lastIndex = cursor;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}
