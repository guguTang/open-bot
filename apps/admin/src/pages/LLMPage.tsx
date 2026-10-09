import { useEffect, useState } from "react";
import { Button, Card, Form, Space, message, Typography } from "antd";
import {
  PageContainer,
  ProForm,
  ProFormDigit,
  ProFormSwitch,
  ProFormText,
} from "@ant-design/pro-components";
import {
  adminGetOrgLLM,
  adminProbeOrgLLMTools,
  adminPutOrgLLM,
  formatLLMToolsProbe,
  type OrgLLMSettings,
} from "../api";

const { Paragraph, Text } = Typography;

export default function LLMPage() {
  const [llm, setLlm] = useState<OrgLLMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [probeMsg, setProbeMsg] = useState("");
  const [form] = Form.useForm();

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

  return (
    <PageContainer title="默认模型">
      <Card loading={loading}>
        <Paragraph type="secondary">
          成员无个人默认模型时，聊天使用此处配置（密钥脱敏回显
          {llm?.api_key_hint ? `：${llm.api_key_hint}` : ""}）。
          优先级：个人默认/首个连接 &gt; 组织默认 &gt; 无。
          勾选「启用 tools」前请先检测上游是否支持 function calling；不支持时无法保存开启状态。
        </Paragraph>
        <ProForm
          form={form}
          layout="vertical"
          style={{ maxWidth: 560 }}
          submitter={{
            searchConfig: { submitText: "保存" },
            render: (_, dom) => (
              <Space>
                {dom}
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
          <ProFormText name="model" label="模型" />
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
        {probeMsg ? (
          <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            {probeMsg}
          </Text>
        ) : null}
      </Card>
    </PageContainer>
  );
}
