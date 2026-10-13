import { useEffect, useState } from "react";
import {
  fetchUserSettings,
  updateUserSettings,
  type AutoReviewRule,
  type UserSettings,
} from "../api";
import {
  COMMON_TIMEZONES,
  detectBrowserTimezone,
  effectiveTimezone,
  writeCachedUserSettings,
} from "../lib/userSettings";
import { setHostExecUserSettings } from "../lib/hostExec";
import { SettingsCard, SettingsSection } from "./SettingsLayout";

type Props = {
  onSettingsChange?: (s: UserSettings) => void;
  /** Section heading; omit on mobile dedicated「审核与时区」page (title is already in chrome). */
  sectionTitle?: string;
};

function newRuleId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function GeneralBotSettings({ onSettingsChange, sectionTitle = "审核与时区" }: Props) {
  const [timezone, setTimezone] = useState("");
  const [autoReview, setAutoReview] = useState(true);
  const [rules, setRules] = useState<AutoReviewRule[]>([]);
  const [draftWhen, setDraftWhen] = useState("");
  const [draftAction, setDraftAction] = useState<"ask_first" | "auto_allow">("ask_first");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);
  const detected = detectBrowserTimezone();

  const applyLocal = (s: UserSettings) => {
    setTimezone(s.timezone || "");
    setAutoReview(s.auto_review_enabled !== false);
    setRules(Array.isArray(s.auto_review_rules) ? s.auto_review_rules : []);
    setHostExecUserSettings(s);
    writeCachedUserSettings(s);
    onSettingsChange?.(s);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchUserSettings()
      .then((s) => {
        if (!cancelled) {
          applyLocal(s);
          setLoaded(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMsg(err instanceof Error ? err.message : String(err));
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (patch: {
    timezone?: string;
    auto_review_enabled?: boolean;
    auto_review_rules?: AutoReviewRule[];
  }) => {
    setBusy(true);
    setMsg("");
    try {
      const s = await updateUserSettings(patch);
      applyLocal(s);
      setMsg("已保存");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const addRule = () => {
    const when = draftWhen.trim();
    if (!when) return;
    const next = [...rules, { id: newRuleId(), when, action: draftAction }];
    setDraftWhen("");
    void persist({ auto_review_rules: next });
  };

  const removeRule = (id: string) => {
    const next = rules.filter((r) => r.id !== id);
    void persist({ auto_review_rules: next });
  };

  const tzLabel = timezone
    ? timezone
    : `自动检测（当前 ${detected}）`;

  return (
    <SettingsSection title={sectionTitle || undefined}>
      <SettingsCard padded>
        <div className="bot-general-settings">
          <div className="settings-row bot-settings-row">
            <div className="bot-settings-copy">
              <div className="bot-settings-title">时区</div>
              <div className="bot-settings-desc">
                用于报告时间与例行任务。选择「自动检测」则跟随本机系统时区。
              </div>
            </div>
            <select
              className="bot-settings-select"
              value={timezone}
              disabled={!loaded || busy}
              onChange={(e) => {
                const v = e.target.value;
                setTimezone(v);
                void persist({ timezone: v });
              }}
              aria-label="时区"
            >
              {COMMON_TIMEZONES.map((z) => (
                <option key={z.value || "auto"} value={z.value}>
                  {z.value === "" ? `${z.label}（${detected}）` : z.label}
                </option>
              ))}
              {timezone && !COMMON_TIMEZONES.some((z) => z.value === timezone) ? (
                <option value={timezone}>{timezone}</option>
              ) : null}
            </select>
          </div>

          <div className="settings-row bot-settings-row bot-settings-toggle-row">
            <div className="bot-settings-copy">
              <div className="bot-settings-title">自动审核</div>
              <div className="bot-settings-desc">
                每次执行操作前先检查，必要时询问你；可添加规则自定义哪些操作可自动执行
              </div>
            </div>
            <label className="bot-settings-switch">
              <input
                type="checkbox"
                checked={autoReview}
                disabled={!loaded || busy}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAutoReview(on);
                  void persist({ auto_review_enabled: on });
                }}
              />
              <span className="bot-settings-switch-ui" aria-hidden />
              <span className="sr-only">{autoReview ? "已开启" : "已关闭"}</span>
            </label>
          </div>

          {autoReview ? (
            <div className="bot-review-rules">
              <div className="bot-settings-title">自动审核规则</div>
              <div className="bot-settings-desc" style={{ marginBottom: 10 }}>
                这些规则仅对你生效。内置安全检查始终有效。冲突时「先询问」优先于「自动允许」。匹配为关键词/意图（工具名 + 命令预览 + 原因），不是对话模型自行批准。
              </div>
              <div className="bot-rule-add">
                <label className="bot-rule-label" htmlFor="bot-rule-when-input">
                  当 bot 想要:
                </label>
                <input
                  id="bot-rule-when-input"
                  className="bot-rule-when"
                  value={draftWhen}
                  disabled={busy}
                  placeholder="替我回复邮件 / 本机只读命令"
                  onChange={(e) => setDraftWhen(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addRule();
                    }
                  }}
                />
                <label className="bot-rule-label" htmlFor="bot-rule-action-select">
                  它应该:
                </label>
                <select
                  id="bot-rule-action-select"
                  className="bot-settings-select bot-rule-action"
                  value={draftAction}
                  disabled={busy}
                  onChange={(e) => setDraftAction(e.target.value as "ask_first" | "auto_allow")}
                >
                  <option value="auto_allow">自动允许</option>
                  <option value="ask_first">先询问</option>
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !draftWhen.trim()}
                  onClick={() => addRule()}
                >
                  添加规则
                </button>
              </div>
              {rules.length > 0 ? (
                <ul className="bot-rule-list">
                  {rules.map((r) => (
                    <li key={r.id} className="bot-rule-item">
                      <span className="bot-rule-item-when">当 bot 想要「{r.when}」</span>
                      <span className="bot-rule-item-action">
                        {r.action === "ask_first" ? "先询问" : "自动允许"}
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => removeRule(r.id)}
                      >
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="bot-settings-desc">暂无自定义规则；内置 deny / auto / confirm 档位仍生效。</div>
              )}
            </div>
          ) : (
            <div className="bot-settings-desc" style={{ padding: "0 4px 8px" }}>
              已关闭：除硬拒绝外，本机/远程写删等操作都会先询问你。当前有效时区：{effectiveTimezone({ timezone, auto_review_enabled: autoReview, auto_review_rules: rules })}（{tzLabel}）
            </div>
          )}
          {msg ? <div className="settings-status">{msg}</div> : null}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
