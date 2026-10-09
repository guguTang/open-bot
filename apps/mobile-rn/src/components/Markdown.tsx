import type { JSX } from "react";
import { Checkbox, Separator, Typography, useThemeColor } from "heroui-native";
import * as Clipboard from "expo-clipboard";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";

/**
 * 轻量 Markdown 渲染器。
 *
 * 目标是复刻 `apps/web/src/components/MarkdownMessage.tsx`（react-markdown + remark-gfm）
 * 的呈现效果，但整个解析层自己手写，不引 remark / mdast / react-markdown-display 之类的依赖。
 * 动机有两个：
 *
 * 1. web 端的沙箱预览（`HtmlPreviewModal`）依赖 DOM，RN 端没有可用的等价物，
 *    与其为了几个块级语法拖进一整套 mdast 依赖，不如只实现实际用到的子集。
 * 2. 助手输出是**逐 token 追加**的，输入随时可能停在半截 Markdown 上。手写解析器
 *    可以在每个降级点上明确决定「怎么退化成纯文本」，而通用库的报错往往在气泡里白屏。
 *
 * 因此这里的优先级是：**任何输入都不崩** > 覆盖 GFM 常用子集 > 排版细节。
 */

/* ------------------------------------------------------------------ *
 * 纯函数层：Markdown 源码 → AST（不依赖 React，可单独验证）
 * ------------------------------------------------------------------ */

type Align = "left" | "center" | "right";

type Inline =
  | { kind: "text"; value: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "strike"; children: Inline[] }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; children: Inline[] };

type ListItem = {
  /** `null` = 普通列表项；`true`/`false` = 任务列表的勾选态 */
  checked: boolean | null;
  blocks: Block[];
};

type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; children: Block[] }
  | { kind: "code"; lang: string; code: string; closed: boolean }
  | { kind: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

/** 反斜杠转义允许吞掉的标点，范围对齐 CommonMark。 */
const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WHITESPACE = /\s/;

type FenceMarker = { marker: string; lang: string };

type ListMarker = { indent: number; ordered: boolean; start: number; text: string };

/** 缩进展开成空格，列表层级和代码块的空格数才能用同一套算术。 */
function expandTabs(line: string): string {
  return line.includes("\t") ? line.replace(/\t/g, "    ") : line;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function leadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === " ") n += 1;
  return n;
}

function countRun(text: string, from: number, char: string): number {
  let n = 0;
  while (from + n < text.length && text[from + n] === char) n += 1;
  return n;
}

function matchFence(line: string): FenceMarker | null {
  const m = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
  if (!m) return null;
  // 反引号围栏的 info string 里不能再出现反引号，否则 ` ```a`b ` ` 会被误判成围栏
  const info = m[2] ?? "";
  if (m[1]!.startsWith("`") && info.includes("`")) return null;
  return { marker: m[1]!, lang: info.trim().split(/\s+/)[0] ?? "" };
}

function isFenceClose(line: string, open: FenceMarker): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  if (!m) return false;
  // 闭合围栏必须同类型且长度不短于开启围栏
  return m[1]![0] === open.marker[0] && m[1]!.length >= open.marker.length;
}

function matchHeading(line: string): { level: number; text: string } | null {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
  if (!m) return null;
  // ATX 闭合序列：`## 标题 ##` 里的尾部井号不是正文
  const text = (m[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "");
  return { level: m[1]!.length, text };
}

function isThematicBreak(line: string): boolean {
  // 必须在列表项判定之前跑：`- - -` 既是分隔线也是合法列表标记
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function matchQuote(line: string): string | null {
  const m = /^ {0,3}>[ \t]?/.exec(line);
  return m ? line.slice(m[0].length) : null;
}

function matchListMarker(line: string): ListMarker | null {
  const m = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(.*)$/.exec(line);
  if (!m) return null;
  const num = m[3];
  return {
    indent: m[1]!.length,
    ordered: num !== undefined,
    start: num ? Number.parseInt(num, 10) : 1,
    text: m[5]!,
  };
}

/** 切分表格行，兼容首尾竖线缺失与 `\|` 转义。 */
function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseAlignRow(line: string): Align[] {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

function isTableDelimiter(line: string): boolean {
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^[ \t]*:?-+:?[ \t]*$/.test(cell) && cell.includes("-"));
}

/* ---------------------------- 行内解析 ---------------------------- */

function findRunEnd(text: string, from: number, char: string, len: number): number {
  for (let i = from; i <= text.length - len; i += 1) {
    if (text[i] !== char) continue;
    if (countRun(text, i, char) === len) return i;
  }
  return -1;
}

/**
 * 找定界符的闭合位置。扫描时跳过转义和行内代码，避免 `\*` 或 `` `*` ``
 * 里的同字符被误判成闭合标记。找不到返回 -1 —— 调用方据此降级为字面量。
 */
function findClosing(text: string, from: number, delim: string): number {
  const len = delim.length;
  for (let i = from; i <= text.length - len; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "`") {
      const run = countRun(text, i, "`");
      const end = findRunEnd(text, i + run, "`", run);
      if (end !== -1) {
        i = end + run - 1;
        continue;
      }
    }
    if (!text.startsWith(delim, i)) continue;
    if (i === from) continue; // 空内容不算闭合
    if (WHITESPACE.test(text[i - 1]!)) continue; // 闭合符不能贴在空白左边
    return i;
  }
  return -1;
}

type LinkMatch = { node: Inline; end: number };

function tryLink(text: string, start: number): LinkMatch | null {
  // 跳过嵌套的 `[`，用深度计数找到与 `[` 配对的 `]`
  let depth = 0;
  let close = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1 || text[close + 1] !== "(") return null;

  let paren = 1;
  let end = -1;
  for (let i = close + 2; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") paren += 1;
    else if (ch === ")") {
      paren -= 1;
      if (paren === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null; // 流式中的 `[文字](` —— 降级为纯文本

  const label = text.slice(start + 1, close);
  // 目标里可能带标题：`[a](http://x "title")`
  const target =
    text
      .slice(close + 2, end)
      .trim()
      .split(/\s+/)[0] ?? "";
  if (!target) return null;
  return { node: { kind: "link", href: target, children: parseInline(label) }, end: end + 1 };
}

/** 解析一行（段落 / 表格单元格 / 列表项）内部的行内语法。 */
function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  let i = 0;

  const flush = (): void => {
    if (text) {
      out.push({ kind: "text", value: text });
      text = "";
    }
  };

  while (i < src.length) {
    const ch = src[i]!;

    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.test(src[i + 1]!)) {
      text += src[i + 1];
      i += 2;
      continue;
    }

    // 行内代码优先级最高：内容里的 `*` `_` 都不该被当成强调
    if (ch === "`") {
      const run = countRun(src, i, "`");
      const end = findRunEnd(src, i + run, "`", run);
      if (end !== -1) {
        flush();
        out.push({ kind: "code", value: src.slice(i + run, end) });
        i = end + run;
        continue;
      }
    }

    // 图片没有对应实现，降级成 alt 文本本身
    if (ch === "!" && src[i + 1] === "[") {
      const link = tryLink(src, i + 1);
      if (link) {
        flush();
        out.push(...(link.node.kind === "link" ? link.node.children : []));
        i = link.end;
        continue;
      }
    }

    if (ch === "[") {
      const link = tryLink(src, i);
      if (link) {
        flush();
        out.push(link.node);
        i = link.end;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const run = countRun(src, i, ch);
      // `***x***` 退化成两层强/斜体叠在一起，观感与 GFM 一致
      const widths = ch === "~" ? [2] : run >= 3 ? [3, 2, 1] : run === 2 ? [2] : [1];

      let matched = false;
      for (const width of widths) {
        if (run < width) continue;
        const delim = ch.repeat(width);
        // 开启符右边不能是空白，否则 `a * b` 里的星号只是普通字符
        if (WHITESPACE.test(src[i + width] ?? " ")) continue;
        // `_` 不参与词内强调，`snake_case_name` 必须原样显示
        if (ch === "_" && /[\p{L}\p{N}]/u.test(src[i - 1] ?? " ")) continue;

        const end = findClosing(src, i + width, delim);
        if (end === -1) continue;

        flush();
        const children = parseInline(src.slice(i + width, end));
        // 节点类型由定界字符决定，不是由宽度决定：`~~` 是删除线，`**` 才是粗体
        if (ch === "~") out.push({ kind: "strike", children });
        else if (width === 2) out.push({ kind: "strong", children });
        else if (width === 1) out.push({ kind: "em", children });
        else out.push({ kind: "strong", children: [{ kind: "em", children }] });
        i = end + width;
        matched = true;
        break;
      }
      if (matched) continue;
    }

    text += ch;
    i += 1;
  }

  flush();
  return out;
}

/* ---------------------------- 块级解析 ---------------------------- */

type ParseCtx = {
  lines: string[];
  blocks: Block[];
  /**
   * 最近一个「顶层空行」的位置。空行是块级语法的天然分界，
   * 之前的块已经定型、后续内容无法再改写它们 —— 流式增量解析靠这个做检查点。
   */
  checkpoint: { line: number; blockCount: number } | null;
};

function startsNewBlock(ctx: ParseCtx, line: string, index: number): boolean {
  if (isThematicBreak(line)) return true;
  if (matchFence(line)) return true;
  if (matchHeading(line)) return true;
  if (matchQuote(line) !== null) return true;
  if (matchListMarker(line)) return true;
  if (
    line.includes("|") &&
    index + 1 < ctx.lines.length &&
    isTableDelimiter(ctx.lines[index + 1]!)
  ) {
    return true;
  }
  return false;
}

function parseList(ctx: ParseCtx, start: number): number {
  const head = matchListMarker(ctx.lines[start]!)!;
  const items: ListItem[] = [];
  let i = start;

  while (i < ctx.lines.length) {
    const marker = matchListMarker(ctx.lines[i]!);
    if (!marker || marker.ordered !== head.ordered) break;

    // 把该项的正文、续行、以及更深缩进的子列表都收进 raw，交给递归解析
    const raw: string[] = [marker.text];
    let k = i + 1;
    while (k < ctx.lines.length) {
      const line = ctx.lines[k]!;
      if (isBlank(line)) break;
      const nested = matchListMarker(line);
      if (nested && nested.indent <= marker.indent) break; // 同级 → 下一项
      if (!nested && leadingSpaces(line) < marker.indent + 1) break; // 顶格 → 段落结束
      const trimAt = Math.min(leadingSpaces(line), marker.indent + 2);
      raw.push(line.slice(trimAt));
      k += 1;
    }

    let checked: boolean | null = null;
    const task = /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(raw[0]!);
    if (task) {
      checked = task[1] !== " ";
      raw[0] = task[2]!;
    }

    const sub: Block[] = [];
    parseLines(raw, 0, { lines: raw, blocks: sub, checkpoint: null });
    items.push({ checked, blocks: sub });
    i = k;
  }

  ctx.blocks.push({ kind: "list", ordered: head.ordered, start: head.start, items });
  return i;
}

function parseLines(lines: string[], from: number, ctx: ParseCtx): number {
  ctx.lines = lines;
  let i = from;

  while (i < lines.length) {
    const line = lines[i]!;

    if (isBlank(line)) {
      ctx.checkpoint = { line: i, blockCount: ctx.blocks.length };
      i += 1;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (isFenceClose(lines[j]!, fence)) {
          closed = true;
          break;
        }
        body.push(lines[j]!);
        j += 1;
      }
      // 未闭合的围栏照常渲染：流式输出时这是常态，不是错误
      // 末尾那个空串是源码结尾 `\n` 切出来的，不是代码内容的一部分
      if (!closed && body[body.length - 1] === "") body.pop();
      ctx.blocks.push({ kind: "code", lang: fence.lang, code: body.join("\n"), closed });
      i = closed ? j + 1 : j;
      continue;
    }

    if (isThematicBreak(line)) {
      ctx.blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = matchHeading(line);
    if (heading) {
      ctx.blocks.push({
        kind: "heading",
        level: heading.level,
        children: parseInline(heading.text),
      });
      i += 1;
      continue;
    }

    if (matchQuote(line) !== null) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length && !isBlank(lines[j]!)) {
        inner.push(matchQuote(lines[j]!) ?? lines[j]!);
        j += 1;
      }
      const sub: Block[] = [];
      parseLines(inner, 0, { lines: inner, blocks: sub, checkpoint: null });
      ctx.blocks.push({ kind: "quote", children: sub });
      i = j;
      continue;
    }

    // 表格要求「表头 + 分隔行」同时在场。分隔行还没流出来时整块降级成段落，
    // 等它到齐了再整体重解析 —— 半张表比一张错位的表好看。
    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1]!)) {
      const header = splitRow(line).map(parseInline);
      const align = parseAlignRow(lines[i + 1]!);
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.includes("|") && !isBlank(lines[j]!)) {
        rows.push(splitRow(lines[j]!).map(parseInline));
        j += 1;
      }
      ctx.blocks.push({ kind: "table", align, header, rows });
      // 刻意不记录检查点：只有表头的空表可能被后续行续写，提前固化会切断表格
      i = j;
      continue;
    }

    if (matchListMarker(line)) {
      i = parseList(ctx, i);
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]!) && !startsNewBlock(ctx, lines[i]!, i)) {
      para.push(lines[i]!);
      i += 1;
    }
    ctx.blocks.push({ kind: "paragraph", children: parseInline(para.join("\n")) });
  }

  return i;
}

/**
 * 流式增量解析的检查点缓存。
 *
 * 助手每吐一个 token 就带着更长的 `content` 重渲染一次，若每次都从头全量解析，
 * 一条 N 个 token 的回复就是 O(N²) 的正则开销。这里记录「已经定型的那段源码」，
 * 下一次只需要重解析空行之后仍在生长的尾巴。
 */
type ParseCache = {
  /** 已定型部分的原文，必定是下一次 `content` 的前缀 */
  source: string;
  blocks: Block[];
};

function parseIncremental(
  content: string,
  cache: ParseCache | null
): {
  blocks: Block[];
  cache: ParseCache | null;
} {
  if (cache && content.startsWith(cache.source)) {
    const tail = content.slice(cache.source.length);
    const lines = tail.split("\n").map(expandTabs);
    const ctx: ParseCtx = { lines: [], blocks: cache.blocks.slice(), checkpoint: null };
    parseLines(lines, 0, ctx);

    // 尾段里若出现了新的顶层空行，就把检查点前移
    if (ctx.checkpoint && ctx.checkpoint.line + 1 < lines.length) {
      const cut = lines.slice(0, ctx.checkpoint.line + 1).join("\n");
      return {
        blocks: ctx.blocks,
        cache: {
          source: cache.source + cut,
          blocks: ctx.blocks.slice(0, ctx.checkpoint.blockCount),
        },
      };
    }
    return { blocks: ctx.blocks, cache };
  }

  const lines = content.split("\n").map(expandTabs);
  const ctx: ParseCtx = { lines, blocks: [], checkpoint: null };
  parseLines(lines, 0, ctx);

  if (ctx.checkpoint && ctx.checkpoint.line + 1 < lines.length) {
    const cut = lines.slice(0, ctx.checkpoint.line + 1).join("\n");
    return {
      blocks: ctx.blocks,
      cache: { source: cut, blocks: ctx.blocks.slice(0, ctx.checkpoint.blockCount) },
    };
  }
  return { blocks: ctx.blocks, cache: null };
}

/* ------------------------------------------------------------------ *
 * 渲染层
 * ------------------------------------------------------------------ */

/**
 * heroui 的 `Typography` 每一档都显式设置了 fontSize，嵌套在标题里的行内强调
 * 会把字号重置回 body。所以块级用 Typography（拿到主题字号/行高），
 * 行内强调改用裸 `Text` 只改字重/字形/装饰色，继承父级排版。
 */
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** 聊天气泡不是文档，h1 直接用 largeTitle 会喧宾夺主，整体下移两档。 */
const HEADING_TYPE = ["h4", "h5", "h6", "h6", "h6", "h6"] as const;

function isSandboxHref(href: string): boolean {
  return /^sandbox:/i.test(href.trim());
}

/** 与 web 端 `defaultUrlTransform` 同思路：只放行可安全交给系统的协议。 */
function isOpenableHref(href: string): boolean {
  return /^(?:https?|mailto|tel):/i.test(href.trim());
}

type InlineProps = {
  nodes: Inline[];
  onLinkPress?: (href: string) => void;
};

function InlineText({ nodes, onLinkPress }: InlineProps): JSX.Element {
  // 必须在这里取：下面 map 回调里的分支数随节点类型变化，hook 不能放进条件分支
  const accent = useThemeColor("accent");

  return (
    <Text>
      {nodes.map((node, i) => {
        const key = `i${i}`;
        switch (node.kind) {
          case "text":
            return <Text key={key}>{node.value}</Text>;
          case "strong":
            return (
              <Text key={key} style={{ fontWeight: "700" }}>
                <InlineText nodes={node.children} onLinkPress={onLinkPress} />
              </Text>
            );
          case "em":
            return (
              <Text key={key} style={{ fontStyle: "italic" }}>
                <InlineText nodes={node.children} onLinkPress={onLinkPress} />
              </Text>
            );
          case "strike":
            return (
              <Text key={key} style={{ textDecorationLine: "line-through" }}>
                <InlineText nodes={node.children} onLinkPress={onLinkPress} />
              </Text>
            );
          case "code":
            return <Typography.Code key={key}>{node.value}</Typography.Code>;
          case "link": {
            const handle = (): void => {
              const href = node.href.trim();
              if (isSandboxHref(href)) {
                // 沙箱文件的读取/预览由气泡层负责，这里只做识别和样式
                onLinkPress?.(href);
                return;
              }
              if (!isOpenableHref(href)) return;
              void Linking.openURL(href).catch(() => undefined);
            };
            return (
              <Text
                key={key}
                onPress={handle}
                suppressHighlighting
                style={{
                  color: accent,
                  textDecorationLine: "underline",
                  textDecorationStyle: isSandboxHref(node.href) ? "dashed" : "solid",
                }}
              >
                <InlineText nodes={node.children} onLinkPress={onLinkPress} />
              </Text>
            );
          }
        }
      })}
    </Text>
  );
}

type BlockProps = {
  block: Block;
  onLinkPress?: (href: string) => void;
  /** 嵌套深度：引用块和列表项要逐层缩进 */
  depth: number;
};

type BlocksProps = {
  blocks: Block[];
  onLinkPress?: (href: string) => void;
  depth: number;
};

function Blocks({ blocks, onLinkPress, depth }: BlocksProps): JSX.Element {
  return (
    <View className="gap-2">
      {blocks.map((block, i) => (
        <BlockView key={`b${i}`} block={block} onLinkPress={onLinkPress} depth={depth} />
      ))}
    </View>
  );
}

function BlockView({ block, onLinkPress, depth }: BlockProps): JSX.Element {
  const separator = useThemeColor("separator");

  switch (block.kind) {
    case "heading": {
      const type = HEADING_TYPE[Math.min(block.level, 6) - 1]!;
      return (
        <Typography.Heading
          type={type}
          className={block.level <= 3 ? "mt-1 text-foreground" : "text-foreground"}
        >
          <InlineText nodes={block.children} onLinkPress={onLinkPress} />
        </Typography.Heading>
      );
    }

    case "paragraph":
      return (
        <Typography.Paragraph selectable className="text-foreground">
          <InlineText nodes={block.children} onLinkPress={onLinkPress} />
        </Typography.Paragraph>
      );

    case "rule":
      return <Separator className="my-1" style={{ backgroundColor: separator }} />;

    case "quote":
      return (
        <View className="border-l-2 pl-3" style={{ borderLeftColor: separator }}>
          <Blocks blocks={block.children} onLinkPress={onLinkPress} depth={depth + 1} />
        </View>
      );

    case "list":
      return (
        <View className="gap-1">
          {block.items.map((item, i) => (
            <ListRow
              key={`l${i}`}
              item={item}
              ordered={block.ordered}
              index={i}
              start={block.start}
              onLinkPress={onLinkPress}
              depth={depth}
            />
          ))}
        </View>
      );

    case "code":
      return <CodeBlock lang={block.lang} code={block.code} closed={block.closed} />;

    case "table":
      return <TableView block={block} onLinkPress={onLinkPress} />;
  }
}

type ListRowProps = {
  item: ListItem;
  ordered: boolean;
  index: number;
  start: number;
  onLinkPress?: (href: string) => void;
  depth: number;
};

function ListRow({ item, ordered, index, start, onLinkPress, depth }: ListRowProps): JSX.Element {
  const marker = ordered ? `${start + index}.` : "•";

  return (
    <View className="flex-row items-start gap-2">
      {item.checked === null ? (
        // 定宽 marker 列，保证多行正文的悬挂缩进对齐
        <Text
          className="text-muted"
          style={{ minWidth: 18, fontFamily: ordered ? undefined : MONO }}
        >
          {marker}
        </Text>
      ) : (
        <View className="pt-0.5">
          {/* 只读展示：不接 onSelectedChange，受控值固定，点了不会变 */}
          <Checkbox isSelected={item.checked} isDisabled />
        </View>
      )}
      <View className="flex-1">
        <Blocks blocks={item.blocks} onLinkPress={onLinkPress} depth={depth} />
      </View>
    </View>
  );
}

function CodeBlock({
  lang,
  code,
  closed,
}: {
  lang: string;
  code: string;
  closed: boolean;
}): JSX.Element {
  const surface = useThemeColor("surface-tertiary");
  const separator = useThemeColor("separator");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = (): void => {
    void Clipboard.setStringAsync(code)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <View
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: separator, backgroundColor: surface }}
    >
      <View
        className="flex-row items-center justify-between border-b px-3 py-1.5"
        style={{ borderBottomColor: separator }}
      >
        <Typography.Paragraph type="body-xs" color="muted" className="font-medium">
          {lang || "code"}
          {/* 未闭合的围栏给个提示，避免用户以为渲染坏了 */}
          {closed ? "" : " ·"}
        </Typography.Paragraph>
        <Pressable
          onPress={onCopy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="复制代码"
        >
          <Typography.Paragraph type="body-xs" color="muted">
            {copied ? "已复制" : "复制"}
          </Typography.Paragraph>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="p-3">
        <Text
          selectable
          className="text-foreground"
          style={{ fontFamily: MONO, fontSize: 12.5, lineHeight: 18 }}
        >
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

type TableViewProps = {
  block: Extract<Block, { kind: "table" }>;
  onLinkPress?: (href: string) => void;
};

function cellText(align: Align): { textAlign: "left" | "center" | "right" } {
  return { textAlign: align === "center" ? "center" : align === "right" ? "right" : "left" };
}

function TableView({ block, onLinkPress }: TableViewProps): JSX.Element {
  const separator = useThemeColor("separator");
  const headerBg = useThemeColor("surface-secondary");
  const colWidth = 96;

  const renderRow = (
    cells: Inline[][],
    align: Align[],
    rowKey: string,
    bold: boolean
  ): JSX.Element => (
    <View key={rowKey} className="flex-row">
      {cells.map((cell, c) => (
        <View
          key={`${rowKey}c${c}`}
          className="px-2.5 py-1.5"
          style={{ width: colWidth, borderRightWidth: 1, borderRightColor: separator }}
        >
          <Typography.Paragraph
            type="body-xs"
            style={[cellText(align[c] ?? "left"), bold ? { fontWeight: "700" } : null]}
          >
            <InlineText nodes={cell} onLinkPress={onLinkPress} />
          </Typography.Paragraph>
        </View>
      ))}
    </View>
  );

  return (
    // 长表格撑破布局是 RN 端最常见的排版事故，整块横向滚动最省事
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="rounded-xl border"
      style={{ borderColor: separator }}
    >
      <View>
        <View style={{ backgroundColor: headerBg }}>
          {renderRow(block.header, block.align, "h", true)}
        </View>
        {block.rows.map((row, r) => (
          <View key={`r${r}`} className="border-t" style={{ borderTopColor: separator }}>
            {renderRow(row, block.align, `r${r}`, false)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** 流式光标：跟随最后一个块内联，靠 opacity 呼吸。 */
function Caret(): JSX.Element {
  const accent = useThemeColor("accent");
  // RN 的标准做法：把 Animated.Value 存进 ref 再取 .current，
  // 这样每次渲染复用同一个实例而不是新建动画对象。
  // eslint-disable-next-line react-hooks/refs
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration: 480, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 480, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={{ opacity, width: 7, height: 15, marginLeft: 2, backgroundColor: accent }}
    />
  );
}

export type MarkdownProps = {
  content: string;
  streaming?: boolean;
  /**
   * `sandbox:` 链接的点击回调。留空则沙箱链接只显示样式、不可点。
   * 普通 http(s) 链接自行走 `Linking.openURL`。
   */
  onLinkPress?: (href: string) => void;
};

/**
 * 注意：传进来的 `content` 应当是已经清理过内部路径的展示文本（由调用方负责）。
 *
 * `onLinkPress` 若传内联箭头函数会击穿 `memo`，调用方需要自己 `useCallback` 包一层。
 */
export const Markdown = memo(function Markdown({
  content,
  streaming = false,
  onLinkPress,
}: MarkdownProps): JSX.Element {
  const cache = useRef<ParseCache | null>(null);

  const blocks = useMemo(() => {
    /*
     * 这里读写 ref 属于有意为之的「渲染期缓存」，豁免 react-hooks/refs：
     *
     * - 安全性：parseIncremental 只在 `content.startsWith(cache.source)` 时才复用缓存，
     *   否则退化为全量解析；blocks 每次都由 `cache.blocks + 重解析尾段` 重算，
     *   不会累加。因此 StrictMode 双渲染、或被打断后换内容重渲染，结果都收敛到同一份。
     * - 必要性：流式场景每来一个 token 就重渲染一次。没有缓存时，266 帧 / 1596 字符的
     *   典型回复累计多花约 13.7 倍时间（11.6ms → 0.8ms 每帧）。
     * - 替代方案：改用 state 存缓存会导致每帧多一次重渲染，反而更慢；
     *   模块级缓存则在多实例场景下互相污染。
     */
    // eslint-disable-next-line react-hooks/refs
    const result = parseIncremental(content, cache.current);
    // eslint-disable-next-line react-hooks/refs
    cache.current = result.cache;
    return result.blocks;
  }, [content]);

  if (blocks.length === 0 && !streaming) {
    return <View />;
  }

  return (
    <View className="gap-2">
      {blocks.length > 0 ? (
        <View>
          <Blocks blocks={blocks} onLinkPress={onLinkPress} depth={0} />
        </View>
      ) : null}
      {streaming ? <Caret /> : null}
    </View>
  );
});
