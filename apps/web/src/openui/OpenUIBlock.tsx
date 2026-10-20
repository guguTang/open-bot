/**
 * 聊天消息里 ```openui-lang 围栏 → OpenUI 渲染。
 *
 * 回退规则（任何一条命中都显示源码卡片，保证消息永远可读）：
 * - 流式结束后解析不出 root（模型写坏了 / 用了不存在的组件导致整段为空）
 * - 渲染器抛异常（ErrorBoundary 兜底）
 * 流式中直接交给 Renderer：OpenUI 本身就是为边流边画设计的，未解析的引用只是暂不显示。
 */
import { Component, useCallback, useState, type ReactNode } from "react";
import { Renderer, type ActionEvent, type ParseResult } from "@openuidev/react-lang";
import { resolveOpenUiAction } from "./actions";
import { openBotLibrary } from "./library";
import { useOpenUiHost } from "./host";

type Props = { source: string; streaming: boolean };

class RenderBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function OpenUISourceFallback({ source }: { source: string }) {
  return (
    <div className="md-codeblock oui-fallback" data-testid="openui-fallback">
      <div className="md-codeblock-head">
        <span className="md-codeblock-lang">交互内容（无法显示）</span>
      </div>
      <pre>
        <code>{source}</code>
      </pre>
    </div>
  );
}

export function OpenUIBlock({ source, streaming }: Props) {
  const host = useOpenUiHost();
  const [empty, setEmpty] = useState(false);

  const onParseResult = useCallback((r: ParseResult | null) => {
    setEmpty(!r || !r.root);
  }, []);

  const onAction = useCallback(
    (event: ActionEvent) => {
      const act = resolveOpenUiAction(event);
      if (act.kind === "send") host.send(act.text);
      else if (act.kind === "open_url") host.openUrl(act.url);
    },
    [host],
  );

  const fallback = <OpenUISourceFallback source={source} />;
  if (!streaming && empty) return fallback;

  return (
    <div className="oui-root" data-testid="openui-block">
      <RenderBoundary fallback={fallback}>
        <Renderer
          response={source}
          library={openBotLibrary}
          isStreaming={streaming || host.readonly}
          onAction={onAction}
          onParseResult={onParseResult}
        />
      </RenderBoundary>
    </div>
  );
}
