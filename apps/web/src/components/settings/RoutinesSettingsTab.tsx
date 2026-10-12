import type { FormEvent } from "react";
import type { Agent, InboundHook, Routine, RoutineInput } from "../../api";
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
                  <div style={{ flex: 1 }}>
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
                    <div className="agent-desc" style={{ marginTop: 4 }}>
                      prompt: {r.prompt.slice(0, 120)}
                      {r.prompt.length > 120 ? "…" : ""}
                    </div>
                    {r.last_run ? (
                      <pre className="settings-status" style={{ marginTop: 8, maxHeight: 160 }}>
                        [{r.last_run.status}] {r.last_run.result_text}
                      </pre>
                    ) : null}
                  </div>
                  <div className="llm-actions">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => void onToggleRoutine(r, e.target.checked)}
                        disabled={routinesBusy}
                      />
                      启用
                    </label>
                    <button type="button" onClick={() => void onRunRoutineNow(r.id)} disabled={routinesBusy}>
                      立即运行
                    </button>
                    <button type="button" className="danger" onClick={() => void onRemoveRoutine(r.id)}>
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="新建例行任务">
        <SettingsCard padded>
          <form className="llm-form" onSubmit={onSaveRoutine}>
            <label>
              名称
              <input
                value={routineForm.name}
                onChange={(e) => setRoutineForm({ ...routineForm, name: e.target.value })}
                required
              />
            </label>
            <label>
              Prompt
              <textarea
                rows={3}
                value={routineForm.prompt}
                onChange={(e) => setRoutineForm({ ...routineForm, prompt: e.target.value })}
                required
              />
            </label>
            <label>
              所属 Bot
              <select
                value={routineForm.agent_id || agentId || ""}
                onChange={(e) => setRoutineForm({ ...routineForm, agent_id: e.target.value })}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cron（5 字段，纯事件可留空）
              <input
                value={routineForm.schedule_cron}
                onChange={(e) => setRoutineForm({ ...routineForm, schedule_cron: e.target.value })}
                placeholder="0 9 * * *"
              />
            </label>
            <label>
              时区（IANA）
              <input
                value={routineForm.timezone || "Asia/Shanghai"}
                onChange={(e) => setRoutineForm({ ...routineForm, timezone: e.target.value })}
                placeholder="Asia/Shanghai"
              />
            </label>
            <label>
              事件触发器 JSON
              <textarea
                rows={3}
                value={routineForm.triggers_json || "[]"}
                onChange={(e) => setRoutineForm({ ...routineForm, triggers_json: e.target.value })}
                placeholder='[{"source":"slack","type":"app_mention"}]'
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!!routineForm.quiet_unchanged}
                onChange={(e) => setRoutineForm({ ...routineForm, quiet_unchanged: e.target.checked })}
              />
              结果无变化时静默
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={routineForm.enabled !== false}
                onChange={(e) => setRoutineForm({ ...routineForm, enabled: e.target.checked })}
              />
              创建后启用
            </label>
            {routinesMsg ? <div className="settings-status">{routinesMsg}</div> : null}
            <div className="llm-actions">
              <button type="submit" className="primary" disabled={routinesBusy}>
                {routinesBusy ? "处理中…" : "创建"}
              </button>
              <button type="button" onClick={() => void onRefreshRoutines()}>
                刷新
              </button>
            </div>
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
                  <div style={{ flex: 1 }}>
                    <div className="agent-name">{h.label || h.provider}</div>
                    <div className="agent-desc">Slack: {h.url_slack}</div>
                    <div className="agent-desc">GitHub: {h.url_github}</div>
                    <div className="agent-desc">token: {h.token}</div>
                  </div>
                  <div className="llm-actions">
                    <button
                      type="button"
                      className="danger"
                      onClick={() => void onDeleteInboundHook(h.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {hooksMsg ? <div className="settings-status">{hooksMsg}</div> : null}
          <div className="llm-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={routinesBusy}
              onClick={() => void onCreateInboundHook()}
            >
              创建 Hook
            </button>
          </div>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
