/**
 * 消息里的 OpenUI 片段（RN）。回退规则与 web 一致：
 * 流式结束仍解析不出 root，或渲染抛异常 → 显示源码，消息永远可读。
 */
import { Renderer, type ActionEvent, type ParseResult } from "@openuidev/react-lang";
import { Typography } from "heroui-native";
import { Component, useCallback, useState, type JSX, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { resolveOpenUiAction } from "./actions";
import { useOpenUiHost } from "./host";
import { openBotLibrary } from "./library";

class RenderBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SourceFallback({ source }: { source: string }): JSX.Element {
  return (
    <View className="gap-1 rounded-lg border border-border bg-surface-tertiary p-2">
      <Typography.Paragraph className="text-[11px] text-muted">
        交互内容（无法显示）
      </Typography.Paragraph>
      <ScrollView horizontal>
        <Typography.Paragraph selectable className="font-mono text-[12px] text-foreground">
          {source}
        </Typography.Paragraph>
      </ScrollView>
    </View>
  );
}

export function OpenUIBlock({
  source,
  streaming,
}: {
  source: string;
  streaming: boolean;
}): JSX.Element {
  const host = useOpenUiHost();
  const [empty, setEmpty] = useState(false);
  const onParseResult = useCallback((r: ParseResult | null) => setEmpty(!r || !r.root), []);
  const onAction = useCallback(
    (event: ActionEvent) => {
      const act = resolveOpenUiAction(event);
      if (act.kind === "send") host.send(act.text);
      else if (act.kind === "open_url") host.openUrl(act.url);
    },
    [host]
  );

  const fallback = <SourceFallback source={source} />;
  if (!streaming && empty) return fallback;
  return (
    <RenderBoundary fallback={fallback}>
      <Renderer
        response={source}
        library={openBotLibrary}
        isStreaming={streaming || host.readonly}
        onAction={onAction}
        onParseResult={onParseResult}
      />
    </RenderBoundary>
  );
}
