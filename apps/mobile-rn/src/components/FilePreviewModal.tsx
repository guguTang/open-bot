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
 * 这里只负责**纯文本**：等宽源码 + 复制。
 * - 文本文件：完全可用
 * - HTML / SVG：要看渲染效果请走 `chat/WebPreviewModal.tsx`（WebView + 消毒）
 *
 * 早期版本没有 WebView，HTML 一律降级成看源码；本轮已引入
 * `react-native-webview`，但分工保持不变：文本走这里（快、无原生开销），
 * 渲染走 WebPreviewModal（贵、需要消毒）。别把两者合并成一个组件，
 * 否则每看一个 txt 都要付 WebView 的启动成本。
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
