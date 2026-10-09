/**
 * WebView 预览弹层：HTML 产物 + 沙箱桌面（noVNC）。
 *
 * 对齐 Web 端 `apps/web/src/components/HtmlPreviewModal.tsx` 的两种用途：
 * - HTML 产物：Web 端是 `<iframe srcdoc sandbox>`，这里是 `source={{ html }}`
 * - 沙箱桌面：Web 端在 `ArtifactCards` 里直接开新窗口，这里是 `source={{ uri }}`
 *
 * ── 为什么不复用 `FilePreviewModal` ────────────────────────────────────
 * 那个文件顶部写着「RN 没有 WebView，所以 HTML 一律降级成纯文本源码」，那是引入
 * `react-native-webview` **之前**的结论。本组件是那条结论被推翻后的落地点：只有真正
 * 需要渲染的内容（HTML 产物 / 沙箱桌面）才付 WebView 的钱，普通文本文件仍然走
 * `FilePreviewModal`。注意 `FilePreviewModal` 顶部那段注释现在已过时，由本文件接管。
 *
 * ── 安全边界（本文件的主要工作）────────────────────────────────────────
 * Web 端能靠 `DOMParser` + iframe `sandbox` 做真正的 DOM 级消毒，RN 没有任何 DOM，
 * 只能写正则。两条原则：
 * 1. **宁可多删**：外部资源一律不放行（`<link>` / `@import` / 外链图片全砍），
 *    代价是依赖 CDN 的产物会掉样式；换来的是预览不会把会话内容发到第三方，
 *    也不会被图片 URL 追踪。
 * 2. **失败即关闭**：正则一定有盲区，所以消毒完再扫一遍，残留可疑标记就整篇拒绝渲染
 *    （`rejected: true`），宁可显示一句说明也不放行。最后再用文档内 CSP 兜底，
 *    即使前面两层都被绕过，浏览器引擎层面仍然执行不了脚本。
 *
 * 已知残余风险：正则无法处理属性值里带 `>` 的畸形标签（`<img src="a>b" onerror=...>`）。
 * CSP `script-src 'none'` 正是为这类情况准备的第二道防线。
 */

import { Typography, useThemeColor } from "heroui-native";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, useState, type JSX } from "react";
import { Modal, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";

import { Icon } from "@/components/Icon";

/* ------------------------------------------------------------------ *
 * 消毒层
 * ------------------------------------------------------------------ */

/** 与 Web 端 `HTML_DIAGRAM_MAX_BYTES` 同量级：再大就该走「下载后自己开」了。 */
export const HTML_PREVIEW_MAX_BYTES = 200 * 1024;

export type HtmlSanitizeResult = {
  /** 可直接喂给 WebView 的完整文档；`rejected` 时是一段纯说明。 */
  html: string;
  /** 被剥掉的节点 / 属性 / 外链数量。>0 时在工具条上给用户一句提示。 */
  blocked: number;
  /** 原文超过上限被截断。 */
  truncated: boolean;
  empty: boolean;
  /** 消毒后仍扫到可疑残留 → 整篇不放行。 */
  rejected: boolean;
};

type Counter = { n: number };

/** UTF-8 字节数。RN 侧不保证有 `TextEncoder`，而截断判断只需要数量级正确。 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    // 高低代理对算一个码点 → 4 字节
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** 注释里可以藏 payload（条件注释），先整段去掉。 */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

/** 带内容的整块删除（script / iframe / object …），先配对删再删残留的单边标签。 */
function dropElement(html: string, tag: string, hit: Counter): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  const next = html.replace(paired, () => {
    hit.n += 1;
    return "";
  });
  return next.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), () => {
    hit.n += 1;
    return "";
  });
}

/** 只有开标签的容器（form）：摘掉标签但留内容，避免表单布局塌成一片裸文本。 */
function unwrapElement(html: string, tag: string, hit: Counter): string {
  return html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), () => {
    hit.n += 1;
    return "";
  });
}

/** 先摘实体再判断协议，`&#106;avascript:` / `java\tscript:` 这类混淆才拦得住。 */
function normalizeUrl(raw: string): string {
  return (
    raw
      // 实体直接删掉而不是解码：这里只用来判断协议，不需要还原真实字符
      .replace(/&[#0-9a-z]+;?/gi, "")
      // 控制字符与空白同样能藏协议（`java&#10;script:`）
      .replace(/[\u0000-\u0020\u007f]/g, "")
      .toLowerCase()
  );
}

/**
 * URL 白名单：只放行页内锚点和位图 data URI。
 * - svg 的 data URI 一律拒绝：它能内嵌脚本，在少数上下文里会被当成文档而不是图片
 * - 其余外链（含 http(s) / 协议相对 / data:text/html）全拒，理由见文件头
 */
function isAllowedUrl(raw: string): boolean {
  const v = normalizeUrl(raw);
  if (!v) return false;
  if (v.startsWith("#")) return true;
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=]+$/.test(v);
}

/** 任何非 `data:image/*` 的 CSS url() 都换成 about:blank；`@import` 整条删掉。 */
function sanitizeCss(css: string, hit: Counter): string {
  let out = css.replace(/@import[^;{}]*(?:;|$)/gi, () => {
    hit.n += 1;
    return "";
  });
  out = out.replace(/url\s*\([^)]*\)/gi, (m) =>
    isAllowedUrl(m.slice(4, -1)) ? m : (hit.n++, "url(about:blank)")
  );
  out = out.replace(/expression\s*\([^)]*\)/gi, () => {
    hit.n += 1;
    return "none";
  });
  out = out.replace(/(^|[;{\s])(-moz-binding|behavior)\s*:[^;}]*/gi, (_m, lead: string) => {
    hit.n += 1;
    return `${lead}none:`;
  });
  return out;
}

/** 会指向外部资源的属性。`srcset` 是逗号分隔列表，白名单判定必然不过，直接作废。 */
const URL_ATTRS =
  "href|src|xlink:href|poster|data|srcset|background|action|formaction|ping|codebase|archive|usemap|dynsrc";

function scrubTag(tagText: string, hit: Counter): string {
  // 1. 事件属性：`on* = "..."`。要求前面有空白，避免误伤 `data-on...` 这种正常属性名。
  let out = tagText.replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, () => {
    hit.n += 1;
    return "";
  });

  // 2. URL 属性：过不了白名单的一律换成 about:blank（保留属性名，省得排版塌掉）
  out = out.replace(
    new RegExp(`\\s+(${URL_ATTRS})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`, "gi"),
    (m, name: string, dq?: string, sq?: string, bare?: string) => {
      const value = (dq ?? sq ?? bare ?? "").trim();
      if (isAllowedUrl(value)) return m;
      hit.n += 1;
      return ` ${name}="about:blank"`;
    }
  );

  // 3. style 属性里的 url() / @import
  out = out.replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (m, dq?: string, sq?: string) => {
    const css = sanitizeCss(dq ?? sq ?? "", hit);
    if (css === (dq ?? sq ?? "")) return m;
    return ` style="${css.replace(/"/g, "'")}"`;
  });

  return out;
}

/**
 * 只处理标签本体，不碰标签之间的文本（正文里的 `<` 不能当标签改）。
 * 按 `<`、`/`、标签名、属性、结尾 `/>` 分组回填，避免用 indexOf 切字符串。
 */
function scrubTags(html: string, hit: Counter): string {
  return html.replace(
    /<(\/?)([a-z][a-z0-9-]*)([^>]*?)(\/?)>/gi,
    (_m, slash: string, name: string, attrs: string, selfClose: string) =>
      `<${slash}${name}${scrubTag(attrs, hit)}${selfClose}>`
  );
}

/**
 * 消毒后的最后一扫：正则层一定有盲区，扫到就直接整篇拒绝。
 * 只在**标签内部**查 `on*=` / `javascript:`，正文里写「onclick=」这种词不会被误伤。
 */
function looksDangerous(html: string): boolean {
  if (/<\s*(?:script|iframe|object|embed|applet|frame|frameset|base|link|meta)\b/i.test(html))
    return true;
  if (/expression\s*\(/i.test(html)) return true;
  for (const tag of html.match(/<[a-z!/][^>]*>/gi) ?? []) {
    if (/\son[a-z-]+\s*=/i.test(tag)) return true;
    if (
      /(?:href|src|action|data|poster|formaction|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data:text\/html)/i.test(
        tag
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 预览文档外壳。
 *
 * CSP 不是装饰：`script-src 'none'` 让任何漏网的 `<script>` / `javascript:` 在引擎层直接失效，
 * `default-src 'none'` 兜住 CSS/字体/媒体，`form-action` / `base-uri` 防跳转与 base 劫持。
 * 内联 `<style>` 必须放行（`style-src 'unsafe-inline'`），否则产物全裸。
 */
function wrapDocument(body: string): string {
  return `<!DOCTYPE html>
<html data-theme="light" style="color-scheme:light">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  html,body{margin:0;padding:0;background:#ffffff;color:#0f172a;color-scheme:light;
    font:13px/1.5 -apple-system,"SF Pro Text","PingFang SC","Noto Sans SC",system-ui,sans-serif;}
  body{padding:12px;overflow:auto;word-break:break-word;}
  img{max-width:100%;height:auto;}
  table{border-collapse:collapse;max-width:100%;}
  th,td{border:1px solid rgba(15,23,42,.12);padding:6px 10px;}
  a[href="about:blank"]{color:#94a3b8;text-decoration:underline;}
</style>
</head>
<body>${body}</body>
</html>`;
}

/** 被拒绝 / 超限时给用户看的纯文本说明页（本身没有任何可执行内容）。 */
function noticeDocument(message: string): string {
  return wrapDocument(`<p style="margin:0;color:#64748b">${message}</p>`);
}

/**
 * 把助手产出的 HTML 变成「可安全放进 WebView 的静态文档」。
 *
 * 与 Web 端 `sanitizeHtmlDiagram` 的目标一致（剥脚本与外链资源），但实现是纯字符串的：
 * 没有 DOM 就没有「遍历属性」这一步，只能整段正则匹配。代价与残余风险见文件头。
 */
export function sanitizeHtmlForPreview(source: string): HtmlSanitizeResult {
  const raw = source ?? "";
  if (!raw.trim()) {
    return {
      html: noticeDocument("内容为空"),
      blocked: 0,
      truncated: false,
      empty: true,
      rejected: false,
    };
  }

  const hit: Counter = { n: 0 };
  let html = stripComments(raw);

  // 超限先截断。切在标签边界外，末尾残缺的 `<...` 丢掉，避免拼出畸形标签。
  let truncated = false;
  if (utf8Length(html) > HTML_PREVIEW_MAX_BYTES) {
    html = html.slice(0, HTML_PREVIEW_MAX_BYTES);
    html = html.replace(/<[^>]*$/, "");
    truncated = true;
    hit.n += 1;
  }

  // 1. 整块删除：能执行 / 能嵌套文档的
  for (const tag of ["script", "iframe", "object", "embed", "applet", "frame", "frameset"]) {
    html = dropElement(html, tag, hit);
  }
  // 2. 整块删除：会发起网络请求或改写解析规则的空元素
  for (const tag of ["base", "link", "meta"]) {
    html = dropElement(html, tag, hit);
  }
  // 3. 摘标签留内容
  html = unwrapElement(html, "form", hit);
  // 4. 内联样式块里的 @import / 外链 url()
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_m, css: string) => {
    return `<style>${sanitizeCss(css, hit)}</style>`;
  });
  // 5. 标签属性：on* 事件、URL 白名单、style 里的外链
  html = scrubTags(html, hit);

  const empty = !html.trim();
  if (looksDangerous(html)) {
    return {
      html: noticeDocument("这份内容含有不安全片段，已停止预览。可以复制源码到浏览器查看。"),
      blocked: hit.n,
      truncated,
      empty,
      rejected: true,
    };
  }

  return { html: wrapDocument(html), blocked: hit.n, truncated, empty, rejected: false };
}

/* ------------------------------------------------------------------ *
 * 弹层
 * ------------------------------------------------------------------ */

type Props = {
  visible: boolean;
  onClose: () => void;
  mode: "html" | "url";
  /** mode="html"：原始（未消毒）源码，消毒在本组件内做 */
  html?: string | null;
  /** mode="url"：调用方已经加工好的地址（含沙箱桌面 token），这里只负责渲染 */
  uri?: string | null;
  title: string;
  /** 远端地址过期（如沙箱桌面 token 轮换）时由外部重新取地址 */
  onRefresh?: () => void;
};

/**
 * 外壳只做一件事：把「一次预览会话」的状态用 key 隔开。
 *
 * 打开 / 切换内容时 key 变化 → 内部组件整体重挂载 → 加载中、报错、重载计数自然归零，
 * 不需要「监听 visible 再同步 setState」那种写法（既多一次渲染，也容易被 lint 判成反模式）。
 */
export function WebPreviewModal(props: Props): JSX.Element {
  const sessionKey = props.visible ? `${props.mode}:${props.uri ?? ""}` : "closed";
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={props.onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <PreviewSession key={sessionKey} {...props} />
    </Modal>
  );
}

function PreviewSession({ onClose, mode, html, uri, title, onRefresh }: Props): JSX.Element {
  const background = useThemeColor("background");

  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sanitized = useMemo(
    () => (mode === "html" ? sanitizeHtmlForPreview(html ?? "") : null),
    [mode, html]
  );

  const target = mode === "url" ? (uri ?? "").trim() : "";

  /**
   * 导航白名单。
   * - html 模式：只放行 about:/blob:/data:image，连外链跳转一起堵死（WKWebView 不支持
   *   CSP `navigate-to`，只能在这里拦），否则一份产物可以把预览页导航到钓鱼站。
   * - url 模式：只放行 http(s)，沙箱桌面自身可能重定向，不能按 origin 卡死。
   */
  const allowNavigation = useCallback(
    (req: { url: string }) => {
      const url = (req.url || "").trim();
      if (!url) return true;
      const lower = url.toLowerCase();
      if (lower.startsWith("about:") || lower.startsWith("blob:")) return true;
      if (lower.startsWith("data:image/")) return true;
      return mode === "url" && (lower.startsWith("http://") || lower.startsWith("https://"));
    },
    [mode]
  );

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
    setLoading(true);
    setError(null);
    // 远端地址可能带一次性 token，刷新时顺带让外部重新取一次。
    onRefresh?.();
  }, [onRefresh]);

  const body = (): JSX.Element => {
    if (mode === "html" && sanitized?.rejected) {
      return (
        <View className="flex-1 items-center justify-center bg-background px-8">
          <Typography.Paragraph color="muted" className="text-center text-sm">
            这份内容含有不安全片段，已停止预览。可以复制源码到浏览器查看。
          </Typography.Paragraph>
        </View>
      );
    }
    if (mode === "url" && !target) {
      return (
        <View className="flex-1 items-center justify-center bg-background px-8">
          <Typography.Paragraph color="muted" className="text-center text-sm">
            没有可加载的地址
          </Typography.Paragraph>
        </View>
      );
    }

    return (
      <WebView
        // key 变化 = 强制重载，这是 WebView 唯一可靠的 reload 手段（reload() 在部分
        // Android 机型上对 source={{ html }} 无效）。
        key={`${mode}-${reloadKey}`}
        source={mode === "html" ? { html: sanitized?.html ?? "" } : { uri: target }}
        className="flex-1 bg-background"
        // 沙箱内部信息一律不进来：组件只拿到已经加工好的 uri 与标题，
        // container_id / 镜像名 / 宿主路径都不该出现在移动端。
        originWhitelist={mode === "html" ? ["*"] : ["https://*", "http://*"]}
        javaScriptEnabled
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        domStorageEnabled={mode === "url"}
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        onShouldStartLoadWithRequest={allowNavigation}
        onLoadStart={() => {
          setLoading(true);
          setError(null);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError("加载失败，请检查网络后重试");
        }}
        // noVNC 靠长连接推屏，网络层抖动会直接报 HTTP 错误，这里也兜一下
        onHttpError={(syntheticEvent) => {
          const status = syntheticEvent.nativeEvent.statusCode;
          if (status >= 400) {
            setLoading(false);
            setError("远端返回异常，请稍后重试");
          }
        }}
        style={{ backgroundColor: background }}
      />
    );
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-1 border-b border-border bg-background px-2 pt-safe-offset-3 pb-2">
        <View className="flex-1 px-1">
          <Typography.Paragraph numberOfLines={1}>
            {title || (mode === "html" ? "HTML 预览" : "沙箱桌面")}
          </Typography.Paragraph>
          {mode === "html" && sanitized && (sanitized.blocked > 0 || sanitized.truncated) ? (
            <Typography.Paragraph color="muted" className="text-[10px]" numberOfLines={1}>
              {[sanitized.truncated ? "内容过大已截断" : null, "脚本与外链资源已屏蔽"]
                .filter(Boolean)
                .join(" · ")}
            </Typography.Paragraph>
          ) : null}
        </View>

        <ToolbarButton icon="refresh" label="刷新" onPress={refresh} />
        {/* 只在 url 模式有地址可复制；html 模式没有可分享的 URL */}
        {mode === "url" && target ? (
          <ToolbarButton
            icon="link-outline"
            label="复制地址"
            onPress={() => {
              void Clipboard.setStringAsync(target);
            }}
          />
        ) : null}
        <ToolbarButton icon="close" label="关闭" onPress={onClose} />
      </View>

      {error ? (
        <View className="bg-danger-soft px-4 py-2">
          <Typography.Paragraph className="text-xs text-danger-soft-foreground">
            {error}
          </Typography.Paragraph>
        </View>
      ) : null}

      {loading && !error ? (
        <View className="px-4 py-1.5">
          <Typography.Paragraph color="muted" className="text-[11px]">
            加载中…
          </Typography.Paragraph>
        </View>
      ) : null}

      <View className="flex-1">{body()}</View>
    </View>
  );
}

function ToolbarButton({
  icon,
  label,
  onPress,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // 触控面积撑到 36px：图标只有 18px，直接套在图标上会难点
      hitSlop={6}
      className="size-9 items-center justify-center rounded-lg"
    >
      <Icon name={icon} size={18} tone="foreground" />
    </Pressable>
  );
}
