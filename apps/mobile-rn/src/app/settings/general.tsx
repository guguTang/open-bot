import { Button, Card, Chip, Typography } from "heroui-native";
import * as Clipboard from "expo-clipboard";
import type { JSX } from "react";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import type { AutoReviewRule } from "@/api/types";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { useSession } from "@/providers/session";
import { useUserSettings, useUserSettingsMutations } from "@/queries";

/**
 * 审核与时区。对齐 Web 端 `settingsTab === "general"` 的 `GeneralBotSettings`
 * （`apps/web/src/components/GeneralBotSettings.tsx`）：时区 + 自动审核 + 审核规则。
 *
 * Web 端这一分区还兼作全局「账号」信息位，RN 的账号信息在设置首页只读展示，
 * 但复制邮箱在移动端是高频需求（要贴到工单 / 聊天里），所以这里补一张账户卡。
 *
 * 结构差异：Web 每个字段变更即 `persist`（保存一次就写一次接口），
 * 这里沿用同样的「改即存」语义 —— 这些是开关和下拉，没有草稿态的概念，
 * 加一层「待保存」反而会让人以为不点保存就不生效。
 */

/** 与 Web 端 `apps/web/src/lib/userSettings.ts` 的 COMMON_TIMEZONES 保持一致。 */
const TIMEZONES: { value: string; label: string }[] = [
  { value: "", label: "自动检测" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai（中国）" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Paris", label: "Europe/Paris" },
];

const ACTIONS = [
  { value: "auto_allow" as const, label: "自动允许" },
  { value: "ask_first" as const, label: "先询问" },
];

/** 本机时区。Hermes 未开 Intl 时退回默认值，与 Web 端 detectBrowserTimezone 同策略。 */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

/**
 * 规则 id。RN 上 `crypto.randomUUID` 不保证可用（Hermes 只在开 Intl/完整 WebCrypto 时给），
 * 和 `@/api/client` 的 makeUuid 一样做时间戳 + 随机串兜底。
 */
function newRuleId(): string {
  try {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  } catch {
    /* 落到兜底 */
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function GeneralSettingsScreen(): JSX.Element {
  const { user } = useSession();

  const [draftWhen, setDraftWhen] = useState("");
  const [draftAction, setDraftAction] = useState<AutoReviewRule["action"]>("ask_first");
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");

  const detected = detectTimezone();

  // 设置本身是服务端状态；保存走 mutation，成功回调把整份回读结果写回缓存。
  const settingsQuery = useUserSettings();
  const { update } = useUserSettingsMutations();
  const busy = update.isPending;
  const settings = settingsQuery.data ?? null;

  async function persist(
    patch: {
      timezone?: string;
      auto_review_enabled?: boolean;
      auto_review_rules?: AutoReviewRule[];
    },
    okMsg: string
  ): Promise<void> {
    setMsg("");
    try {
      // 整份读回，避免本地 state 与服务端（比如并发在另一端改过）漂移
      await update.mutateAsync(patch);
      setMsg(okMsg);
    } catch (err) {
      setMsg(errText(err, "保存失败"));
    }
  }

  function addRule(): void {
    const when = draftWhen.trim();
    if (!when || !settings) return;
    setDraftWhen("");
    void persist(
      {
        auto_review_rules: [
          ...settings.auto_review_rules,
          { id: newRuleId(), when, action: draftAction },
        ],
      },
      "已添加规则"
    );
  }

  function removeRule(id: string): void {
    if (!settings) return;
    void persist(
      { auto_review_rules: settings.auto_review_rules.filter((r) => r.id !== id) },
      "已删除规则"
    );
  }

  async function copyEmail(): Promise<void> {
    const email = user?.email;
    if (!email) return;
    try {
      await Clipboard.setStringAsync(email);
      setCopied(true);
      setMsg(`已复制邮箱 ${email}`);
    } catch (err) {
      setMsg(errText(err, "复制失败"));
    }
  }

  const timezone = settings?.timezone ?? "";
  const autoReview = settings ? settings.auto_review_enabled !== false : true;
  const rules = Array.isArray(settings?.auto_review_rules) ? settings.auto_review_rules : [];

  return (
    <ScreenScaffold
      title="审核与时区"
      subtitle="操作审批规则与时间基准"
      loading={settingsQuery.isLoading}
      error={settingsQuery.error ? errText(settingsQuery.error, "加载设置失败") : null}
      onRetry={() => void settingsQuery.refetch()}
    >
      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>账户</SectionTitle>
          <View className="gap-1 px-1">
            <View className="flex-row items-center gap-3">
              <Typography.Paragraph color="muted" className="w-16 text-sm">
                用户名
              </Typography.Paragraph>
              <Typography.Paragraph className="flex-1" weight="medium">
                {user?.username ?? "—"}
              </Typography.Paragraph>
            </View>
            <View className="flex-row items-center gap-3">
              <Typography.Paragraph color="muted" className="w-16 text-sm">
                邮箱
              </Typography.Paragraph>
              <Typography.Paragraph className="flex-1" weight="medium" numberOfLines={1}>
                {user?.email || "未绑定"}
              </Typography.Paragraph>
              {/* 没邮箱就不给按钮：点了没反应比没有更糟 */}
              {user?.email ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void copyEmail()}
                  accessibilityLabel="复制邮箱"
                >
                  <Button.Label>{copied ? "已复制" : "复制邮箱"}</Button.Label>
                </Button>
              ) : null}
            </View>
          </View>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>时区</SectionTitle>
          <Typography.Paragraph color="muted" className="text-xs">
            用于报告时间与例行任务。选择「自动检测」则跟随本机系统时区（当前 {detected}）。
          </Typography.Paragraph>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2 pr-2">
              {TIMEZONES.map((z) => {
                const selected = timezone === z.value;
                return (
                  <Chip
                    key={z.value || "auto"}
                    size="sm"
                    variant={selected ? "soft" : "secondary"}
                    color={selected ? "accent" : "default"}
                    disabled={busy}
                    onPress={() => void persist({ timezone: z.value }, "已保存时区")}
                    accessibilityRole="button"
                    accessibilityLabel={z.label}
                  >
                    <Chip.Label>
                      {z.value === "" ? `${z.label}（${detected}）` : z.label}
                    </Chip.Label>
                  </Chip>
                );
              })}
              {/* 服务端存了个不在常用列表里的时区，也要能选回它，否则用户改不回去 */}
              {timezone && !TIMEZONES.some((z) => z.value === timezone) ? (
                <Chip
                  size="sm"
                  variant="soft"
                  color="accent"
                  disabled={busy}
                  onPress={() => void persist({ timezone }, "已保存时区")}
                >
                  <Chip.Label>{timezone}</Chip.Label>
                </Chip>
              ) : null}
            </View>
          </ScrollView>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>自动审核</SectionTitle>

          <SwitchRow
            label="自动审核总开关"
            description="每次执行操作前先检查，必要时询问你"
            value={autoReview}
            disabled={busy}
            onValueChange={(on) => void persist({ auto_review_enabled: on }, "已保存审核开关")}
          />

          {autoReview ? (
            <>
              <Typography.Paragraph color="muted" className="text-xs">
                这些规则仅对你生效。内置安全检查始终有效，冲突时「先询问」优先于「自动允许」。
                匹配的是关键词/意图（工具名 + 命令预览 + 原因），不是对话模型自行批准。
              </Typography.Paragraph>

              <View className="gap-3">
                <FormField
                  label="当 Bot 想要"
                  value={draftWhen}
                  onChangeText={setDraftWhen}
                  placeholder="替我回复邮件 / 本机只读命令"
                  editable={!busy}
                />

                <View className="gap-2">
                  <SectionTitle>它应该</SectionTitle>
                  <View className="flex-row gap-2">
                    {ACTIONS.map((opt) => (
                      <Chip
                        key={opt.value}
                        size="sm"
                        variant={draftAction === opt.value ? "soft" : "secondary"}
                        color={draftAction === opt.value ? "accent" : "default"}
                        disabled={busy}
                        onPress={() => setDraftAction(opt.value)}
                        accessibilityRole="button"
                        accessibilityLabel={opt.label}
                      >
                        <Chip.Label>{opt.label}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                </View>

                <Button
                  isDisabled={busy || !draftWhen.trim()}
                  onPress={addRule}
                  accessibilityLabel="添加规则"
                >
                  <Button.Label>{busy ? "处理中…" : "添加规则"}</Button.Label>
                </Button>
              </View>

              {rules.length === 0 ? (
                <Typography.Paragraph color="muted" className="text-xs">
                  暂无自定义规则；内置 deny / auto / confirm 档位仍生效。
                </Typography.Paragraph>
              ) : (
                <View className="gap-2">
                  {rules.map((r) => (
                    <View
                      key={r.id}
                      className="flex-row items-center gap-3 rounded-xl bg-background-secondary px-3 py-2.5"
                    >
                      <View className="flex-1 gap-0.5">
                        <Typography.Paragraph className="text-sm">
                          当 Bot 想要「{r.when}」
                        </Typography.Paragraph>
                        <Typography.Paragraph color="muted" className="text-xs">
                          {r.action === "ask_first" ? "先询问" : "自动允许"}
                        </Typography.Paragraph>
                      </View>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        isDisabled={busy}
                        onPress={() => removeRule(r.id)}
                        accessibilityLabel={`删除规则 ${r.when}`}
                      >
                        <Button.Label>删除</Button.Label>
                      </Button>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <Typography.Paragraph color="muted" className="text-xs">
              已关闭：除硬拒绝外，本机/远程写删等操作都会先询问你。
            </Typography.Paragraph>
          )}
        </Card.Body>
      </Card>

      {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}
    </ScreenScaffold>
  );
}
