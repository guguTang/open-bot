import { Button, ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatSize } from "@/lib/format";
import { useCompactConfig, useLlmConnections } from "@/queries";

/**
 * 压缩策略（只读）。
 *
 * 与 Web 端 `settingsTab === "compact"` 一一对应，行为上刻意**保持只读**：
 * 这套阈值来自服务端的环境变量（COMPACT_*），后端只提供 GET `/v1/compact-config`，
 * 没有对应的写接口。移动端如果做成可编辑的表单，保存时无处可写，
 * 用户会以为改成功了 —— 所以这里只展示，不给任何写入口。
 */

/** 后端没给值时与 Web 端保持一致的兜底常量（两端必须一致，否则解释会打架）。 */
const FALLBACK_BUDGET_RATIO = 0.75;
const FALLBACK_RESERVE_OUTPUT_TOKENS = 2048;
const FALLBACK_DEFAULT_CONTEXT_WINDOW = 32768;

type CompactRow = {
  label: string;
  /** 对应的服务端环境变量名。Web 端直接把它当标题用，这里降级成副标题——手机上一行放不下长变量名。 */
  env: string;
  value: string;
};

export default function CompactScreen(): JSX.Element {
  // fetchCompactConfig 内部已经把失败兜底成 null（不抛），所以这里永远不会进错误态：
  // 读不到时页面走 empty 态提示「确认服务端已启动」，和 Web 端同一套降级。
  const compactQuery = useCompactConfig();
  // 默认 LLM 只影响「上下文窗口来源」这一行的说明文案，拿不到就不显示，
  // 不应该让一个纯装饰性的附加请求把整页打成错误态。
  const llmQuery = useLlmConnections();
  const cfg = compactQuery.data ?? null;
  const defaultLLM = llmQuery.data?.find((c) => c.is_default) ?? null;
  /**
   * 这里用 isFetching 而不是 isLoading：原来每次刷新都会先置 loading=true，
   * 也就是「重新取数期间也回骨架」。isFetching 保持同样的观感，
   * 且这两把键没有轮询，回骨架只发生在首屏和手动刷新。
   */
  const loading = compactQuery.isFetching || llmQuery.isFetching;

  const refresh = () => {
    void Promise.all([compactQuery.refetch(), llmQuery.refetch()]);
  };

  const rows: CompactRow[] = [];

  if (cfg) {
    const ratio = cfg.budget_ratio ?? FALLBACK_BUDGET_RATIO;
    const reserve = cfg.reserve_output_tokens ?? FALLBACK_RESERVE_OUTPUT_TOKENS;

    // 默认模型显式配了 context_window 就以它为准，否则用后端推算出来的值。
    const explicitWindow =
      defaultLLM?.context_window && defaultLLM.context_window > 0
        ? defaultLLM.context_window
        : null;
    const windowValue = explicitWindow ?? cfg.context_window ?? cfg.default_context_window ?? null;
    const windowLabel =
      windowValue === null ? "未知" : `${windowValue.toLocaleString("en-US")} tokens`;
    const windowDesc = explicitWindow
      ? `默认模型「${defaultLLM?.name}」显式设置${defaultLLM?.model ? ` · 模型 ${defaultLLM.model}` : ""}`
      : "未显式设置，按模型名自动推断";

    rows.push(
      {
        label: "触发模式",
        env: "COMPACT_TOKEN_MODE",
        // token 预算为主、消息/字符阈值为兜底；token_mode === false 时退回纯阈值模式
        value:
          cfg.token_mode === false
            ? "仅按消息数 / 字符数阈值"
            : "按 token 预算（主）+ 阈值（兜底）",
      },
      { label: "上下文窗口（估算基数）", env: windowDesc, value: windowLabel },
      {
        label: "估算 token 预算",
        env: "窗口 × 预算比例 − 预留输出",
        // 预算是「估算出来的上限」，单位仍是 token；没有就算不出来，显示 — 而不是 0
        value: cfg.token_budget ? `${cfg.token_budget.toLocaleString("en-US")} tokens` : "—",
      },
      {
        label: "预算比例",
        env: "COMPACT_BUDGET_RATIO",
        // 原值是 0.75 这种小数，补一个百分比让人一眼看懂它占窗口的几成
        value: `${ratio}（约 ${Math.round(ratio * 100)}%）`,
      },
      {
        label: "预留输出 tokens",
        env: "COMPACT_RESERVE_OUTPUT_TOKENS",
        value: reserve.toLocaleString("en-US"),
      },
      {
        label: "默认上下文窗口",
        env: "COMPACT_DEFAULT_CONTEXT_WINDOW",
        value: (cfg.default_context_window ?? FALLBACK_DEFAULT_CONTEXT_WINDOW).toLocaleString(
          "en-US"
        ),
      },
      {
        label: "兜底：最大消息数",
        env: "COMPACT_MAX_MESSAGES",
        value: `${cfg.max_messages} 条`,
      },
      {
        label: "兜底：最大字符数",
        env: "COMPACT_MAX_CHARS",
        value: `${cfg.max_chars.toLocaleString("en-US")} 字符（约 ${formatSize(cfg.max_chars)}）`,
      },
      {
        label: "兜底：保留最近条数",
        env: "COMPACT_KEEP_RECENT",
        value: `${cfg.keep_recent} 条`,
      }
    );
  }

  return (
    <ScreenScaffold
      title="压缩"
      subtitle="上下文压缩策略（只读）"
      loading={loading}
      empty={
        <EmptyState
          icon="layers-outline"
          title="无法读取压缩配置"
          hint="请确认服务端 runtime 已启动，然后点右上角「刷新」"
        />
      }
      onRetry={refresh}
      headerRight={
        <Button size="sm" variant="secondary" onPress={refresh}>
          <Button.Label>刷新</Button.Label>
        </Button>
      }
    >
      <View className="gap-2">
        <Typography.Paragraph color="muted">
          上下文压缩以估算 token 相对模型上下文窗口为主触发；消息数 / 字符数阈值作兜底。 每条 LLM
          连接可在「模型」页设置「上下文窗口 (tokens)」（留空则按模型名自动推断）。 摘要以
          role=summary 落库，重启后优先复用。
        </Typography.Paragraph>
        <Typography.Paragraph color="muted">
          这些阈值由服务端环境变量决定，本页只读，不提供修改入口。
        </Typography.Paragraph>
      </View>

      <ListGroup>
        {rows.map((row) => (
          <ListGroup.Item key={row.label}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{row.label}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>{row.env}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <Typography.Paragraph color="muted" className="text-right">
                {row.value}
              </Typography.Paragraph>
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        ))}
      </ListGroup>
    </ScreenScaffold>
  );
}
