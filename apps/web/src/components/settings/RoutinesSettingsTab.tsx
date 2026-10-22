import type { FormEvent } from "react";
import type { Agent, InboundHook, Routine, RoutineInput } from "../../api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type RoutinesSettingsTabProps = {
  routines: Routine[];
  routinesBusy: boolean;
  routinesMsg: string;
  routineForm: RoutineInput;
  setRoutineForm: (v: RoutineInput) => void;
  agents: Agent[];
  agentId: string;
  agentNameById: Map<string, string>;
  inboundHooks: InboundHook[];
  hooksMsg: string;
  onSaveRoutine: (e: FormEvent) => void | Promise<void>;
  onToggleRoutine: (routine: Routine, enabled: boolean) => void | Promise<void>;
  onRunRoutineNow: (id: string) => void | Promise<void>;
  onRemoveRoutine: (id: string) => void | Promise<void>;
  onRefreshRoutines: () => void | Promise<void>;
  onDeleteInboundHook: (id: string) => void | Promise<void>;
  onCreateInboundHook: () => void | Promise<void>;
};

export function RoutinesSettingsTab({
  routines,
  routinesBusy,
  routinesMsg,
  routineForm,
  setRoutineForm,
  agents,
  agentId,
  agentNameById,
  inboundHooks,
  hooksMsg,
  onSaveRoutine,
  onToggleRoutine,
  onRunRoutineNow,
  onRemoveRoutine,
  onRefreshRoutines,
  onDeleteInboundHook,
  onCreateInboundHook,
}: RoutinesSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsHint>
        例行任务绑定所属 Bot，触发后复用固定会话并注入 [routine] 提示。支持 IANA 时区 cron，以及 Slack / GitHub 事件唤醒（需先创建入站 Hook）。可在聊天里用工具创建/暂停/恢复。
      </SettingsHint>
      <SettingsSection title="任务列表">
        <SettingsCard>
          <div className="llm-list">
            {routines.length === 0 ? (
              <SettingsEmpty>暂无例行任务。</SettingsEmpty>
            ) : (
              routines.map((r) => (
                <div key={r.id} className="llm-item">
                  <div className="min-w-0 flex-1">
                    <div className="agent-name">
                      {r.name}
                      {r.enabled ? <span className="tag">启用</span> : <span className="tag">停用</span>}
                    </div>
                    <div className="agent-desc">
                      Bot: {agentNameById.get(r.agent_id) || r.agent_id || "—"}
                      {" · "}
                      cron: {r.schedule_cron || "（无）"}
                      {" · "}
                      {r.timezone || "Asia/Shanghai"}
                      {r.triggers && r.triggers.length
                        ? ` · 事件 ${r.triggers.length}`
                        : ""}
                      {r.conversation_id ? " · 已绑定会话" : ""}
                      {r.last_run_at ? ` · 上次 ${r.last_run_at}` : ""}
                    </div>
                    <div className="agent-desc mt-1">
                      prompt: {r.prompt.slice(0, 120)}
                      {r.prompt.length > 120 ? "…" : ""}
                    </div>
                    {r.last_run ? (
                      <pre className="settings-status mt-2 max-h-40">
                        [{r.last_run.status}] {r.last_run.result_text}
                      </pre>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Field orientation="horizontal" className="w-auto gap-2">
                      <Switch
                        id={`routine-enabled-${r.id}`}
                        checked={r.enabled}
                        disabled={routinesBusy}
                        onCheckedChange={(checked) => void onToggleRoutine(r, checked)}
                      />
                      <FieldLabel htmlFor={`routine-enabled-${r.id}`} className="font-normal">
                        启用
                      </FieldLabel>
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void onRunRoutineNow(r.id)}
                      disabled={routinesBusy}
                    >
                      立即运行
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void onRemoveRoutine(r.id)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="新建例行任务">
        <SettingsCard padded>
          <form onSubmit={onSaveRoutine}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="routine-name">名称</FieldLabel>
                <Input
                  id="routine-name"
                  value={routineForm.name}
                  onChange={(e) => setRoutineForm({ ...routineForm, name: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="routine-prompt">Prompt</FieldLabel>
                <Textarea
                  id="routine-prompt"
                  rows={3}
                  value={routineForm.prompt}
                  onChange={(e) => setRoutineForm({ ...routineForm, prompt: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="routine-agent">所属 Bot</FieldLabel>
                <Select
                  value={routineForm.agent_id || agentId || ""}
                  onValueChange={(next) => setRoutineForm({ ...routineForm, agent_id: next })}
                  disabled={agents.length === 0}
                >
                  <SelectTrigger id="routine-agent">
                    <SelectValue placeholder={agents.length === 0 ? "暂无 Bot" : "选择 Bot"} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="routine-cron">Cron（5 字段，纯事件可留空）</FieldLabel>
                <Input
                  id="routine-cron"
                  value={routineForm.schedule_cron}
                  onChange={(e) => setRoutineForm({ ...routineForm, schedule_cron: e.target.value })}
                  placeholder="0 9 * * *"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="routine-timezone">时区（IANA）</FieldLabel>
                <Input
                  id="routine-timezone"
                  value={routineForm.timezone || "Asia/Shanghai"}
                  onChange={(e) => setRoutineForm({ ...routineForm, timezone: e.target.value })}
                  placeholder="Asia/Shanghai"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="routine-triggers">事件触发器 JSON</FieldLabel>
                <Textarea
                  id="routine-triggers"
                  rows={3}
                  value={routineForm.triggers_json || "[]"}
                  onChange={(e) => setRoutineForm({ ...routineForm, triggers_json: e.target.value })}
                  placeholder='[{"source":"slack","type":"app_mention"}]'
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="routine-quiet"
                  checked={!!routineForm.quiet_unchanged}
                  onCheckedChange={(checked) =>
                    setRoutineForm({ ...routineForm, quiet_unchanged: checked === true })
                  }
                />
                <FieldLabel htmlFor="routine-quiet" className="font-normal">
                  结果无变化时静默
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="routine-enabled"
                  checked={routineForm.enabled !== false}
                  onCheckedChange={(checked) =>
                    setRoutineForm({ ...routineForm, enabled: checked === true })
                  }
                />
                <FieldLabel htmlFor="routine-enabled" className="font-normal">
                  创建后启用
                </FieldLabel>
              </Field>
              {routinesMsg ? <p className="settings-status m-0">{routinesMsg}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={routinesBusy}>
                  {routinesBusy ? "处理中…" : "创建"}
                </Button>
                <Button type="button" variant="outline" onClick={() => void onRefreshRoutines()}>
                  刷新
                </Button>
              </div>
            </FieldGroup>
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="入站 Webhook（Slack / GitHub）">
        <SettingsHint>
          创建 Hook 后把返回的 URL 配到 Slack Event Subscriptions 或 GitHub Webhooks。
          例行任务的 triggers 匹配事件后，会在绑定会话中唤醒助手。密钥可选用 bot_secrets / Hook secret（GitHub 签名）。
        </SettingsHint>
        <SettingsCard>
          <div className="llm-list">
            {inboundHooks.length === 0 ? (
              <SettingsEmpty>暂无 Hook。点击下方创建。</SettingsEmpty>
            ) : (
              inboundHooks.map((h) => (
                <div key={h.id} className="llm-item">
                  <div className="min-w-0 flex-1">
                    <div className="agent-name">{h.label || h.provider}</div>
                    <div className="agent-desc">Slack: {h.url_slack}</div>
                    <div className="agent-desc">GitHub: {h.url_github}</div>
                    <div className="agent-desc">token: {h.token}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void onDeleteInboundHook(h.id)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          {hooksMsg ? <p className="settings-status m-0">{hooksMsg}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={routinesBusy}
              onClick={() => void onCreateInboundHook()}
            >
              创建 Hook
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
