/**
 * `expo-mermaid` 的本地类型声明。
 *
 * ## 为什么需要它
 *
 * 这个包把 TypeScript **源码**直接当 `types` 入口发布（package.json 里
 * `"types": "src/index.ts"`），而其它 RN 生态库发的是编译好的 `.d.ts`。
 * 后果是 `tsc` 会去检查它内部的实现代码，而那些代码对 RN 0.86 / React 19 / TS 6
 * 并不兼容 —— 报出来的是 `Cannot find namespace 'JSX'`、SVG `Text` 的
 * `numberOfLines` 不存在、缺 `@types/dagre`、某些 renderer 读了自己类型上没有的
 * 字段，等等。`skipLibCheck` 救不了：它只跳过 `.d.ts`，而这里是 `.ts` 源码。
 *
 * 运行时是好的：Metro/Babel 转译 TS 源码没问题，图表确实能画出来。
 * 坏的只是类型检查。
 *
 * ## 这个声明覆盖什么
 *
 * 只覆盖本项目实际用到的公开 API（`MermaidChart` + 它的 props）。
 * 将来要用到新导出，在这里补；不要试图把它的内部类型复刻一遍 ——
 * 那些类型本身就是不兼容的根源。
 *
 * ## 什么时候可以删
 *
 * 上游改成发 `.d.ts`（或修好对新版 RN 的类型）之后，删掉本文件即可。
 * 跟踪：`expo-mermaid` 的 package.json `types` 字段。
 */
declare module "expo-mermaid" {
  import type { JSX } from "react";

  export type MermaidChartProps = {
    /** Mermaid 标记语言字符串 */
    chart: string;
    /** 渲染宽度（px），默认 320 */
    width?: number;
    /** 渲染高度（px），默认 300 */
    height?: number;
    /** 背景色，默认透明 */
    backgroundColor?: string;
    /** 配色主题；`auto` 跟随系统 Dark Mode */
    theme?: "light" | "dark" | "auto";
  };

  export function MermaidChart(props: MermaidChartProps): JSX.Element;
}
