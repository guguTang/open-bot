import type { FormEvent } from "react";
import type { LLMConnection, LLMInput } from "../../api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  llmLoading?: boolean;
  llmLoadError?: string;
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
  onRefresh?: () => void | Promise<void>;
}

export function LlmSettingsTab({
  llms,
  editingId,
  llmForm,
  onLlmFormChange,
  llmMsg,
  llmBusy,
  llmLoading,
  llmLoadError,
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
  onRefresh,
}: LlmSettingsTabProps) {
  const modelHint = llmModelsLoading
    ? "正在拉取模型列表…"
    : llmModelsError
      ? `${llmModelsError}（仍可手动输入）`
      : llmModelOptions.length > 0
        ? `已加载 ${llmModelOptions.length} 个模型，可下拉选择或手动输入`
        : undefined;

  return (
    <SettingsPage>
      <SettingsHint>
        可配置多个 OpenAI 兼容连接；聊天默认使用标记为「默认」的连接。密钥不会完整回显。
        勾选「启用 tools」前可用「检测 tools 能力」验证上游是否支持 function calling；不支持时无法开启。
        选定模型后会自动检测该端点是否支持 prompt cache（与运行时 OPENBOT_PROMPT_CACHE 一致）。
      </SettingsHint>
      <SettingsSection title="已有连接">
        <SettingsCard>
          {llmLoadError ? (
            <div className="settings-status" style={{ padding: 12 }}>
              <p>无法读取模型连接：{llmLoadError}</p>
              {onRefresh ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={llmLoading || llmBusy}
                  onClick={() => void onRefresh()}
                >
                  重试
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="llm-list">
            {llms.length === 0 && !llmLoadError ? (
              <SettingsEmpty>
                {llmLoading ? "加载中…" : "暂无连接，请在下方新增。"}
              </SettingsEmpty>
            ) : llms.length === 0 ? null : (
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
                  <div className="flex flex-wrap gap-2">
                    {!c.is_default ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => onSetDefault(c.id)}>
                        设默认
                      </Button>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" onClick={() => onStartEdit(c)}>
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => onDeleteConnection(c.id)}
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
      <SettingsSection title={editingId ? "编辑连接" : "新增连接"}>
        <SettingsCard padded>
          <form onSubmit={onSaveLlm}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="llm-name">名称</FieldLabel>
                <Input
                  id="llm-name"
                  value={llmForm.name}
                  onChange={(e) => onLlmFormChange({ ...llmForm, name: e.target.value })}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="llm-base-url">Base URL</FieldLabel>
                <Input
                  id="llm-base-url"
                  value={llmForm.base_url}
                  onChange={(e) => onLlmFormChange({ ...llmForm, base_url: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="llm-api-key">
                  API Key{editingId ? "（留空不改）" : ""}
                </FieldLabel>
                <Input
                  id="llm-api-key"
                  type="password"
                  value={llmForm.api_key || ""}
                  onChange={(e) => onLlmFormChange({ ...llmForm, api_key: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="llm-model">Model</FieldLabel>
                <Input
                  id="llm-model"
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
                {modelHint ? <FieldDescription>{modelHint}</FieldDescription> : null}
                {llmCacheProbing ? (
                  <FieldDescription>正在检测 prompt cache…</FieldDescription>
                ) : llmCacheProbeMsg ? (
                  <FieldDescription>{llmCacheProbeMsg}</FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="llm-context-window">上下文窗口 (tokens)</FieldLabel>
                <Input
                  id="llm-context-window"
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
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="llm-enable-tools"
                  checked={Boolean(llmForm.enable_tools)}
                  onCheckedChange={(checked) =>
                    onLlmFormChange({ ...llmForm, enable_tools: checked === true })
                  }
                />
                <FieldLabel htmlFor="llm-enable-tools" className="font-normal">
                  启用 tools（需上游支持 function calling / 工具调用）
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="llm-is-default"
                  checked={Boolean(llmForm.is_default)}
                  onCheckedChange={(checked) =>
                    onLlmFormChange({ ...llmForm, is_default: checked === true })
                  }
                />
                <FieldLabel htmlFor="llm-is-default" className="font-normal">
                  设为默认
                </FieldLabel>
              </Field>
              {llmMsg ? <p className="settings-status m-0">{llmMsg}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={llmBusy}>
                  {llmBusy ? "保存中…" : "保存"}
                </Button>
                <Button type="button" variant="outline" disabled={llmBusy} onClick={() => void onProbeTools()}>
                  检测 tools 能力
                </Button>
                {editingId ? (
                  <Button type="button" variant="ghost" onClick={onResetForm}>
                    取消编辑
                  </Button>
                ) : null}
              </div>
            </FieldGroup>
          </form>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
