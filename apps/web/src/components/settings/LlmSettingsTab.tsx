import type { FormEvent } from "react";
import type { LLMConnection, LLMInput } from "../../api";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export interface LlmSettingsTabProps {
  llms: LLMConnection[];
  editingId: string | null;
  llmForm: LLMInput;
  onLlmFormChange: (next: LLMInput) => void;
  llmMsg: string;
  llmBusy: boolean;
  llmModelOptions: string[];
  llmModelsLoading: boolean;
  llmModelsError: string;
  llmCacheProbing: boolean;
  llmCacheProbeMsg: string;
  onSetDefault: (id: string) => void;
  onStartEdit: (connection: LLMConnection) => void;
  onDeleteConnection: (id: string) => void;
  onSaveLlm: (e: FormEvent) => void;
  onResetForm: () => void;
  onProbeTools: () => void;
}

export function LlmSettingsTab({
  llms,
  editingId,
  llmForm,
  onLlmFormChange,
  llmMsg,
  llmBusy,
  llmModelOptions,
  llmModelsLoading,
  llmModelsError,
  llmCacheProbing,
  llmCacheProbeMsg,
  onSetDefault,
  onStartEdit,
  onDeleteConnection,
  onSaveLlm,
  onResetForm,
  onProbeTools,
}: LlmSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsHint>
        可配置多个 OpenAI 兼容连接；聊天默认使用标记为「默认」的连接。密钥不会完整回显。
        勾选「启用 tools」前可用「检测 tools 能力」验证上游是否支持 function calling；不支持时无法开启。
        选定模型后会自动检测该端点是否支持 prompt cache（与运行时 OPENBOT_PROMPT_CACHE 一致）。
      </SettingsHint>
      <SettingsSection title="已有连接">
        <SettingsCard>
          <div className="llm-list">
            {llms.length === 0 ? (
              <SettingsEmpty>暂无连接，请在下方新增。</SettingsEmpty>
            ) : (
              llms.map((c) => (
                <div key={c.id} className={`llm-item ${c.is_default ? "default" : ""}`}>
                  <div>
                    <div className="agent-name">
                      {c.name}
                      {c.is_default ? <span className="tag">默认</span> : null}
                    </div>
                    <div className="agent-desc">
                      {c.model || "(无 model)"} · {c.base_url || "(无 base_url)"} · key{" "}
                      {c.api_key_set ? c.api_key_hint || "已设置" : "未设置"}
                      {c.enable_tools ? " · tools" : ""}
                    </div>
                  </div>
                  <div className="llm-actions">
                    {!c.is_default ? (
                      <button type="button" onClick={() => onSetDefault(c.id)}>
                        设默认
                      </button>
                    ) : null}
                    <button type="button" onClick={() => onStartEdit(c)}>
                      编辑
                    </button>
                    <button type="button" className="danger" onClick={() => onDeleteConnection(c.id)}>
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={editingId ? "编辑连接" : "新增连接"}>
        <SettingsCard padded>
          <form className="llm-form" onSubmit={onSaveLlm}>
            <label>
              名称
              <input
                value={llmForm.name}
                onChange={(e) => onLlmFormChange({ ...llmForm, name: e.target.value })}
                required
              />
            </label>
            <label>
              Base URL
              <input
                value={llmForm.base_url}
                onChange={(e) => onLlmFormChange({ ...llmForm, base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              API Key{editingId ? "（留空不改）" : ""}
              <input
                type="password"
                value={llmForm.api_key || ""}
                onChange={(e) => onLlmFormChange({ ...llmForm, api_key: e.target.value })}
                placeholder="sk-..."
                autoComplete="off"
              />
            </label>
            <label>
              Model
              <input
                list="llm-model-options"
                value={llmForm.model}
                onChange={(e) => onLlmFormChange({ ...llmForm, model: e.target.value })}
                placeholder={llmModelsLoading ? "加载模型列表…" : "gpt-4o-mini"}
                autoComplete="off"
              />
              <datalist id="llm-model-options">
                {llmModelOptions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              {llmModelsLoading ? (
                <span className="settings-status">正在拉取模型列表…</span>
              ) : llmModelsError ? (
                <span className="settings-status">{llmModelsError}（仍可手动输入）</span>
              ) : llmModelOptions.length > 0 ? (
                <span className="settings-status">
                  已加载 {llmModelOptions.length} 个模型，可下拉选择或手动输入
                </span>
              ) : null}
              {llmCacheProbing ? (
                <span className="settings-status">正在检测 prompt cache…</span>
              ) : llmCacheProbeMsg ? (
                <span className="settings-status">{llmCacheProbeMsg}</span>
              ) : null}
            </label>
            <label>
              上下文窗口 (tokens)
              <input
                type="number"
                min={0}
                step={1024}
                value={llmForm.context_window ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) {
                    onLlmFormChange({ ...llmForm, context_window: null });
                    return;
                  }
                  const n = Number(raw);
                  onLlmFormChange({
                    ...llmForm,
                    context_window: Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
                  });
                }}
                placeholder="留空=自动（按模型名推断）"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(llmForm.enable_tools)}
                onChange={(e) => onLlmFormChange({ ...llmForm, enable_tools: e.target.checked })}
              />
              启用 tools（需上游支持 function calling / 工具调用）
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(llmForm.is_default)}
                onChange={(e) => onLlmFormChange({ ...llmForm, is_default: e.target.checked })}
              />
              设为默认
            </label>
            {llmMsg ? <div className="settings-status">{llmMsg}</div> : null}
            <div className="llm-actions">
              <button type="submit" className="primary" disabled={llmBusy}>
                {llmBusy ? "保存中…" : "保存"}
              </button>
              <button type="button" disabled={llmBusy} onClick={() => void onProbeTools()}>
                检测 tools 能力
              </button>
              {editingId ? (
                <button type="button" onClick={onResetForm}>
                  取消编辑
                </button>
              ) : null}
            </div>
          </form>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
