import { useEffect, useState } from "react";
import { Alert, Button, Card, Form, Space, message, Typography } from "antd";
import {
  PageContainer,
  ProForm,
  ProFormCheckbox,
  ProFormDigit,
  ProFormSelect,
  ProFormText,
} from "@ant-design/pro-components";
import {
  adminGetDecision,
  adminGetMSDecision,
  adminPutDecision,
  adminPutMSDecision,
  adminTestDecision,
  adminTestMSDecision,
  type MSDecisionProvider,
} from "../api";

const { Paragraph, Text } = Typography;

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "microsoft/microsoft-decision-1";

/** Sole active decision backend — mutually exclusive one-of-N. */
type DecisionBackend = "off" | "jev" | "laya" | "microsoft" | "custom";

const PROVIDER_HELP: Record<DecisionBackend, string> = {
  off: "关闭时聊天、工具、A2A 和群 Auto 选人都不会调用决策模型（Auto 选人回退启发式）。",
  jev: "Jev 走托管接口 POST {base_url}/v1/systemone，默认 https://api.typesafe.ai ，模型 jev-latest，需要 API key。与其他提供方互斥，只能选一个。",
  laya:
    "填写 base_url 时，Laya 走同一套 HTTP 契约。留空则由 runtime 进程内懒加载 laya（需已 pip install laya），默认模型 convaiinnovations/laya。自托管 / Unsloth 桌面也可改选「自定义」。与其他提供方互斥。",
  microsoft:
    "Microsoft-Decision-1（非聊天模型）：Go API 直连 OpenRouter 或 Azure AI Foundry 的 systemone 接口，用于群 Auto 选人 decision 模式等。失败 / 超时 / 低置信度时回退启发式，不会再调用其他决策提供方。计费约 $0.042 / 1M 输入 token。",
  custom:
    "任意兼容 System One 决策 API 的 HTTP 端点（POST {base_url}/v1/systemone）。须自行填写 base_url 与模型；API key 可选。例如自托管服务，或 Unsloth 桌面端本地 Decision API（http://localhost:8888，模型 laya；请先在 Unsloth：设置 → API → 决策 API 启用「提供请求服务」）。未填完整时检测/运行时会明确失败。与其他提供方互斥。",
};

type FormValues = {
  provider: DecisionBackend;
  // System One (jev/laya/custom)
  base_url: string;
  model: string;
  api_key: string;
  // Microsoft-Decision-1
  ms_provider: MSDecisionProvider;
  ms_base_url: string;
  ms_model: string;
  ms_auth_mode: "api_key" | "bearer";
  ms_api_key: string;
  ms_clear_api_key: boolean;
  ms_confidence_threshold?: number | null;
  ms_timeout_ms?: number | null;
};

export default function DecisionPage() {
  const [hint, setHint] = useState("");
  const [msHint, setMsHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [probeMsg, setProbeMsg] = useState("");
  const [form] = Form.useForm<FormValues>();
  const provider = (Form.useWatch("provider", form) || "off") as DecisionBackend;
  const msProvider: MSDecisionProvider = Form.useWatch("ms_provider", form) || "openrouter";
  const isAzure = msProvider === "azure_foundry";
  const msAuthMode = Form.useWatch("ms_auth_mode", form) || "api_key";
  const isMicrosoft = provider === "microsoft";
  const isSystemOne = provider === "jev" || provider === "laya" || provider === "custom";

  async function reload() {
    const [data, ms] = await Promise.all([adminGetDecision(), adminGetMSDecision()]);
    setHint(data.api_key_hint || "");
    setMsHint(ms.api_key_set ? ms.api_key_hint || "****" : "");
    // Prefer decision_provider; if somehow MS enabled alone, show microsoft.
    let backend = (data.provider || "off") as DecisionBackend;
    // Legacy unsloth is normalized to laya on the API; keep UI defensive.
    if ((backend as string) === "unsloth") backend = "laya";
    if (backend === "off" && ms.enabled) backend = "microsoft";
    form.setFieldsValue({
      provider: backend,
      base_url: data.base_url || "",
      model: data.model || "",
      api_key: "",
      ms_provider: ms.provider || "openrouter",
      ms_base_url: ms.base_url || "",
      ms_model: ms.model || "",
      ms_auth_mode: ms.auth_mode || "api_key",
      ms_api_key: "",
      ms_clear_api_key: false,
      ms_confidence_threshold: ms.confidence_threshold ?? null,
      ms_timeout_ms: ms.timeout_ms ?? null,
    });
  }

  useEffect(() => {
    setLoading(true);
    void reload()
      .catch((err) => message.error(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runModelProbe = () => {
    const values = form.getFieldsValue();
    const p = (values.provider || "off") as DecisionBackend;
    if (p === "off") {
      setProbeMsg("当前为关闭，不会调用模型");
      message.info("当前为关闭，不会调用模型");
      return;
    }
    setTesting(true);
    setProbeMsg("正在检测模型可用性…");
    const started = performance.now();

    const onOk = (text: string) => {
      setProbeMsg(text);
      message.success(text);
    };
    const onErr = (err: unknown) => {
      const latency = Math.round(performance.now() - started);
      const text = `模型不可用（${latency}ms）：${err instanceof Error ? err.message : String(err)}`;
      setProbeMsg(text);
      message.error(text);
    };

    if (p === "microsoft") {
      void adminTestMSDecision({
        enabled: true,
        provider: values.ms_provider || "openrouter",
        base_url: (values.ms_base_url || "").trim(),
        model: (values.ms_model || "").trim(),
        auth_mode: values.ms_provider === "azure_foundry" ? values.ms_auth_mode || "api_key" : "api_key",
        api_key: (values.ms_api_key || "").trim(),
        clear_api_key: false,
        confidence_threshold:
          typeof values.ms_confidence_threshold === "number" ? values.ms_confidence_threshold : null,
        timeout_ms: typeof values.ms_timeout_ms === "number" ? values.ms_timeout_ms : null,
      })
        .then((data) => {
          const latency = Math.round(performance.now() - started);
          const cost = data.usage
            ? ` · ${data.usage.input_tokens} 输入 token · $${data.usage.cost.toExponential(2)}${data.usage.cost_estimated ? "（估算）" : ""}`
            : "";
          onOk(
            `连接成功（microsoft · ${data.response_model || data.model}${data.upstream_provider ? ` @ ${data.upstream_provider}` : ""} · ${latency}ms${cost}）`,
          );
        })
        .catch(onErr)
        .finally(() => setTesting(false));
      return;
    }

    void adminTestDecision({
      provider: p,
      base_url: values.base_url || "",
      api_key: values.api_key || "",
      model: values.model || "",
    })
      .then((data) => {
        const latency = Math.round(performance.now() - started);
        const noul = data.answers?.ok?.noul;
        const modelLabel = data.model || values.model || "";
        const text =
          typeof noul === "number"
            ? `模型可用（${data.provider}${modelLabel ? ` · ${modelLabel}` : ""} · ${latency}ms，探测概率 ${noul.toFixed(2)}）`
            : `模型可用（${data.provider || p}${modelLabel ? ` · ${modelLabel}` : ""} · ${latency}ms）`;
        onOk(text);
      })
      .catch(onErr)
      .finally(() => setTesting(false));
  };

  return (
    <PageContainer title="决策模型">
      <Card loading={loading}>
        <Paragraph type="secondary">
          组织级决策模型，默认关闭。提供方为互斥单选（关闭 / Jev / Laya / Microsoft-Decision-1 / 自定义），同一时间只有一条生效路径。
          {hint && !isMicrosoft ? ` 当前 System One 密钥 ${hint}。` : ""}
          {msHint && isMicrosoft ? ` 当前 Microsoft 密钥 ${msHint}。` : ""}
        </Paragraph>
        <Paragraph type="secondary">{PROVIDER_HELP[provider] || PROVIDER_HELP.off}</Paragraph>
        <ProForm<FormValues>
          form={form}
          layout="vertical"
          style={{ maxWidth: 560 }}
          submitter={{
            searchConfig: { submitText: "保存" },
            render: (_, dom) => (
              <Space wrap>
                <Button loading={testing} onClick={() => void runModelProbe()}>
                  {isMicrosoft ? "测试连接" : "检测模型"}
                </Button>
                {dom}
              </Space>
            ),
          }}
          onFinish={async (values) => {
            try {
              const p = (values.provider || "off") as DecisionBackend;
              if (p === "microsoft") {
                await adminPutDecision({
                  provider: "microsoft",
                  base_url: values.base_url || "",
                  api_key: "",
                  model: values.model || "",
                });
                await adminPutMSDecision({
                  enabled: true,
                  provider: values.ms_provider || "openrouter",
                  base_url: (values.ms_base_url || "").trim(),
                  model: (values.ms_model || "").trim(),
                  auth_mode:
                    values.ms_provider === "azure_foundry" ? values.ms_auth_mode || "api_key" : "api_key",
                  api_key: (values.ms_api_key || "").trim(),
                  clear_api_key: !!values.ms_clear_api_key,
                  confidence_threshold:
                    typeof values.ms_confidence_threshold === "number"
                      ? values.ms_confidence_threshold
                      : null,
                  timeout_ms: typeof values.ms_timeout_ms === "number" ? values.ms_timeout_ms : null,
                });
              } else {
                await adminPutDecision({
                  provider: p,
                  base_url: values.base_url || "",
                  api_key: values.api_key || "",
                  model: values.model || "",
                });
                // Keep MS connection details, but disable so it cannot stack with System One.
                await adminPutMSDecision({
                  enabled: false,
                  provider: values.ms_provider || "openrouter",
                  base_url: (values.ms_base_url || "").trim(),
                  model: (values.ms_model || "").trim(),
                  auth_mode:
                    values.ms_provider === "azure_foundry" ? values.ms_auth_mode || "api_key" : "api_key",
                  api_key: "",
                  clear_api_key: false,
                  confidence_threshold:
                    typeof values.ms_confidence_threshold === "number"
                      ? values.ms_confidence_threshold
                      : null,
                  timeout_ms: typeof values.ms_timeout_ms === "number" ? values.ms_timeout_ms : null,
                });
              }
              message.success("决策模型已保存");
              await reload();
              return true;
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              return false;
            }
          }}
        >
          <ProFormSelect
            name="provider"
            label="提供方（互斥单选）"
            initialValue="off"
            options={[
              { label: "关闭", value: "off" },
              { label: "Jev", value: "jev" },
              { label: "Laya", value: "laya" },
              { label: "Microsoft-Decision-1", value: "microsoft" },
              { label: "自定义", value: "custom" },
            ]}
            rules={[{ required: true, message: "请选择提供方" }]}
          />

          {isSystemOne ? (
            <>
              <ProFormText
                name="base_url"
                label="Base URL"
                placeholder={
                  provider === "custom"
                    ? "例如 http://localhost:8888 或自托管 System One 根地址"
                    : provider === "laya"
                      ? "留空则本机 laya；也可改选「自定义」填 HTTP"
                      : "https://api.typesafe.ai"
                }
                rules={
                  provider === "custom"
                    ? [{ required: true, message: "自定义需填写 Base URL" }]
                    : []
                }
              />
              <ProFormText.Password
                name="api_key"
                label="API Key（留空则保持原值）"
                fieldProps={{ autoComplete: "off" }}
              />
              <ProFormText
                name="model"
                label="模型"
                placeholder={
                  provider === "custom"
                    ? "例如 laya / jev-latest / 自托管模型名"
                    : provider === "laya"
                      ? "convaiinnovations/laya"
                      : "jev-latest"
                }
                rules={
                  provider === "custom"
                    ? [{ required: true, message: "自定义需填写模型" }]
                    : []
                }
              />
            </>
          ) : null}

          {isMicrosoft ? (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={
                  isAzure
                    ? "Azure Foundry：POST {资源 endpoint}/providers/microsoft/v1/systemone，model 填部署名（不是 Microsoft-Decision-1）。API key 走 api-key 头；Entra ID 令牌走 Authorization: Bearer（令牌需自行续期）。"
                    : `OpenRouter：POST ${OPENROUTER_BASE}/systemone，Authorization: Bearer <OpenRouter key>，模型 ${OPENROUTER_MODEL}。`
                }
              />
              <ProFormSelect
                name="ms_provider"
                label="接入渠道"
                initialValue="openrouter"
                allowClear={false}
                options={[
                  { label: "OpenRouter", value: "openrouter" },
                  { label: "Azure AI Foundry", value: "azure_foundry" },
                ]}
                fieldProps={{
                  onChange: (v: MSDecisionProvider) => {
                    if (v === "openrouter") {
                      form.setFieldsValue({
                        ms_base_url: OPENROUTER_BASE,
                        ms_model: OPENROUTER_MODEL,
                        ms_auth_mode: "api_key",
                      });
                    } else {
                      const cur = form.getFieldsValue();
                      form.setFieldsValue({
                        ms_base_url: cur.ms_base_url === OPENROUTER_BASE ? "" : cur.ms_base_url,
                        ms_model: cur.ms_model === OPENROUTER_MODEL ? "" : cur.ms_model,
                      });
                    }
                  },
                }}
              />
              <ProFormText
                name="ms_base_url"
                label={isAzure ? "Foundry 资源 Endpoint" : "Base URL"}
                placeholder={isAzure ? "https://<resource>.services.ai.azure.com" : OPENROUTER_BASE}
                rules={isAzure ? [{ required: true, message: "请填写 Foundry 资源 endpoint" }] : []}
              />
              <ProFormText
                name="ms_model"
                label={isAzure ? "部署名（deployment）" : "模型"}
                placeholder={isAzure ? "例如 decision-1" : OPENROUTER_MODEL}
                rules={isAzure ? [{ required: true, message: "请填写部署名" }] : []}
              />
              {isAzure ? (
                <ProFormSelect
                  name="ms_auth_mode"
                  label="认证方式"
                  initialValue="api_key"
                  allowClear={false}
                  options={[
                    { label: "API key（api-key 头）", value: "api_key" },
                    { label: "Entra ID 访问令牌（Bearer）", value: "bearer" },
                  ]}
                />
              ) : null}
              <ProFormText.Password
                name="ms_api_key"
                label={
                  isAzure && msAuthMode === "bearer"
                    ? "访问令牌（留空则保持原值）"
                    : "API Key（留空则保持原值）"
                }
                fieldProps={{ autoComplete: "off" }}
              />
              {msHint ? (
                <ProFormCheckbox name="ms_clear_api_key">清除已保存的密钥</ProFormCheckbox>
              ) : null}
              <ProFormDigit
                name="ms_confidence_threshold"
                label="置信度阈值（可选，0–1）"
                tooltip="Auto 选人 pick 问题的 max(confidence, 选中项概率) 低于该值时回退启发式。留空或 0 表示不额外设阈值。"
                min={0}
                max={1}
                fieldProps={{ step: 0.05, precision: 2 }}
              />
              <ProFormDigit
                name="ms_timeout_ms"
                label="超时（毫秒，可选）"
                tooltip="默认 10000ms，范围 1000–60000。超时后回退启发式（不会改用其他决策提供方）。"
                min={1000}
                max={60000}
                fieldProps={{ step: 500, precision: 0 }}
              />
            </>
          ) : null}
        </ProForm>
        {probeMsg ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            {probeMsg}
          </Text>
        ) : null}
      </Card>
    </PageContainer>
  );
}
