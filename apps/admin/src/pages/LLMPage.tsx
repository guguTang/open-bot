import { useEffect, useRef, useState } from "react";
import { debounce } from "es-toolkit";
import { AutoComplete, Button, Card, Form, Space, message, Typography } from "antd";
import {
  PageContainer,
  ProForm,
  ProFormDigit,
  ProFormSwitch,
  ProFormText,
} from "@ant-design/pro-components";
import {
  adminGetOrgLLM,
  adminListOrgLLMModels,
  adminProbeOrgLLMModel,
  adminProbeOrgLLMPromptCache,
  adminProbeOrgLLMTools,
  adminPutOrgLLM,
  formatLLMModelProbe,
  formatLLMPromptCacheProbe,
  formatLLMToolsProbe,
  type OrgLLMSettings,
} from "../api";

const { Paragraph, Text } = Typography;

const MODELS_DEBOUNCE_MS = 450;

export default function LLMPage() {
  const [llm, setLlm] = useState<OrgLLMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState("");
  const [cacheProbing, setCacheProbing] = useState(false);
  const [cacheProbeMsg, setCacheProbeMsg] = useState("");
  const [modelProbing, setModelProbing] = useState(false);
  const [modelProbeMsg, setModelProbeMsg] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [form] = Form.useForm();
  const modelsReqSeq = useRef(0);
  const watchedBaseURL = Form.useWatch("base_url", form);
  const watchedAPIKey = Form.useWatch("api_key", form);
  const watchedModel = Form.useWatch("model", form);
  const cacheReqSeq = useRef(0);

  useEffect(() => {
    setLoading(true);
    void adminGetOrgLLM()
      .then((data) => {
        setLlm(data);
        form.setFieldsValue({
          name: data.llm_name || "",
          base_url: data.llm_base_url || "",
          api_key: "",
          model: data.llm_model || "",
          enable_tools: Boolean(data.llm_enable_tools),
          context_window: data.llm_context_window ?? undefined,
          max_tool_rounds: data.llm_max_tool_rounds ?? 24,
        });
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [form]);

  // Auto-fetch OpenAI-compatible model list when endpoint (+ key or saved org key) is ready.
  useEffect(() => {
    const base = String(watchedBaseURL || "").trim();
    const key = String(watchedAPIKey || "").trim();
    const canReuseSaved = Boolean(llm?.api_key_set);
    if (!base || (!key && !canReuseSaved)) {
      setModelOptions([]);
      setModelsError("");
      setModelsLoading(false);
      return;
    }

    const seq = ++modelsReqSeq.current;
    const run = debounce(() => {
      setModelsLoading(true);
      setModelsError("");
      void adminListOrgLLMModels({
        base_url: base,
        ...(key ? { api_key: key } : {}),
      })
        .then((res) => {
          if (seq !== modelsReqSeq.current) return;
          if (!res.ok) {
            setModelOptions([]);
            setModelsError(res.detail || res.error || "拉取模型列表失败");
            return;
          }
          setModelOptions(res.models || []);
          setModelsError("");
        })
        .catch((err) => {
          if (seq !== modelsReqSeq.current) return;
          setModelOptions([]);
          setModelsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === modelsReqSeq.current) setModelsLoading(false);
        });
    }, MODELS_DEBOUNCE_MS);
    run();
    return () => run.cancel();
  }, [watchedBaseURL, watchedAPIKey, llm?.api_key_set]);

  // Auto-detect prompt-cache support when endpoint + key + model are ready.
  useEffect(() => {
    const base = String(watchedBaseURL || "").trim();
    const key = String(watchedAPIKey || "").trim();
    const model = String(watchedModel || "").trim();
    const canReuseSaved = Boolean(llm?.api_key_set);
    if (!base || !model || (!key && !canReuseSaved)) {
      setCacheProbeMsg("");
      setCacheProbing(false);
      return;
    }

    const seq = ++cacheReqSeq.current;
    const run = debounce(() => {
      setCacheProbing(true);
      void adminProbeOrgLLMPromptCache({
        base_url: base,
        model,
        ...(key ? { api_key: key } : {}),
      })
        .then((res) => {
          if (seq !== cacheReqSeq.current) return;
          setCacheProbeMsg(formatLLMPromptCacheProbe(res));
        })
        .catch((err) => {
          if (seq !== cacheReqSeq.current) return;
          setCacheProbeMsg(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (seq === cacheReqSeq.current) setCacheProbing(false);
        });
    }, MODELS_DEBOUNCE_MS);
    run();
    return () => run.cancel();
  }, [watchedBaseURL, watchedAPIKey, watchedModel, llm?.api_key_set]);

  const runProbe = async () => {
    setProbing(true);
    setProbeMsg("");
    try {
      const values = await form.validateFields(["base_url", "model"]);
      const probe = await adminProbeOrgLLMTools({
        base_url: values.base_url || "",
        model: values.model || "",
        api_key: form.getFieldValue("api_key") || "",
      });
      const text = formatLLMToolsProbe(probe);
      setProbeMsg(text);
      if (!probe.can_enable_tools) {
        form.setFieldValue("enable_tools", false);
        message.warning(text);
      } else if (probe.mode === "native") {
        message.success(text);
      } else {
        message.info(text);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setProbeMsg(text);
      message.error(text);
    } finally {
      setProbing(false);
    }
  };

  const runModelProbe = async () => {
    setModelProbing(true);
    setModelProbeMsg("");
    try {
      const values = await form.validateFields(["base_url", "model"]);
      const probe = await adminProbeOrgLLMModel({
        base_url: values.base_url || "",
        model: values.model || "",
        api_key: form.getFieldValue("api_key") || "",
      });
      const text = formatLLMModelProbe(probe);
      setModelProbeMsg(text);
      if (probe.ok) {
        message.success(text);
      } else {
        message.error(text);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setModelProbeMsg(text);
      message.error(text);
    } finally {
      setModelProbing(false);
    }
  };

  return (
    <PageContainer title="默认模型">
      <Card loading={loading}>
        <Paragraph type="secondary">
          成员无个人默认模型时，聊天使用此处配置（密钥脱敏回显
          {llm?.api_key_hint ? `：${llm.api_key_hint}` : ""}）。
          优先级：个人默认/首个连接 &gt; 组织默认 &gt; 无。
          勾选「启用 tools」前请先检测上游是否支持 function calling；不支持时无法保存开启状态。
          填写 Base URL 与 API Key 后会自动拉取可用模型列表（仍可手动输入）。选定模型后会检测该端点是否支持 prompt cache。
          可用「检测模型」对选定模型发一次最小聊天请求，确认其可响应。
        </Paragraph>
        <ProForm
          form={form}
          layout="vertical"
          style={{ maxWidth: 560 }}
          submitter={{
            searchConfig: { submitText: "保存" },
            render: (_, dom) => (
              <Space wrap>
                {dom}
                <Button loading={modelProbing} onClick={() => void runModelProbe()}>
                  检测模型
                </Button>
                <Button loading={probing} onClick={() => void runProbe()}>
                  检测 tools 能力
                </Button>
              </Space>
            ),
          }}
          onFinish={async (values) => {
            try {
              if (values.enable_tools) {
                const probe = await adminProbeOrgLLMTools({
                  base_url: values.base_url || "",
                  model: values.model || "",
                  api_key: values.api_key || "",
                });
                if (!probe.can_enable_tools) {
                  const text = formatLLMToolsProbe(probe);
                  setProbeMsg(text);
                  message.error(text);
                  form.setFieldValue("enable_tools", false);
                  return false;
                }
                if (probe.mode !== "native") {
                  setProbeMsg(formatLLMToolsProbe(probe));
                  message.info(formatLLMToolsProbe(probe));
                }
              }
              const cw = values.context_window;
              const mtr = values.max_tool_rounds;
              await adminPutOrgLLM({
                name: values.name || "",
                base_url: values.base_url || "",
                api_key: values.api_key || "",
                model: values.model || "",
                enable_tools: Boolean(values.enable_tools),
                context_window: cw && Number(cw) > 0 ? Number(cw) : null,
                max_tool_rounds: mtr && Number(mtr) > 0 ? Number(mtr) : null,
              });
              message.success("组织默认模型已保存");
              const data = await adminGetOrgLLM();
              setLlm(data);
              form.setFieldsValue({
                name: data.llm_name || "",
                base_url: data.llm_base_url || "",
                api_key: "",
                model: data.llm_model || "",
                enable_tools: Boolean(data.llm_enable_tools),
                context_window: data.llm_context_window ?? undefined,
                max_tool_rounds: data.llm_max_tool_rounds ?? 24,
              });
              return true;
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              return false;
            }
          }}
        >
          <ProFormText name="name" label="名称" />
          <ProFormText name="base_url" label="Base URL" />
          <ProFormText.Password
            name="api_key"
            label="API Key（留空则保持原值）"
            fieldProps={{ autoComplete: "off" }}
          />
          <Form.Item
            name="model"
            label="模型"
            extra={
              modelsLoading
                ? "正在拉取模型列表…"
                : modelsError
                  ? modelsError
                  : modelOptions.length
                    ? `已加载 ${modelOptions.length} 个模型，可下拉选择或手动输入`
                    : "填写 Base URL 与密钥后自动拉取；也可直接输入模型名"
            }
          >
            <AutoComplete
              options={modelOptions.map((id) => ({ value: id }))}
              placeholder="gpt-4o-mini"
              allowClear
              filterOption={(input, option) =>
                String(option?.value || "")
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <ProFormDigit
            name="context_window"
            label="上下文窗口 (tokens)"
            placeholder="可选"
            min={1}
            fieldProps={{ precision: 0 }}
          />
          <ProFormDigit
            name="max_tool_rounds"
            label="工具轮次上限"
            placeholder="默认 24"
            min={1}
            max={48}
            extra="单次对话最多调用工具的轮数；触顶后会综合已有工具结果给出最终回答（不会提示「已达上限」）。"
            fieldProps={{ precision: 0 }}
          />
          <ProFormSwitch
            name="enable_tools"
            label="启用 tools"
            extra="需上游支持 OpenAI function calling；保存前会自动检测"
          />
        </ProForm>
        {cacheProbing ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            正在检测 prompt cache…
          </Text>
        ) : cacheProbeMsg ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            {cacheProbeMsg}
          </Text>
        ) : null}
        {modelProbing ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            正在检测模型可用性…
          </Text>
        ) : modelProbeMsg ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            {modelProbeMsg}
          </Text>
        ) : null}
        {probeMsg ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            {probeMsg}
          </Text>
        ) : null}
      </Card>
    </PageContainer>
  );
}
