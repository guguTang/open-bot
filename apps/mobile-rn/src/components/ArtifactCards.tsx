import { Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import * as api from "@/api";
import { Icon } from "@/components/Icon";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import {
  artifactDisplayName,
  friendlyOpenError,
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
 * 对齐 `apps/web/src/components/ArtifactCards.tsx`，差别只有一处：
 * Web 端用 iframe 渲染 HTML 预览，RN 没有 WebView，所以统一走纯文本预览
 * （见 `FilePreviewModal` 顶部注释）。
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
  const [openJson, setOpenJson] = useState(false);

  if (!artifacts.length && !collapsedJson.length) return null;

  const openPath = async (path: string): Promise<void> => {
    const wp = normalizeWorkspacePath(path);
    const title = previewTitleFromPath(wp);
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

  return (
    <View className="mt-1 gap-2">
      {artifacts.map((a) => (
        <Pressable
          key={a.path}
          accessibilityRole="button"
          accessibilityLabel={`打开 ${artifactDisplayName(a.path)}`}
          onPress={() => void openPath(a.path)}
          // 底色用 background 而不是 surface-secondary：这些卡片本来就
          // 落在助手气泡（surface-secondary）里，同色等于白画一层。
          className="flex-row items-center gap-3 rounded-xl bg-background px-3 py-2.5"
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
    </View>
  );
}
