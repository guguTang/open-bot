import { Button, Card, Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import type { InboundHook, Routine, RoutineInput } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { errText } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import {
  useAgents,
  useBusy,
  useInboundHookMutations,
  useInboundHooks,
  useRoutineMutations,
  useRoutines,
} from "@/queries";

/**
 * 例行任务 + 入站 Webhook。与 Web 端 `settingsTab === "routines"` 对齐：
 * 任务列表 + 启停 + 立即运行 + 删除 + 新建/编辑表单，以及入站 Hook 区块。
 *
 * 与 Web 的一处结构差异：Web 只有「新建」，改配置得删了重建。
 * 这里把同一个表单复用来做「编辑」——`editingId` 有值时按钮从「创建」变「保存」，
 * 提交走 `updateRoutine` 而不是 `createRoutine`。移动端表单在列表下方，
 * 来回滚动比 Web 的单页表单更贵，能改就别逼用户删了重建。
 */

const DEFAULT_CRON = "0 9 * * *";
const DEFAULT_TZ = "Asia/Shanghai";

const EMPTY_FORM: RoutineInput = {
  name: "",
  prompt: "",
  schedule_cron: DEFAULT_CRON,
  enabled: true,
  agent_id: "",
  timezone: DEFAULT_TZ,
  triggers_json: "[]",
  quiet_unchanged: false,
};

/** 常用时区，与「审核与时区」页同一份口径（Web 端 COMMON_TIMEZONES 的子集）。 */
const TIMEZONES = [
  { value: "", label: "自动（跟随用户设置）" },
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

type FormErrors = {
  name?: string;
  prompt?: string;
  cron?: string;
  triggers?: string;
};

/**
 * Cron 只校验「5 个字段」这一件事（分 时 日 月 周）。
 *
 * 不去逐字段校验取值范围：服务端已经会校验并返回可读错误，
 * 前端再实现一遍 rob/dom 解析器只会和后端漂移，不如把判断权留给唯一事实来源。
 * 纯事件触发的任务允许留空 —— Web 端 cron 字段就允许空（label 也写了「纯事件可留空」）。
 */
function validateCron(cron: string): string | null {
  const fields = cron.trim().split(/\s+/).filter(Boolean);
  if (fields.length === 0) return null;
  if (fields.length !== 5) return `Cron 需要 5 个字段（分 时 日 月 周），当前 ${fields.length} 个`;
  return null;
}

/** 事件触发器是用户手写的 JSON，这里只挡「根本不是 JSON」这一类错误。 */
function validateTriggers(json: string): string | null {
  const raw = json.trim();
  if (!raw) return null;
  try {
    JSON.parse(raw);
    return null;
  } catch {
    return "事件触发器不是合法 JSON";
  }
}

export default function RoutinesScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [msg, setMsg] = useState("");
  const [hooksMsg, setHooksMsg] = useState("");
  /** 立即运行后展示的 { status, result_text }，列表里的 last_run 之外再单独回显一次 */
  const [lastRun, setLastRun] = useState<{ name: string; status: string; text: string } | null>(
    null
  );

  const [form, setForm] = useState<RoutineInput>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  /** 正在编辑的任务 id；null = 新建 */
  const [editingId, setEditingId] = useState<string | null>(null);

  // 三个列表各自一把键：原来是一个 Promise.all 一起取一起失败，
  // 现在保持同样的口径（任一失败整页报错），但只重取真正变了的那把。
  const routinesQuery = useRoutines();
  const agentsQuery = useAgents();
  const hooksQuery = useInboundHooks();
  const routines = routinesQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const hooks = hooksQuery.data ?? [];

  const routinesMut = useRoutineMutations();
  const hooksMut = useInboundHookMutations();
  const busy = useBusy(
    routinesMut.create,
    routinesMut.update,
    routinesMut.remove,
    hooksMut.create,
    hooksMut.remove
  );
  /** 正在跑立即运行的任务 id，用来单独禁用那一个按钮（原来也是只禁一个）。 */
  const runningId = routinesMut.run.isPending ? (routinesMut.run.variables ?? null) : null;

  /** 三个列表中第一个失败的那个：与原来 Promise.all 整页报错的观感一致。 */
  const loadError = routinesQuery.error ?? agentsQuery.error ?? hooksQuery.error;

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    // 依赖 data 而不是上面那个 `agents ?? []`：后者每次渲染都是新数组，
    // 挂进依赖里等于每次重算这张表。
    for (const a of agentsQuery.data ?? []) m.set(a.id, a.name);
    return m;
  }, [agentsQuery.data]);

  const refresh = () => {
    void Promise.all([routinesQuery.refetch(), agentsQuery.refetch(), hooksQuery.refetch()]);
  };

  /** 现有任务 → 表单。triggers_json 优先用服务端原文，回落到 triggers 序列化。 */
  function formFromRoutine(r: Routine): RoutineInput {
    return {
      name: r.name,
      prompt: r.prompt,
      schedule_cron: r.schedule_cron || "",
      enabled: r.enabled,
      agent_id: r.agent_id || "",
      timezone: r.timezone || "",
      triggers_json: r.triggers_json || (r.triggers?.length ? JSON.stringify(r.triggers) : "[]"),
      quiet_unchanged: Boolean(r.quiet_unchanged),
    };
  }

  function startEdit(routine: Routine): void {
    setEditingId(routine.id);
    setForm(formFromRoutine(routine));
    setFormErrors({});
    setMsg("");
  }

  function cancelEdit(): void {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setMsg("");
  }

  async function submit(): Promise<void> {
    const name = form.name.trim();
    const prompt = form.prompt.trim();
    const cron = form.schedule_cron.trim();
    const triggers = form.triggers_json?.trim() || "[]";

    const errors: FormErrors = {};
    if (!name) errors.name = "请填写名称";
    if (!prompt) errors.prompt = "请填写 Prompt";
    const cronErr = validateCron(cron);
    if (cronErr) errors.cron = cronErr;
    const triggersErr = validateTriggers(triggers);
    if (triggersErr) errors.triggers = triggersErr;
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const payload: RoutineInput = {
      name,
      prompt,
      schedule_cron: cron,
      enabled: form.enabled !== false,
      ...(form.agent_id ? { agent_id: form.agent_id } : {}),
      ...(form.timezone ? { timezone: form.timezone } : {}),
      triggers_json: triggers,
      quiet_unchanged: Boolean(form.quiet_unchanged),
    };

    setMsg("");
    try {
      if (editingId) {
        await routinesMut.update.mutateAsync({ id: editingId, body: payload });
        setMsg(`已更新「${name}」`);
      } else {
        await routinesMut.create.mutateAsync(payload);
        setMsg("已创建");
      }
      cancelEdit();
    } catch (err) {
      setMsg(errText(err, editingId ? "更新失败" : "创建失败"));
    }
  }

  async function toggle(routine: Routine, enabled: boolean): Promise<void> {
    setMsg("");
    try {
      await routinesMut.update.mutateAsync({ id: routine.id, body: { enabled } });
    } catch (err) {
      setMsg(errText(err, "更新失败"));
    }
  }

  async function runNow(routine: Routine): Promise<void> {
    setMsg("运行中…");
    setLastRun(null);
    try {
      const res = await routinesMut.run.mutateAsync(routine.id);
      // run.result_text 才是用户真正想看的「跑出了什么」，状态只是标签
      setLastRun({
        name: routine.name,
        status: res.run.status,
        text: res.run.result_text,
      });
      setMsg(`运行完成：${res.run.status}`);
    } catch (err) {
      setMsg(errText(err, "运行失败"));
    }
  }

  async function removeRoutine(routine: Routine): Promise<void> {
    const ok = await confirm({
      title: "删除例行任务？",
      message: `「${routine.name}」将不再按计划自动执行，删除后无法恢复。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setMsg("");
    try {
      await routinesMut.remove.mutateAsync(routine.id);
      if (lastRun?.name === routine.name) setLastRun(null);
      // 删掉的正好在编辑：表单退回新建态，别留在已经没了的 id 上
      if (editingId === routine.id) cancelEdit();
      setMsg(`已删除「${routine.name}」`);
    } catch (err) {
      setMsg(errText(err, "删除失败"));
    }
  }

  async function createHook(): Promise<void> {
    setHooksMsg("");
    try {
      // provider 固定 any：一个 Hook 同时接 Slack 与 GitHub 事件，
      // 与 Web 端 createInboundHook({provider:"any"}) 一致
      const h = await hooksMut.create.mutateAsync({ provider: "any", label: "默认入站" });
      setHooksMsg(`已创建 Hook：${h.label || h.provider}`);
    } catch (err) {
      setHooksMsg(errText(err, "创建 Hook 失败"));
    }
  }

  async function removeHook(hook: InboundHook): Promise<void> {
    const ok = await confirm({
      title: "删除这个入站 Hook？",
      message: `「${hook.label || hook.provider}」的回调地址会立即失效，依赖它的事件触发也不再送达。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setHooksMsg("");
    try {
      await hooksMut.remove.mutateAsync(hook.id);
      setHooksMsg("已删除 Hook");
    } catch (err) {
      setHooksMsg(errText(err, "删除 Hook 失败"));
    }
  }

  return (
    <ScreenScaffold
      title="例行任务"
      subtitle="定时自动执行"
      loading={routinesQuery.isLoading}
      error={loadError ? errText(loadError, "加载例行任务失败") : null}
      empty={
        routines.length === 0 ? (
          <EmptyState
            icon="timer-outline"
            title="还没有例行任务"
            hint="在下方填写名称、Prompt 和 Cron，创建第一个定时任务"
          />
        ) : undefined
      }
      onRetry={refresh}
      headerRight={
        <Button size="sm" variant="secondary" onPress={refresh}>
          <Button.Label>刷新</Button.Label>
        </Button>
      }
    >
      <Typography.Paragraph color="muted">
        5 字段 cron（分 时 日 月 周），纯事件触发可留空。调度器运行在 API 进程内，每分钟检查一次；
        缺省使用你的第一个助手与默认 LLM。立即运行会写入运行记录。
      </Typography.Paragraph>

      {routines.length > 0 ? (
        <View className="gap-3">
          <SectionTitle>已创建（{routines.length}）</SectionTitle>
          {routines.map((r) => (
            <Card key={r.id}>
              <Card.Body className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Typography.Paragraph weight="medium" className="flex-1">
                    {r.name}
                  </Typography.Paragraph>
                  <Chip size="sm" variant="soft" color={r.enabled ? "success" : "default"}>
                    <Chip.Label>{r.enabled ? "启用" : "停用"}</Chip.Label>
                  </Chip>
                </View>

                <Typography.Paragraph type="body-sm" color="muted">
                  Bot: {agentNameById.get(r.agent_id) || r.agent_id || "—"}
                  {" · "}
                  cron {r.schedule_cron || "（无）"}
                  {" · "}
                  {r.timezone || DEFAULT_TZ}
                  {r.triggers && r.triggers.length ? ` · 事件 ${r.triggers.length}` : ""}
                  {r.conversation_id ? " · 已绑定会话" : ""}
                  {r.last_run_at ? ` · 上次 ${formatDateTime(r.last_run_at)}` : ""}
                </Typography.Paragraph>

                <Typography.Paragraph type="body-sm" color="muted">
                  {r.prompt.length > 120 ? `${r.prompt.slice(0, 120)}…` : r.prompt}
                </Typography.Paragraph>

                {r.last_run ? (
                  <View className="gap-1 rounded-xl bg-background-secondary p-3">
                    <Typography.Paragraph type="body-sm" color="muted">
                      [{r.last_run.status}] · {formatDateTime(r.last_run.created_at)}
                    </Typography.Paragraph>
                    {r.last_run.result_text ? (
                      <Typography type="code" className="text-body-xs">
                        {r.last_run.result_text}
                      </Typography>
                    ) : null}
                  </View>
                ) : null}

                <SwitchRow
                  label="启用"
                  description="关闭后调度器会跳过这个任务"
                  value={r.enabled}
                  disabled={busy}
                  onValueChange={(next) => void toggle(r, next)}
                />

                <View className="flex-row gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    isDisabled={runningId !== null}
                    onPress={() => void runNow(r)}
                  >
                    <Button.Label>{runningId === r.id ? "运行中…" : "立即运行"}</Button.Label>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    isDisabled={busy}
                    onPress={() => startEdit(r)}
                  >
                    <Button.Label>编辑</Button.Label>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    className="flex-1"
                    isDisabled={busy}
                    onPress={() => void removeRoutine(r)}
                  >
                    <Button.Label>删除</Button.Label>
                  </Button>
                </View>
              </Card.Body>
            </Card>
          ))}
        </View>
      ) : null}

      {lastRun ? (
        <View className="gap-2">
          <SectionTitle>最近一次立即运行</SectionTitle>
          <Card>
            <Card.Body className="gap-2">
              <Typography.Paragraph weight="medium">
                {lastRun.name} · {lastRun.status}
              </Typography.Paragraph>
              {lastRun.text ? (
                <Typography type="code" className="text-body-xs">
                  {lastRun.text}
                </Typography>
              ) : (
                <Typography.Paragraph type="body-sm" color="muted">
                  本次运行没有输出内容
                </Typography.Paragraph>
              )}
            </Card.Body>
          </Card>
        </View>
      ) : null}

      <View className="gap-3">
        <SectionTitle>{editingId ? "编辑例行任务" : "新建例行任务"}</SectionTitle>

        <FormField
          label="名称"
          required
          value={form.name}
          onChangeText={(name) => setForm({ ...form, name })}
          placeholder="每日早报"
          error={formErrors.name}
        />

        <FormField
          label="Prompt"
          required
          multiline
          value={form.prompt}
          onChangeText={(prompt) => setForm({ ...form, prompt })}
          placeholder="汇总我今天关注的事项，输出一段简报"
          error={formErrors.prompt}
          hint="任务触发时会把这段话原样交给助手"
        />

        {agents.length > 0 ? (
          <View className="gap-2">
            <SectionTitle>所属 Bot</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2 pr-2">
                {agents.map((a) => (
                  <Chip
                    key={a.id}
                    size="sm"
                    variant={form.agent_id === a.id ? "soft" : "secondary"}
                    color={form.agent_id === a.id ? "accent" : "default"}
                    disabled={busy}
                    onPress={() => setForm({ ...form, agent_id: a.id })}
                    accessibilityRole="button"
                    accessibilityLabel={a.name}
                  >
                    <Chip.Label>{a.name}</Chip.Label>
                  </Chip>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <FormField
          label="Cron（5 字段，纯事件可留空）"
          value={form.schedule_cron}
          onChangeText={(schedule_cron) => setForm({ ...form, schedule_cron })}
          placeholder={DEFAULT_CRON}
          error={formErrors.cron}
          hint="分 时 日 月 周，例：0 9 * * * 表示每天 9:00"
        />

        <View className="gap-2">
          <SectionTitle>时区（IANA）</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2 pr-2">
              {TIMEZONES.map((tz) => (
                <Chip
                  key={tz.value || "auto"}
                  size="sm"
                  variant={(form.timezone ?? "") === tz.value ? "soft" : "secondary"}
                  color={(form.timezone ?? "") === tz.value ? "accent" : "default"}
                  disabled={busy}
                  onPress={() => setForm({ ...form, timezone: tz.value })}
                  accessibilityRole="button"
                  accessibilityLabel={tz.label}
                >
                  <Chip.Label>{tz.label}</Chip.Label>
                </Chip>
              ))}
            </View>
          </ScrollView>
        </View>

        <FormField
          label="事件触发器 JSON"
          multiline
          value={form.triggers_json ?? "[]"}
          onChangeText={(triggers_json) => setForm({ ...form, triggers_json })}
          placeholder='[{"source":"slack","type":"app_mention"}]'
          error={formErrors.triggers}
          hint="需要 Slack / GitHub 事件唤醒时填；先在下方创建入站 Hook"
        />

        <SwitchRow
          label="结果无变化时静默"
          description="本次运行与上次输出一致时不发消息"
          value={Boolean(form.quiet_unchanged)}
          onValueChange={(quiet_unchanged) => setForm({ ...form, quiet_unchanged })}
        />

        <SwitchRow
          label="创建后启用"
          value={form.enabled !== false}
          onValueChange={(enabled) => setForm({ ...form, enabled })}
        />

        {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}

        <View className="flex-row gap-2">
          <Button size="sm" className="flex-1" isDisabled={busy} onPress={() => void submit()}>
            <Button.Label>{busy ? "处理中…" : editingId ? "保存" : "创建"}</Button.Label>
          </Button>
          {editingId ? (
            <Button size="sm" variant="secondary" className="flex-1" onPress={cancelEdit}>
              <Button.Label>取消编辑</Button.Label>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" className="flex-1" onPress={refresh}>
              <Button.Label>刷新</Button.Label>
            </Button>
          )}
        </View>
      </View>

      <View className="gap-3">
        <SectionTitle>入站 Webhook（Slack / GitHub）</SectionTitle>
        <Typography.Paragraph color="muted">
          创建 Hook 后把返回的 URL 配到 Slack Event Subscriptions 或 GitHub Webhooks。 例行任务的
          triggers 匹配事件后，会在绑定会话中唤醒助手。
        </Typography.Paragraph>

        {hooks.length === 0 ? (
          <Typography.Paragraph color="muted">暂无 Hook。点击下方创建。</Typography.Paragraph>
        ) : (
          <View className="gap-3">
            {hooks.map((h) => (
              <Card key={h.id}>
                <Card.Body className="gap-2">
                  <View className="flex-row items-center gap-2">
                    <Typography.Paragraph weight="medium" className="flex-1">
                      {h.label || h.provider}
                    </Typography.Paragraph>
                    <Button
                      size="sm"
                      variant="danger-soft"
                      isDisabled={busy}
                      onPress={() => void removeHook(h)}
                    >
                      <Button.Label>删除</Button.Label>
                    </Button>
                  </View>
                  <Typography.Paragraph type="body-sm" color="muted">
                    Slack: {h.url_slack || "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-sm" color="muted">
                    GitHub: {h.url_github || "—"}
                  </Typography.Paragraph>
                  <Typography.Paragraph type="body-sm" color="muted">
                    token: {h.token}
                  </Typography.Paragraph>
                  {h.hint ? (
                    <Typography.Paragraph type="body-sm" color="muted">
                      {h.hint}
                    </Typography.Paragraph>
                  ) : null}
                </Card.Body>
              </Card>
            ))}
          </View>
        )}

        {hooksMsg ? <Typography.Paragraph color="muted">{hooksMsg}</Typography.Paragraph> : null}

        <Button size="sm" isDisabled={busy} onPress={() => void createHook()}>
          <Button.Label>创建 Hook</Button.Label>
        </Button>
      </View>
    </ScreenScaffold>
  );
}
