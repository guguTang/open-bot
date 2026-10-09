import { Button, Dialog, Spinner, Typography, useThemeColor } from "heroui-native";
import * as Clipboard from "expo-clipboard";
import type { JSX } from "react";
import { ScrollView, View } from "react-native";

import { formatSize } from "@/lib/format";

type Props = {
  open: boolean;
  title: string;
  content: string | null;
  loading?: boolean;
  error?: string | null;
  meta?: string;
  onClose: () => void;
};

/**
 * 文件预览。
 *
 * Web 端这里用 `<iframe srcdoc>` + sandbox 渲染 HTML（见 `HtmlPreviewModal.tsx`），
 * 但 RN **没有 WebView**（`react-native-webview` 不在依赖里，加它会显著拖慢首屏）。
 * 所以移动端一律降级成「等宽纯文本源码 + 复制」：
 * - 文本文件：完全可用
 * - HTML / SVG：只能看源码，不渲染
 *
 * 这是有意的能力裁剪，不是遗漏。真要渲染得引入 WebView 方案，代价与收益不匹配。
 */
export function FilePreviewModal({
  open,
  title,
  content,
  loading,
  error,
  meta,
  onClose,
}: Props): JSX.Element {
  const muted = useThemeColor("muted");

  return (
    <Dialog isOpen={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress>
          <Dialog.Content className="max-h-[80%]">
            <Dialog.Title numberOfLines={1}>{title || "文件"}</Dialog.Title>
            {meta ? <Dialog.Description>{meta}</Dialog.Description> : null}

            {loading ? (
              <View className="items-center py-10">
                <Spinner color={muted} />
              </View>
            ) : null}

            {error ? (
              <Typography.Paragraph className="mt-3 text-danger">{error}</Typography.Paragraph>
            ) : null}

            {!loading && !error && content != null ? (
              <ScrollView
                className="mt-3 max-h-[46vh]"
                contentContainerClassName="rounded-xl bg-surface-secondary px-3 py-2"
                nestedScrollEnabled
              >
                <Typography.Paragraph
                  selectable
                  className="text-xs"
                  style={{ fontFamily: "Menlo", lineHeight: 18 }}
                >
                  {content}
                </Typography.Paragraph>
              </ScrollView>
            ) : null}

            {/* safe-or = max(inset, value)：底部安全区至少 8px */}
            <View className="mt-4 flex-row justify-end gap-3 pb-safe-or-2">
              {content ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    void Clipboard.setStringAsync(content);
                  }}
                >
                  <Button.Label>复制内容</Button.Label>
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onPress={onClose}>
                <Button.Label>关闭</Button.Label>
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}

/** 人类可读的文件体积，给弹窗副标题用。 */
export function fileMeta(size?: number): string {
  return size ? formatSize(size) : "";
}
