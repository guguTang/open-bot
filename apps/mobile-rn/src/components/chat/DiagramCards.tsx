/**
 * 图表卡：Mermaid / HTML / 图片。
 *
 * 三类卡的渲染路径各不相同，选型依据写在各自组件里：
 * - **Mermaid**：`expo-mermaid`，纯 JS 解析 + `react-native-svg` 直绘。无 WebView、
 *   无第三方服务、离线可用。早期版本曾退化成「只给源码」和「发给 mermaid.ink 换图」，
 *   那是当时 RN 生态没有原生方案时的将就，现在没必要了。
 * - **HTML**：`react-native-webview`。HTML 产物本来就是网页，没有等价物，
 *   所以走 WebView；内容先过 `WebPreviewModal` 里的保守消毒。
 * - **图片**：RN 的 `Image` 直接渲染，鉴权走 query。
 *
 * 工具条折叠沿用 `DiagramCardFrame` 的思路（放不下就收进 ⋯），实现换成 RN 的
 * `onLayout` 量宽 + heroui `Menu`：RN 没有 ResizeObserver，也不该在布局阶段同步测量。
 */

import { Chip, Menu, Typography } from "heroui-native";
import * as Clipboard from "expo-clipboard";
import { MermaidChart } from "expo-mermaid";

import { useCallback, useEffect, useState, type JSX, type ReactNode } from "react";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";

import { attachmentCopyUrl, attachmentDisplayUrl, imageDownloadFilename } from "@/api";
import type { AttachmentMeta } from "@/api/types";
import { Icon } from "@/components/Icon";
import { WebPreviewModal } from "@/components/chat/WebPreviewModal";
import { saveAttachment, saveTextFile } from "@/lib/download";

type IconName = Parameters<typeof Icon>[0]["name"];

/** 工具条动作。收起状态下进 ⋯ 菜单，展示的是同一份定义。 */
export type DiagramAction = {
  key: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  onPress: () => void;
};

/* ------------------------------------------------------------------ *
 * 围栏识别
 * ------------------------------------------------------------------ */

/**
 * 从消息正文里取出一个围栏代码块。
 *
 * `pending` = 围栏还没闭合（流式输出中）。此时 HTML 预览与 Mermaid 导出都不该跑：
 * 半截源码渲出来的东西是错的，调用方拿到 pending 应该先按普通代码块显示。
 */
export function extractFence(
  content: string,
  lang: "mermaid" | "html"
): { source: string; pending: boolean } | null {
  const fence = new RegExp("^ {0,3}(`{3,}|~{3,})\\s*" + lang + "\\s*$", "im");
  const m = fence.exec(content || "");
  if (!m || m.index === undefined) return null;
  const marker = m[1]!;
  const rest = content.slice(m.index + m[0].length + 1);
  const close = new RegExp("^ {0,3}" + marker[0] + "{" + marker.length + ",}\\s*$", "m");
  const end = close.exec(rest);
  const body = end ? rest.slice(0, end.index) : rest;
  const source = body.replace(/\n$/, "");
  return { source, pending: !end };
}

/* ------------------------------------------------------------------ *
 * Mermaid
 * ------------------------------------------------------------------ */

/**
 * expo-mermaid 支持的图表类型关键字。
 *
 * 这个清单抄自 `expo-mermaid/src/components/MermaidChart.tsx` 的 `parseDiagram`
 * 分派分支 —— 遇到清单外的类型它会返回 `{type:"unknown"}`，那时画出来是空白。
 * 与其渲染一个空框，不如直接退回源码视图，让用户至少知道图长什么样。
 */
const MERMAID_TYPES = [
  "flowchart",
  "graph",
  "sequencediagram",
  "pie",
  "gantt",
  "classdiagram",
  "statediagram",
  "erdiagram",
  "xychart",
  "journey",
  "quadrantchart",
  "timeline",
  "mindmap",
  "gitgraph",
  "zenuml",
  "sankey",
  "requirementdiagram",
  "radar",
  "kanban",
  "block",
  "packet",
  "architecture",
  "treemap",
  "venn",
  "ishikawa",
  "fishbone",
  "treeview",
];

function mermaidTypeOf(source: string): string | null {
  const lines = (source || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("%%"));
  let first = lines[0]?.toLowerCase() ?? "";
  // `---` 开头是 frontmatter，真正的图从后文开始
  if (first === "---") {
    const end = lines.indexOf("---", 1);
    if (end >= 0) first = lines[end + 1]?.toLowerCase() ?? "";
  }
  const hit = MERMAID_TYPES.find((t) => first.startsWith(t));
  return hit ?? null;
}

/**
 * Mermaid 图表卡。
 *
 * 走 `expo-mermaid`：纯 JS 解析 + `react-native-svg` 直绘，**不引 WebView、
 * 不连第三方渲染服务、完全离线**。这替换掉了早期版本的两条退路 ——
 * 「只给源码」和「把源码发给 mermaid.ink 换一张图」。
 *
 * 保留「复制源码」是刻意的：解析器覆盖 25 种图表但语法变体有限
 * （`flowchart-elk`、部分 handDrawn 之类不在内），源码是永远可用的兜底。
 */
export function MermaidDiagramCard({
  source,
  pending,
}: {
  /** ```mermaid 围栏里的源码 */
  source: string;
  /** 流式输出中围栏未闭合 → 暂时不渲染，避免每来一个 token 重排一次 */
  pending?: boolean;
}): JSX.Element {
  const supported = mermaidTypeOf(source) !== null;
  const [expanded, setExpanded] = useState(false);

  const copySource = useCallback(() => {
    void Clipboard.setStringAsync(source);
  }, [source]);

  const actions: DiagramAction[] = [
    { key: "copy", label: "复制源码", icon: "copy-outline", onPress: copySource },
    {
      key: "expand",
      label: expanded ? "收起" : "全屏查看",
      icon: expanded ? "contract-outline" : "expand-outline",
      disabled: !supported || pending,
      onPress: () => setExpanded((v) => !v),
    },
  ];

  return (
    <DiagramFrame label="Mermaid" actions={actions}>
      {pending ? (
        <Typography.Paragraph className="text-[10px] text-muted">图表生成中…</Typography.Paragraph>
      ) : supported ? (
        <MermaidChart
          chart={source}
          width={expanded ? 720 : 320}
          height={expanded ? 520 : 240}
          theme="auto"
        />
      ) : (
        <>
          <Typography.Paragraph className="text-[10px] text-muted">
            这类图表移动端暂不支持渲染，可复制源码后在别处查看
          </Typography.Paragraph>
          <SourceBlock source={source || "（空）"} />
        </>
      )}
    </DiagramFrame>
  );
}

/** 工具条放不下 inline 动作时的折叠阈值。低于它就只留一个 ⋯。 */
const COLLAPSE_WIDTH = 240;

function DiagramFrame({
  label,
  extra,
  actions,
  children,
}: {
  label: string;
  /** 工具条上的附加内容（例如「预览 / 源码」切换） */
  extra?: ReactNode;
  actions: DiagramAction[];
  children: ReactNode;
}): JSX.Element {
  const [width, setWidth] = useState(0);
  const collapsed = width > 0 && width < COLLAPSE_WIDTH && actions.length > 1;

  return (
    <View
      className="gap-2 overflow-hidden rounded-2xl border border-border bg-background p-2.5"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <View className="flex-row items-center gap-1.5">
        <View className="rounded-md bg-surface-secondary px-1.5 py-0.5">
          <Typography.Paragraph className="text-[10px] text-muted">{label}</Typography.Paragraph>
        </View>
        {extra ? <View className="flex-row items-center">{extra}</View> : null}
        <View className="flex-1" />
        {collapsed ? (
          <Menu presentation="popover">
            <Menu.Trigger>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="更多操作"
                hitSlop={6}
                className="size-7 items-center justify-center rounded-md"
              >
                <Icon name="ellipsis-horizontal" size={16} tone="muted" />
              </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Overlay />
              <Menu.Content presentation="popover" placement="bottom" align="end" width={220}>
                {actions.map((a) => (
                  <Menu.Item key={a.key} isDisabled={a.disabled} onPress={a.onPress}>
                    <Menu.ItemTitle>{a.label}</Menu.ItemTitle>
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        ) : (
          <View className="flex-row items-center gap-0.5">
            {actions.map((a) => (
              <Pressable
                key={a.key}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                accessibilityState={{ disabled: Boolean(a.disabled) }}
                disabled={a.disabled}
                hitSlop={6}
                onPress={a.onPress}
                className="size-7 items-center justify-center rounded-md"
              >
                <Icon name={a.icon ?? "ellipsis-horizontal"} size={16} tone="muted" />
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {children}
    </View>
  );
}

/** 等宽源码块：纵向封顶 + 横向滚动，和 `Markdown.tsx` 里的代码块保持同一套观感。 */
function SourceBlock({ source, maxHeight }: { source: string; maxHeight?: string }): JSX.Element {
  return (
    <View className={`rounded-xl bg-surface-secondary px-2.5 py-2 ${maxHeight ?? "max-h-52"}`}>
      <ScrollView nestedScrollEnabled>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Typography.Paragraph
            selectable
            className="text-[11px]"
            style={{ fontFamily: "Menlo", lineHeight: 16 }}
          >
            {source}
          </Typography.Paragraph>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

export function HtmlDiagramCard({
  source,
  pending,
}: {
  /** ```html 围栏里的源码 */
  source: string;
  pending?: boolean;
}): JSX.Element {
  const [showSource, setShowSource] = useState(true);
  // 同 Mermaid：预览记住是哪份源码开的，源码一变自动失效，不用 effect 去重置
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const preview = previewSource !== null && previewSource === source && !pending;

  const actions: DiagramAction[] = [
    {
      key: "copy",
      label: "复制源码",
      icon: "copy-outline",
      onPress: () => {
        void Clipboard.setStringAsync(source);
      },
    },
    {
      key: "save",
      label: "导出源码文件",
      icon: "download-outline",
      disabled: pending || !source,
      onPress: () => {
        // 预览要靠 WebView，源码要能带走：落成 .html 交给系统分享面板，
        // 用户可以直接丢进浏览器打开。
        void saveTextFile("diagram.html", source, "text/html;charset=utf-8");
      },
    },
  ];

  return (
    <>
      <DiagramFrame
        label="HTML"
        extra={
          <Chip
            size="sm"
            variant={showSource ? "secondary" : "soft"}
            color={showSource ? "default" : "accent"}
            onPress={() => setShowSource((v) => !v)}
            accessibilityLabel={showSource ? "切到预览" : "切到源码"}
          >
            <Chip.Label>{showSource ? "源码" : "预览"}</Chip.Label>
          </Chip>
        }
        actions={actions}
      >
        {showSource ? (
          <SourceBlock source={source || "（空）"} maxHeight="max-h-40" />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开 HTML 预览"
            disabled={pending}
            onPress={() => setPreviewSource(source)}
            className="items-center justify-center gap-1 rounded-xl bg-surface-secondary py-5"
          >
            <Icon name="play-circle-outline" size={22} tone="accent" />
            <Typography.Paragraph className="text-[11px] text-accent">
              {pending ? "生成中…" : "点击打开预览"}
            </Typography.Paragraph>
          </Pressable>
        )}
      </DiagramFrame>

      <WebPreviewModal
        visible={preview}
        mode="html"
        html={source}
        title="HTML 预览"
        onClose={() => setPreviewSource(null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 图片
 * ------------------------------------------------------------------ */

export function ImageDiagramCard({
  attachment,
  alt,
}: {
  /** 图片附件；地址由组件自己换取（含鉴权 token），调用方只管把 meta 传进来 */
  attachment: AttachmentMeta;
  alt?: string;
}): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 附件 GET 要鉴权，地址是异步换来的（token 拼在 query 上，RN 的 Image 没法注入请求头）。
  // 取址结果带上发起时的 id：换了附件或点了重试就自然对不上，回落到「加载中」，
  // 不用在 effect 里同步 setState 去手动重置。
  const [retryKey, setRetryKey] = useState(0);
  const requestId = `${attachment.id}:${retryKey}`;
  const [fetched, setFetched] = useState<{
    id: string;
    url: string | null;
    status: "loading" | "error";
  }>({ id: "", url: null, status: "loading" });

  const displayUrl = fetched.id === requestId ? fetched.url : null;
  const status = fetched.id === requestId ? fetched.status : "loading";

  useEffect(() => {
    let alive = true;
    void attachmentDisplayUrl(attachment)
      .then((url) => {
        if (!alive) return;
        setFetched({ id: requestId, url, status: url ? "loading" : "error" });
      })
      .catch(() => {
        if (!alive) return;
        setFetched({ id: requestId, url: null, status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [attachment, requestId]);

  const [imgStatus, setImgStatus] = useState<"loading" | "ok" | "error">("loading");

  const retry = useCallback(() => {
    setError(null);
    setImgStatus("loading");
    setRetryKey((k) => k + 1);
  }, []);

  const copyUrl = attachmentCopyUrl(attachment);

  const copyLink = useCallback(() => {
    if (copyUrl) void Clipboard.setStringAsync(copyUrl);
  }, [copyUrl]);

  const download = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // 交给系统分享面板，用户可存到相册/文件。文件名走统一的命名规则，不带 token。
      await saveAttachment({
        url: attachment.url,
        name: imageDownloadFilename(attachment.name, attachment.mime),
        mime: attachment.mime,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败，请重试");
    } finally {
      setBusy(false);
    }
  }, [attachment.mime, attachment.name, attachment.url]);

  const actions: DiagramAction[] = [
    {
      key: "fullscreen",
      label: "全屏查看",
      icon: "expand-outline",
      onPress: () => setFullscreen(true),
    },
    { key: "copy", label: "复制地址", icon: "link-outline", disabled: !copyUrl, onPress: copyLink },
    {
      key: "download",
      label: "下载原图",
      icon: "download-outline",
      disabled: busy,
      onPress: () => void download(),
    },
  ];

  return (
    <>
      <DiagramFrame label="图片" actions={actions}>
        {!displayUrl ? (
          <View className="items-center gap-2 rounded-xl bg-surface-secondary py-6">
            <Icon name="image-outline" size={22} tone="muted" />
            <Typography.Paragraph className="text-[11px] text-muted">
              {status === "error" ? "图片地址不可用" : "正在取图片地址…"}
            </Typography.Paragraph>
            {status === "error" ? (
              <Chip size="sm" variant="secondary" color="default" onPress={retry}>
                <Chip.Label>重试</Chip.Label>
              </Chip>
            ) : null}
          </View>
        ) : imgStatus === "error" ? (
          <View className="items-center gap-2 rounded-xl bg-surface-secondary py-6">
            <Icon name="image-outline" size={22} tone="muted" />
            <Typography.Paragraph className="text-[11px] text-muted">
              图片加载失败
            </Typography.Paragraph>
            <Chip size="sm" variant="secondary" color="default" onPress={retry}>
              <Chip.Label>重试</Chip.Label>
            </Chip>
          </View>
        ) : (
          <Pressable
            accessibilityRole="imagebutton"
            accessibilityLabel={alt || attachment.name || "图片"}
            onPress={() => setFullscreen(true)}
            className="overflow-hidden rounded-xl bg-surface-secondary"
          >
            <Image
              key={`${displayUrl}#${retryKey}`}
              source={{ uri: displayUrl }}
              style={{ width: "100%", height: 200 }}
              resizeMode="contain"
              onLoad={() => setImgStatus("ok")}
              onError={() => setImgStatus("error")}
              accessibilityLabel={alt || attachment.name || "图片"}
            />
          </Pressable>
        )}

        {error ? (
          <Typography.Paragraph className="text-[11px] text-danger">{error}</Typography.Paragraph>
        ) : null}
      </DiagramFrame>

      <Modal
        visible={fullscreen && Boolean(displayUrl)}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setFullscreen(false)}
      >
        <View className="flex-1 bg-black">
          <View className="flex-row items-center justify-end gap-1 px-2 pt-safe-offset-3 pb-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="复制图片地址"
              disabled={!copyUrl}
              hitSlop={8}
              onPress={copyLink}
              className="size-9 items-center justify-center"
            >
              <Icon name="link-outline" size={20} tone="accent-foreground" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="下载原图"
              disabled={busy}
              hitSlop={8}
              onPress={() => void download()}
              className="size-9 items-center justify-center"
            >
              <Icon name="download-outline" size={20} tone="accent-foreground" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭"
              hitSlop={8}
              onPress={() => setFullscreen(false)}
              className="size-9 items-center justify-center"
            >
              <Icon name="close" size={22} tone="accent-foreground" />
            </Pressable>
          </View>
          <View className="flex-1 items-center justify-center">
            <Image
              source={{ uri: displayUrl ?? "" }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="contain"
              accessibilityLabel={alt || attachment.name || "图片"}
            />
          </View>
          <View className="px-4 pb-safe-or-2">
            <Typography.Paragraph className="text-center text-[11px] text-muted" numberOfLines={1}>
              {attachment.name}
            </Typography.Paragraph>
          </View>
        </View>
      </Modal>
    </>
  );
}
