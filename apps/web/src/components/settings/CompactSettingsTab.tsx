import type { CompactConfig, LLMConnection } from "../../api";
import { Button } from "@/components/ui/button";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type CompactSettingsTabProps = {
  compactCfg: CompactConfig | null;
  defaultLLM: LLMConnection | null | undefined;
  onRefreshCompact: () => void | Promise<void>;
};

export function CompactSettingsTab({
  compactCfg,
  defaultLLM,
  onRefreshCompact,
}: CompactSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsHint>
        上下文压缩以估算 token 相对模型上下文窗口为主触发；消息数 / 字符数阈值作兜底。可在「模型」页为每条连接设置「上下文窗口 (tokens)」（留空则按模型名自动推断）。摘要以 role=summary 落库，重启后优先复用。
      </SettingsHint>
      <SettingsSection
        title="当前参数"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => void onRefreshCompact()}>
            刷新
          </Button>
        }
      >
        {compactCfg ? (
          <SettingsCard>
            <div className="llm-list">
              <div className="llm-item">
                <div>
                  <div className="agent-name">触发模式</div>
                  <div className="agent-desc">
                    {compactCfg.token_mode === false ? "仅遗留阈值" : "token 预算（主）+ 遗留阈值（兜底）"}
                  </div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">上下文窗口（当前用于估算）</div>
                  <div className="agent-desc">
                    {defaultLLM?.context_window && defaultLLM.context_window > 0
                      ? `${defaultLLM.context_window}（默认模型「${defaultLLM.name}」显式设置）`
                      : `${compactCfg.context_window ?? compactCfg.default_context_window ?? "—"}（自动 / 环境默认）`}
                    {defaultLLM?.model ? ` · 模型 ${defaultLLM.model}` : ""}
                  </div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">估算 token 预算</div>
                  <div className="agent-desc">
                    {compactCfg.token_budget ?? "—"}
                    {" "}
                    （窗口 × {compactCfg.budget_ratio ?? 0.75} − 预留输出{" "}
                    {compactCfg.reserve_output_tokens ?? 2048}）
                  </div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">默认上下文窗口</div>
                  <div className="agent-desc">{compactCfg.default_context_window ?? 32768}</div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">预算比例</div>
                  <div className="agent-desc">{compactCfg.budget_ratio ?? 0.75}</div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">预留输出 tokens</div>
                  <div className="agent-desc">{compactCfg.reserve_output_tokens ?? 2048}</div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">消息数阈值（兜底）</div>
                  <div className="agent-desc">{compactCfg.max_messages}</div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">字符数阈值（兜底）</div>
                  <div className="agent-desc">{compactCfg.max_chars}</div>
                </div>
              </div>
              <div className="llm-item">
                <div>
                  <div className="agent-name">保留最近消息数</div>
                  <div className="agent-desc">{compactCfg.keep_recent}</div>
                </div>
              </div>
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            <SettingsEmpty>无法读取（请确认服务已启动）</SettingsEmpty>
          </SettingsCard>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}
