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
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
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
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>时区</FieldTitle>
              <FieldDescription>
                用于报告时间与例行任务。选择「自动检测」则跟随本机系统时区。
              </FieldDescription>
            </FieldContent>
            <NativeSelect
              value={timezone}
              disabled={!loaded || busy}
              aria-label="时区"
              onChange={(e) => {
                const v = e.target.value;
                setTimezone(v);
                void persist({ timezone: v });
              }}
            >
              {COMMON_TIMEZONES.map((z) => (
                <NativeSelectOption key={z.value || "auto"} value={z.value}>
                  {z.value === "" ? `${z.label}（${detected}）` : z.label}
                </NativeSelectOption>
              ))}
              {timezone && !COMMON_TIMEZONES.some((z) => z.value === timezone) ? (
                <NativeSelectOption value={timezone}>{timezone}</NativeSelectOption>
              ) : null}
            </NativeSelect>
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>自动审核</FieldTitle>
              <FieldDescription>
                每次执行操作前先检查，必要时询问你；可添加规则自定义哪些操作可自动执行
              </FieldDescription>
            </FieldContent>
            <Switch
              id="auto-review-enabled"
              checked={autoReview}
              disabled={!loaded || busy}
              onCheckedChange={(on) => {
                setAutoReview(on);
                void persist({ auto_review_enabled: on });
              }}
              aria-label={autoReview ? "已开启" : "已关闭"}
            />
          </Field>

          {autoReview ? (
            <div className="flex flex-col gap-3">
              <div>
                <FieldTitle>自动审核规则</FieldTitle>
                <FieldDescription>
                  这些规则仅对你生效。内置安全检查始终有效。冲突时「先询问」优先于「自动允许」。匹配为关键词/意图（工具名 + 命令预览 + 原因），不是对话模型自行批准。
                </FieldDescription>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <Field className="min-w-48 flex-1">
                  <FieldLabel htmlFor="bot-rule-when-input">当 bot 想要:</FieldLabel>
                  <Input
                    id="bot-rule-when-input"
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
                </Field>
                <Field className="w-auto">
                  <FieldLabel htmlFor="bot-rule-action-select">它应该:</FieldLabel>
                  <NativeSelect
                    id="bot-rule-action-select"
                    value={draftAction}
                    disabled={busy}
                    onChange={(e) => setDraftAction(e.target.value as "ask_first" | "auto_allow")}
                  >
                    <NativeSelectOption value="auto_allow">自动允许</NativeSelectOption>
                    <NativeSelectOption value="ask_first">先询问</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Button
                  type="button"
                  disabled={busy || !draftWhen.trim()}
                  onClick={() => addRule()}
                >
                  添加规则
                </Button>
              </div>
              {rules.length > 0 ? (
                <ul className="bot-rule-list m-0 flex list-none flex-col gap-2 p-0">
                  {rules.map((r) => (
                    <li key={r.id} className="bot-rule-item flex flex-wrap items-center gap-2">
                      <span className="bot-rule-item-when">当 bot 想要「{r.when}」</span>
                      <span className="bot-rule-item-action">
                        {r.action === "ask_first" ? "先询问" : "自动允许"}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => removeRule(r.id)}
                      >
                        删除
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <FieldDescription>
                  暂无自定义规则；内置 deny / auto / confirm 档位仍生效。
                </FieldDescription>
              )}
            </div>
          ) : (
            <FieldDescription>
              已关闭：除硬拒绝外，本机/远程写删等操作都会先询问你。当前有效时区：
              {effectiveTimezone({
                timezone,
                auto_review_enabled: autoReview,
                auto_review_rules: rules,
              })}
              （{tzLabel}）
            </FieldDescription>
          )}
          {msg ? <p className="settings-status m-0">{msg}</p> : null}
        </FieldGroup>
      </SettingsCard>
    </SettingsSection>
  );
}
