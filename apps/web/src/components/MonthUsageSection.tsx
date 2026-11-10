import { useEffect, useState } from "react";
import { fetchMyUsage, type MyUsage } from "../api";
import { SettingsCard, SettingsHint, SettingsSection } from "./SettingsLayout";

function formatEstimatedCost(
  minor: number | null | undefined,
  currency: string | undefined,
  unpricedTokens: number | undefined,
  unpricedCalls: number | undefined,
): string {
  const unpriced = (unpricedTokens ?? 0) > 0 || (unpricedCalls ?? 0) > 0;
  if (minor == null) return unpriced ? "未定价" : "—";
  const cur = currency || "CNY";
  const amount = cur === "CNY" ? `¥${(minor / 100).toFixed(2)}` : `${cur} ${(minor / 100).toFixed(2)}`;
  return unpriced ? `${amount}（部分未定价）` : amount;
}

export function MonthUsageSection() {
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchMyUsage()
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "用量暂时无法加载");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mixed = usage?.usage_source === "mixed" || ((usage?.provider_tokens ?? 0) > 0 && (usage?.estimated_tokens ?? 0) > 0);
  const cost = usage
    ? formatEstimatedCost(usage.estimated_cost_minor, usage.currency, usage.unpriced_tokens, usage.unpriced_calls)
    : "—";

  return (
    <SettingsSection title="本月用量">
      <SettingsCard className="settings-card-padded">
        {error ? <SettingsHint>{error}</SettingsHint> : null}
        {!usage && !error ? <SettingsHint>正在读取本月用量…</SettingsHint> : null}
        {usage ? (
          <div className="settings-usage">
            <SettingsHint>
              {usage.month} 的模型调用量，按记账时的单价估算。组织自带模型密钥，这里只供对照，不会扣费。
            </SettingsHint>
            <dl className="settings-usage-grid">
              <div>
                <dt>输入 token</dt>
                <dd>{usage.prompt_tokens}</dd>
              </div>
              <div>
                <dt>输出 token</dt>
                <dd>{usage.completion_tokens}</dd>
              </div>
              {usage.cached_tokens > 0 ? (
                <div>
                  <dt>缓存 token</dt>
                  <dd>{usage.cached_tokens}</dd>
                </div>
              ) : null}
              <div>
                <dt>估算费用</dt>
                <dd>{cost}</dd>
              </div>
            </dl>
            {mixed ? <p className="settings-hint">合计含官方与估算，不是官方用量。</p> : null}
            {usage.provider_tokens > 0 || usage.estimated_tokens > 0 ? (
              <p className="settings-hint">
                官方 {usage.provider_tokens} token · 估算 {usage.estimated_tokens} token
                {usage.unpriced_tokens > 0 ? ` · 未定价 ${usage.unpriced_tokens} token` : ""}
              </p>
            ) : null}
            {usage.note ? <p className="settings-hint">{usage.note}</p> : null}
            {usage.by_agent.length > 0 ? (
              <ul className="settings-usage-agents">
                {usage.by_agent.map((row) => (
                  <li key={row.agent_id || row.agent_name}>
                    <span>{row.agent_name || row.agent_id || "助手"}</span>
                    <span>
                      {row.total_tokens} token ·{" "}
                      {formatEstimatedCost(row.estimated_cost_minor, row.currency, row.unpriced_tokens, 0)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <SettingsHint>本月还没有用量记录。</SettingsHint>
            )}
          </div>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
