import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { debounce } from "es-toolkit";
import {
  createLLMConnection,
  fetchEffectiveLLMConnection,
  formatLLMPromptCacheProbe,
  formatLLMToolsProbe,
  listLLMConnections,
  listLLMModels,
  LLMConnection,
  LLMInput,
  probeLLMPromptCache,
  probeLLMTools,
  updateLLMConnection,
} from "../../api";
import { emptyLLMForm } from "../../lib/app/constants";

export function useLlmSettings() {
  const [llms, setLlms] = useState<LLMConnection[]>([]);
  const [effectiveLLM, setEffectiveLLM] = useState<LLMConnection | null>(null);
  const [llmForm, setLLMForm] = useState<LLMInput>(emptyLLMForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [llmBusy, setLLMBusy] = useState(false);
  const [llmMsg, setLLMMsg] = useState("");
  const [llmModelOptions, setLLMModelOptions] = useState<string[]>([]);
  const [llmModelsLoading, setLLMModelsLoading] = useState(false);
  const [llmModelsError, setLLMModelsError] = useState("");
  const llmModelsReqSeq = useRef(0);
  const [llmCacheProbing, setLLMCacheProbing] = useState(false);
  const [llmCacheProbeMsg, setLLMCacheProbeMsg] = useState("");
  const llmCacheReqSeq = useRef(0);

  const refreshLLMs = useCallback(async () => {
    const [list, effective] = await Promise.all([
      listLLMConnections(),
      fetchEffectiveLLMConnection(),
    ]);
    setLlms(list);
    setEffectiveLLM(effective);
  }, []);

  const clearLlms = useCallback(() => {
    setLlms([]);
    setEffectiveLLM(null);
  }, []);

  const startEdit = useCallback((c: LLMConnection) => {
    setEditingId(c.id);
    setLLMForm({
      name: c.name,
      base_url: c.base_url,
      api_key: "",
      model: c.model,
      enable_tools: c.enable_tools,
      is_default: c.is_default,
      context_window: c.context_window ?? null,
    });
    setLLMMsg(c.api_key_set ? `已保存密钥 ${c.api_key_hint || ""}（留空则不修改）` : "");
  }, []);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setLLMForm({ ...emptyLLMForm, is_default: llms.length === 0 });
    setLLMMsg("");
    setLLMModelOptions([]);
    setLLMModelsError("");
    setLLMCacheProbeMsg("");
  }, [llms.length]);

  const saveLLM = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setLLMBusy(true);
      setLLMMsg("");
      try {
        if (llmForm.enable_tools) {
          const probe = await probeLLMTools({
            base_url: llmForm.base_url,
            model: llmForm.model,
            api_key: llmForm.api_key?.trim() || undefined,
            connection_id: editingId || undefined,
          });
          if (!probe.can_enable_tools) {
            setLLMMsg(formatLLMToolsProbe(probe));
            setLLMBusy(false);
            return;
          }
          if (probe.mode !== "native") {
            setLLMMsg(formatLLMToolsProbe(probe));
          }
        }
        if (editingId) {
          const patch: Partial<LLMInput> = {
            name: llmForm.name,
            base_url: llmForm.base_url,
            model: llmForm.model,
            enable_tools: llmForm.enable_tools,
            is_default: llmForm.is_default,
            context_window:
              llmForm.context_window && llmForm.context_window > 0
                ? llmForm.context_window
                : null,
          };
          if (llmForm.api_key && llmForm.api_key.trim()) {
            patch.api_key = llmForm.api_key.trim();
          }
          await updateLLMConnection(editingId, patch);
          setLLMMsg((prev) => (prev ? `${prev} · 已更新` : "已更新"));
        } else {
          await createLLMConnection({
            ...llmForm,
            context_window:
              llmForm.context_window && llmForm.context_window > 0
                ? llmForm.context_window
                : null,
          });
          setLLMMsg((prev) => (prev ? `${prev} · 已创建` : "已创建"));
        }
        await refreshLLMs();
        resetForm();
      } catch (err) {
        setLLMMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setLLMBusy(false);
      }
    },
    [llmForm, editingId, refreshLLMs, resetForm],
  );

  const probeLLMFormTools = useCallback(async () => {
    setLLMBusy(true);
    setLLMMsg("正在检测 tools / function calling…");
    try {
      const probe = await probeLLMTools({
        base_url: llmForm.base_url,
        model: llmForm.model,
        api_key: llmForm.api_key?.trim() || undefined,
        connection_id: editingId || undefined,
      });
      setLLMMsg(formatLLMToolsProbe(probe));
      if (!probe.can_enable_tools && llmForm.enable_tools) {
        setLLMForm({ ...llmForm, enable_tools: false });
      }
    } catch (err) {
      setLLMMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLLMBusy(false);
    }
  }, [llmForm, editingId]);

  useEffect(() => {
    const base = llmForm.base_url.trim();
    const key = (llmForm.api_key || "").trim();
    const editing = llms.find((c) => c.id === editingId);
    const canReuseSaved = Boolean(editingId && editing?.api_key_set);
    if (!base || (!key && !canReuseSaved)) {
      setLLMModelOptions([]);
      setLLMModelsError("");
      setLLMModelsLoading(false);
      return;
    }
    const seq = ++llmModelsReqSeq.current;
    const run = debounce(() => {
      setLLMModelsLoading(true);
      setLLMModelsError("");
      void listLLMModels({
        base_url: base,
        ...(key ? { api_key: key } : {}),
        ...(editingId ? { connection_id: editingId } : {}),
      })
        .then((res) => {
          if (seq !== llmModelsReqSeq.current) return;
          if (!res.ok) {
            setLLMModelOptions([]);
            setLLMModelsError(res.detail || res.error || "拉取模型列表失败");
            return;
          }
          setLLMModelOptions(res.models || []);
          setLLMModelsError("");
        })
        .catch((err) => {
          if (seq !== llmModelsReqSeq.current) return;
          setLLMModelOptions([]);
          setLLMModelsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === llmModelsReqSeq.current) setLLMModelsLoading(false);
        });
    }, 450);
    run();
    return () => run.cancel();
  }, [llmForm.base_url, llmForm.api_key, editingId, llms]);

  useEffect(() => {
    const base = llmForm.base_url.trim();
    const key = (llmForm.api_key || "").trim();
    const model = llmForm.model.trim();
    const editing = llms.find((c) => c.id === editingId);
    const canReuseSaved = Boolean(editingId && editing?.api_key_set);
    if (!base || !model || (!key && !canReuseSaved)) {
      setLLMCacheProbeMsg("");
      setLLMCacheProbing(false);
      return;
    }
    const seq = ++llmCacheReqSeq.current;
    const run = debounce(() => {
      setLLMCacheProbing(true);
      void probeLLMPromptCache({
        base_url: base,
        model,
        ...(key ? { api_key: key } : {}),
        ...(editingId ? { connection_id: editingId } : {}),
      })
        .then((res) => {
          if (seq !== llmCacheReqSeq.current) return;
          setLLMCacheProbeMsg(formatLLMPromptCacheProbe(res));
        })
        .catch((err) => {
          if (seq !== llmCacheReqSeq.current) return;
          setLLMCacheProbeMsg(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === llmCacheReqSeq.current) setLLMCacheProbing(false);
        });
    }, 450);
    run();
    return () => run.cancel();
  }, [llmForm.base_url, llmForm.api_key, llmForm.model, editingId, llms]);

  return {
    llms,
    effectiveLLM,
    llmForm,
    setLLMForm,
    editingId,
    llmBusy,
    llmMsg,
    setLLMMsg,
    llmModelOptions,
    llmModelsLoading,
    llmModelsError,
    llmCacheProbing,
    llmCacheProbeMsg,
    refreshLLMs,
    clearLlms,
    saveLLM,
    startEdit,
    resetForm,
    probeLLMFormTools,
  };
}
