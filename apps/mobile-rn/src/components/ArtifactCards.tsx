import { Button, Chip, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import * as api from "@/api";
import { Icon } from "@/components/Icon";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import { WebPreviewModal } from "@/components/chat/WebPreviewModal";
import { ShareUnavailableError, saveSandboxArtifact } from "@/lib/download";
import {
  artifactDisplayName,
  friendlyOpenError,
  looksLikeHtml,
  normalizeWorkspacePath,
  previewTitleFromPath,
  type Artifact,
} from "@/lib/workspace";

type PreviewState = {
  open: boolean;
  title: string;
  content: string | null;
  loading: boolean;
  error: string | null;
};

const PREVIEW_CLOSED: PreviewState = {
  open: false,
  title: "",
  content: null,
  loading: false,
  error: null,
};

/**
 * 结果导向的产物区：助手提到的文件 + 被折叠的工具 JSON。
 *
 * 对齐 `apps/web/src/components/ArtifactCards.tsx`。与 Web 端的差别：
 * - HTML / SVG 产物的**预览**走 `WebPreviewModal`（WebView），纯文本仍走
 *   `FilePreviewModal`。早期版本为了保首屏性能刻意不引 WebView，本轮已推翻：
 *   图表和 HTML 是相当显眼的一块能力，不值得为它单开一套降级。
 * - 额外加了「下载」：这是 Web 端有、RN 此前完全没有的能力。助手生成的文件
 *   此前只能看源码 + 复制文本，等于拿不到文件本身。
 */
export function ArtifactCards({
  artifacts,
  collapsedJson,
  agentId,
}: {
  artifacts: Artifact[];
  collapsedJson: string[];
  agentId?: string;
}): JSX.Element | null {
  const [preview, setPreview] = useState<PreviewState>(PREVIEW_CLOSED);
  const [rendered, setRendered] = useState<{ open: boolean; title: string; content: string }>({
    open: false,
    title: "",
    content: "",
  });
  const [openJson, setOpenJson] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  if (!artifacts.length && !collapsedJson.length) return null;

  const openPath = async (path: string): Promise<void> => {
    const wp = normalizeWorkspacePath(path);
    const title = previewTitleFromPath(wp);
    // HTML / SVG 走 WebView 渲染，别的走纯文本。
    // 分工与理由见 FilePreviewModal 顶部注释。
    if (looksLikeHtml("", wp)) {
      try {
        const res = await api.readSandboxFile(wp, agentId ? { agent_id: agentId } : undefined);
        setRendered({ open: true, title, content: res.content || "" });
      } catch (err) {
        setNotice(friendlyOpenError(err));
      }
      return;
    }
    setPreview({ open: true, title, content: null, loading: true, error: null });
    try {
      const res = await api.readSandboxFile(wp, agentId ? { agent_id: agentId } : undefined);
      setPreview({ open: true, title, content: res.content || "", loading: false, error: null });
    } catch (err) {
      setPreview({
        open: true,
        title,
        content: null,
        loading: false,
        error: friendlyOpenError(err),
      });
    }
  };

  const download = async (path: string): Promise<void> => {
    setDownloading(path);
    setNotice("");
    try {
      await saveSandboxArtifact(path, agentId ? { agent_id: agentId } : undefined);
    } catch (err) {
      // 分享面板不可用时文件其实已经落到本地了，只是没法直接调起分享
      if (err instanceof ShareUnavailableError) {
        setNotice("当前设备无法调起分享，文件已保存在本地");
      } else {
        setNotice(friendlyOpenError(err));
      }
    } finally {
      setDownloading(null);
    }
  };

  return (
    <View className="mt-1 gap-2">
      {notice ? (
        <Typography.Paragraph className="text-[11px] text-muted">{notice}</Typography.Paragraph>
      ) : null}

      {artifacts.map((a) => (
        // 整行拆成两个可点区：左半打开预览，右半下载。
        // 不做成嵌套 Pressable —— RN 里内层 Pressable 会和外层抢触摸，
        // 表现为「点下载有时触发打开」。
        <View key={a.path} className="flex-row items-center rounded-xl bg-background pr-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`打开 ${artifactDisplayName(a.path)}`}
            onPress={() => void openPath(a.path)}
            // 底色用 background 而不是 surface-secondary：这些卡片本来就
            // 落在助手气泡（surface-secondary）里，同色等于白画一层。
            className="flex-1 flex-row items-center gap-3 px-3 py-2.5"
          >
            <View className="w-14 rounded-md bg-accent-soft px-1.5 py-0.5">
              <Typography.Paragraph
                className="text-center text-[10px] text-accent-soft-foreground"
                numberOfLines={1}
              >
                {a.kind}
              </Typography.Paragraph>
            </View>
            <View className="flex-1">
              <Typography.Paragraph numberOfLines={1}>
                {artifactDisplayName(a.path)}
              </Typography.Paragraph>
            </View>
            <Icon name="chevron-forward" size={16} tone="accent" />
          </Pressable>

          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            isDisabled={downloading !== null}
            onPress={() => void download(a.path)}
            accessibilityLabel={`下载 ${artifactDisplayName(a.path)}`}
          >
            {downloading === a.path ? (
              <Spinner size="sm" />
            ) : (
              <Icon name="download-outline" size={18} tone="muted" />
            )}
          </Button>
        </View>
      ))}

      {collapsedJson.length > 0 ? (
        <View className="gap-2">
          <Chip
            size="sm"
            variant={openJson ? "soft" : "secondary"}
            color="default"
            onPress={() => setOpenJson((v) => !v)}
            accessibilityLabel={`工具结果 ${collapsedJson.length} 条`}
          >
            <Chip.Label>
              {openJson ? "收起工具详情" : `工具结果 ×${collapsedJson.length}`}
            </Chip.Label>
          </Chip>

          {openJson
            ? collapsedJson.map((j, i) => (
                <View key={i} className="rounded-xl bg-background px-3 py-2">
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <Typography.Paragraph
                      selectable
                      className="text-xs"
                      style={{ fontFamily: "Menlo" }}
                    >
                      {j}
                    </Typography.Paragraph>
                  </ScrollView>
                </View>
              ))
            : null}
        </View>
      ) : null}

      <FilePreviewModal
        open={preview.open}
        title={preview.title}
        content={preview.content}
        loading={preview.loading}
        error={preview.error}
        onClose={() => setPreview(PREVIEW_CLOSED)}
      />

      {rendered.open ? (
        <WebPreviewModal
          visible
          onClose={() => setRendered({ open: false, title: "", content: "" })}
          mode="html"
          html={rendered.content}
          title={rendered.title}
        />
      ) : null}
    </View>
  );
}
