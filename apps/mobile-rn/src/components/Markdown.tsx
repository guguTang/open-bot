/**
 * Markdown 渲染。
 *
 * ## 为什么换库
 *
 * 早期版本是自研解析器（937 行），README 里自己标着「增量解析缓存在渲染期
 * 读写，引入并发特性需重新评估」的技术债。2026 年社区已有成熟的原生方案：
 * `@ronradtke/react-native-markdown-display`（v9，周下载 5.6 万，维护活跃）——
 * markdown-it 解析 + AST + 真实 RN 组件渲染，不用 WebView。
 *
 * 换来的东西是原来手写不出来的：
 * - **`MarkdownStream`**：流式场景专用的包装。它会在解析前把未闭合的围栏
 *   **补齐**（`sealIncompleteMarkdown`），这正是自研版本最麻烦的地方 ——
 *   半截 ``` 围栏在流式过程中会反复改变布局，通用库靠补齐绕开，
 *   而我们当初是手写增量缓存硬扛的。
 * - **prism 语法高亮**：代码块自带，不需要自己维护语言到正则的映射。
 * - **代码块复制按钮**：`onCopyCode` 回调，库负责画按钮和 2 秒的「Copied!」反馈。
 *
 * ## 接口刻意保持不变
 *
 * 对外仍然只暴露 `MarkdownProps { content, streaming, onLinkPress }`，
 * MessageBubble 等调用方一行都不用改。样式主题化在这一层做，
 * 换库不该波及调用方。
 */

import MarkdownDisplay, {
  MarkdownStream,
  type MarkdownStyleMap,
} from "@ronradtke/react-native-markdown-display";
import * as Clipboard from "expo-clipboard";
import { useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { memo, useMemo } from "react";
import { Linking, useColorScheme, View } from "react-native";

import { API_BASE } from "@/api/config";

export type MarkdownProps = {
  content: string;
  streaming?: boolean;
  /**
   * `sandbox:` 链接的点击回调。留空则沙箱链接只显示样式、不可点。
   * 普通 http(s) / mailto 链接走 `Linking.openURL`。
   */
  onLinkPress?: (href: string) => void;
};

/**
 * 允许打开的协议白名单。
 *
 * 助手输出是**不受信任的输入**：正文里的链接如果直接丢给 `Linking.openURL`，
 * `javascript:`、`tel:`、自定义 scheme 全都会被系统接受，可能触发意料之外的
 * 跳转或深链。这里只放行明确的两种，其余一律吞掉。
 */
const SAFE_SCHEMES = new Set(["https:", "http:", "mailto:"]);

/**
 * 图片只允许来自自家 API 与 data URI。
 *
 * Markdown 正文里的图片 URL 是助手写出来的，可能指向任意第三方主机；
 * `Image` 直接去取就等于把用户的 IP 和设备指纹暴露出去。
 * 附件图片走的是相对路径（会被 `API_BASE` 补全），所以按前缀放行。
 */
const ALLOWED_IMAGE_HANDLERS = [
  "data:image/png;base64",
  "data:image/jpeg;base64",
  "data:image/gif;base64",
  "data:image/webp;base64",
  API_BASE,
];

export const Markdown = memo(function Markdown({
  content,
  streaming = false,
  onLinkPress,
}: MarkdownProps): JSX.Element {
  const scheme = useColorScheme();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const link = useThemeColor("link");
  const surface = useThemeColor("surface-tertiary");
  const separator = useThemeColor("separator");
  const border = useThemeColor("border");

  /**
   * 样式表随主题色走。`useMemo` 的依赖是这些 token 的字符串值 ——
   * 主题切换时它们变，样式表才重算；同一个主题下引用稳定，不会每帧新建对象。
   */
  const style = useMemo<MarkdownStyleMap>(
    () => ({
      body: { color: foreground },
      text: { color: foreground },
      paragraph: { color: foreground, marginTop: 4, marginBottom: 4 },
      heading1: { color: foreground, fontSize: 24, fontWeight: "700", marginTop: 12 },
      heading2: { color: foreground, fontSize: 20, fontWeight: "700", marginTop: 10 },
      heading3: { color: foreground, fontSize: 17, fontWeight: "600", marginTop: 8 },
      heading4: { color: foreground, fontSize: 15, fontWeight: "600", marginTop: 8 },
      heading5: { color: muted, fontSize: 14, fontWeight: "600" },
      heading6: { color: muted, fontSize: 13, fontWeight: "600" },
      strong: { color: foreground, fontWeight: "700" },
      blockquote: {
        color: muted,
        backgroundColor: "transparent",
        borderLeftWidth: 3,
        borderLeftColor: border,
        paddingLeft: 10,
      },
      hr: { backgroundColor: separator, height: 1, marginTop: 10, marginBottom: 10 },
      link: { color: link, textDecorationLine: "none" },
      blocklink: { color: link, textDecorationLine: "none" },
      bullet_list: { color: foreground },
      ordered_list: { color: foreground },
      list_item: { color: foreground },
      bullet_list_icon: { color: accent },
      ordered_list_icon: { color: accent },
      code_inline: {
        color: accent,
        backgroundColor: surface,
        borderRadius: 4,
        paddingHorizontal: 4,
        fontFamily: "Menlo",
      },
      fence: { backgroundColor: surface, borderColor: border },
      fence_code: { backgroundColor: surface, color: foreground, fontFamily: "Menlo" },
      fence_header: { backgroundColor: surface, borderBottomColor: border },
      fence_language_label: { color: muted, backgroundColor: "transparent" },
      fence_copy_button: { color: muted, backgroundColor: "transparent" },
      fence_copy_text: { color: muted },
      code_block: { backgroundColor: surface, borderColor: border },
      table: { borderColor: border, borderWidth: 1 },
      th: {
        color: foreground,
        backgroundColor: surface,
        borderColor: border,
        borderWidth: 1,
        padding: 6,
      },
      td: { color: foreground, borderColor: border, borderWidth: 1, padding: 6 },
    }),
    [accent, border, foreground, link, muted, separator, surface]
  );

  /** 返回 true 表示「我处理了」，库就不再走它自己的默认行为（默认是 openUrl）。 */
  const handleLinkPress = useMemo(() => {
    return (url: string): boolean => {
      const raw = (url || "").trim();
      if (!raw) return true;

      // 沙箱链接交给聊天页去读文件预览
      if (/^sandbox:/i.test(raw)) {
        onLinkPress?.(raw);
        return true;
      }

      let schemeOf: string;
      try {
        schemeOf = new URL(raw).protocol;
      } catch {
        // 相对路径或解析不了的，一律按「不处理」处理：宁可链接点不动，
        // 也不要因为一个畸形 URL 把异常抛进气泡渲染。
        return true;
      }
      if (!SAFE_SCHEMES.has(schemeOf)) return true;

      void Linking.openURL(raw);
      return true;
    };
  }, [onLinkPress]);

  const handleCopyCode = useMemo(
    () => (code: string) => {
      void Clipboard.setStringAsync(code);
    },
    []
  );

  const shared = {
    style,
    colorScheme: scheme === "dark" ? ("dark" as const) : ("light" as const),
    onLinkPress: handleLinkPress,
    onCopyCode: handleCopyCode,
    allowedImageHandlers: ALLOWED_IMAGE_HANDLERS,
    mergeStyle: true,
  } as const;

  if (!content) return <View />;

  return (
    <View className="gap-2">
      {streaming ? (
        // streaming 打开时库会补齐未闭合围栏并显示闪烁光标 —— 这正是
        // 自研版本要靠手写增量缓存解决的问题
        <MarkdownStream {...shared} streaming>
          {content}
        </MarkdownStream>
      ) : (
        <MarkdownDisplay {...shared}>{content}</MarkdownDisplay>
      )}
    </View>
  );
});
