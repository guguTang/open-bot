import { Button, Card, Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { Routine, RoutineInput } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatDateTime } from "@/lib/format";

/**
 * 例行任务。与 Web 端 `settingsTab === "routines"` 对齐：
 * 列表 + 启停 + 立即运行 + 删除 + 新建表单。
 *
 * 调度器跑在 API 进程里，每分钟检查一次；这里只是配置面，
 * 所以「立即运行」是唯一能看到真实产出的入口，必须把 run 的结果展示清楚。
 */

const DEFAULT_CRON = "0 9 * * *";

const EMPTY_FORM: RoutineInput = {
  name: "",
  prompt: "",
  schedule_cron: DEFAULT_CRON,
  enabled: true,
};

type FormErrors = {
  name?: string;
  prompt?: string;
  cron?: string;
};

/**
 * Cron 只校验「5 个字段」这一件事（分 时 日 月 周）。
 *
 * 不去逐字段校验取值范围：服务端已经会校验并返回可读错误，
 * 前端再实现一遍 rob/dom 解析器只会和后端漂移，不如把判断权留给唯一事实来源。
 */
function validateCron(cron: string): string | null {
  const fields = cron.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) return `Cron 需要 5 个字段（分 时 日 月 周），当前 ${fields.length} 个`;
  return null;
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function RoutinesScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  /** 立即运行后展示的 { status, result_text }，列表里的 last_run 之外再单独回显一次 */
  const [lastRun, setLastRun] = useState<{ name: string; status: string; text: string } | null>(
    null
  );
  /** 正在跑立即运行的任务 id，用来单独禁用那一个按钮 */
  const [runningId, setRunningId] = useState<string | null>(null);

  const [form, setForm] = useState<RoutineInput>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      setRoutines(await api.listRoutines());
    } catch (err) {
      setError(errText(err, "加载例行任务失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    const name = form.name.trim();
    const prompt = form.prompt.trim();
    // 留空时回落默认 cron，和 Web 端 saveRoutine 一致
    const cron = form.schedule_cron.trim() || DEFAULT_CRON;

    const errors: FormErrors = {};
    if (!name) errors.name = "请填写名称";
    if (!prompt) errors.prompt = "请填写 Prompt";
    const cronErr = validateCron(cron);
    if (cronErr) errors.cron = cronErr;
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setMsg("");
    try {
      await api.createRoutine({
        name,
        prompt,
        schedule_cron: cron,
        enabled: form.enabled !== false,
      });
      setForm(EMPTY_FORM);
      await load();
      setMsg("已创建");
    } catch (err) {
      setMsg(errText(err, "创建失败"));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(routine: Routine, enabled: boolean): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      await api.updateRoutine(routine.id, { enabled });
      await load();
    } catch (err) {
      setMsg(errText(err, "更新失败"));
    } finally {
      setBusy(false);
    }
  }

  async function runNow(routine: Routine): Promise<void> {
    setRunningId(routine.id);
    setMsg("运行中…");
    setLastRun(null);
    try {
      const res = await api.runRoutine(routine.id);
      await load();
      // run.result_text 才是用户真正想看的「跑出了什么」，状态只是标签
      setLastRun({
        name: routine.name,
        status: res.run.status,
        text: res.run.result_text,
      });
      setMsg(`运行完成：${res.run.status}`);
    } catch (err) {
      setMsg(errText(err, "运行失败"));
    } finally {
      setRunningId(null);
    }
  }

  async function remove(routine: Routine): Promise<void> {
    const ok = await confirm({
      title: "删除例行任务？",
      message: `「${routine.name}」将不再按计划自动执行，删除后无法恢复。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    setMsg("");
    try {
      await api.deleteRoutine(routine.id);
      if (lastRun?.name === routine.name) setLastRun(null);
      await load();
      setMsg(`已删除「${routine.name}」`);
    } catch (err) {
      setMsg(errText(err, "删除失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenScaffold
      title="例行任务"
      subtitle="定时自动执行"
      loading={loading}
      error={error}
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
        5 字段 cron（分 时 日 月 周）。调度器运行在 API 进程内，每分钟检查一次；
        使用指定助手（缺省为你的第一个助手）与默认 LLM。立即运行会写入运行记录。
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
                  cron {r.schedule_cron}
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
                    variant="danger-soft"
                    className="flex-1"
                    isDisabled={busy}
                    onPress={() => void remove(r)}
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
        <SectionTitle>新建例行任务</SectionTitle>

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

        <FormField
          label="Cron（5 字段）"
          required
          value={form.schedule_cron}
          onChangeText={(schedule_cron) => setForm({ ...form, schedule_cron })}
          placeholder={DEFAULT_CRON}
          error={formErrors.cron}
          hint="分 时 日 月 周，例：0 9 * * * 表示每天 9:00"
        />

        <SwitchRow
          label="创建后启用"
          value={form.enabled !== false}
          onValueChange={(enabled) => setForm({ ...form, enabled })}
        />

        {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}

        <View className="flex-row gap-2">
          <Button size="sm" className="flex-1" isDisabled={busy} onPress={() => void submit()}>
            <Button.Label>{busy ? "处理中…" : "创建"}</Button.Label>
          </Button>
          <Button size="sm" variant="secondary" className="flex-1" onPress={refresh}>
            <Button.Label>刷新</Button.Label>
          </Button>
        </View>
      </View>
    </ScreenScaffold>
  );
}
