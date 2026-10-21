import { useEffect, useState } from "react";
import { Card, Form, message, Typography } from "antd";
import {
  PageContainer,
  ProForm,
  ProFormSelect,
  ProFormTextArea,
} from "@ant-design/pro-components";
import { adminGetFeatureFlags, adminPutFeatureFlags } from "../api";

const { Paragraph, Text } = Typography;

/** Org feature_flags_json.auto_pick — UE labels for group Auto-pick. */
const AUTO_PICK_OPTIONS = [
  {
    value: "off",
    label: "全员自决",
    title: "无人 @ 时全员候选，各 bot 可 PASS（现状）",
  },
  {
    value: "heuristic",
    label: "智能匹配",
    title: "按关键词 / 角色启发选 ≤K 人；默认",
  },
  {
    value: "decision",
    label: "决策模型",
    title: "用组织「决策模型」页配置的 Jev / Laya / Microsoft 选人；失败则回落智能匹配",
  },
] as const;

type AutoPickMode = (typeof AUTO_PICK_OPTIONS)[number]["value"];

function parseFlags(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function normalizeAutoPick(raw: unknown): AutoPickMode {
  if (raw === false || raw === 0 || raw === "off" || raw === "false" || raw === "0") {
    return "off";
  }
  if (raw === "decision" || raw === "b" || raw === "llm" || raw === "model") {
    return "decision";
  }
  // true / omit / heuristic / unknown → heuristic (product default)
  return "heuristic";
}

function mergeAutoPick(rawJson: string, autoPick: AutoPickMode): string {
  const obj = parseFlags(rawJson);
  obj.auto_pick = autoPick;
  return JSON.stringify(obj, null, 2);
}

export default function FlagsPage() {
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();

  useEffect(() => {
    setLoading(true);
    void adminGetFeatureFlags()
      .then((data) => {
        const raw = data.feature_flags_json || "{}";
        const flags = parseFlags(raw);
        form.setFieldsValue({
          auto_pick: normalizeAutoPick(flags.auto_pick),
          feature_flags_json: raw.trim() ? raw : "{}",
        });
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [form]);

  return (
    <PageContainer title="功能开关">
      <Card loading={loading}>
        <Paragraph type="secondary">
          组织级开关（唯一生效来源）。群 Auto 选人模式由本页控制，客户端无需配置群级{" "}
          <Text code>auto_pick</Text>；频道里若仍有历史字段会被忽略。
          「决策模型」模式需在侧栏「决策模型」页配置 Jev / Laya / Microsoft / 自定义（默认关闭；任意 System One 兼容端点或 Unsloth 桌面可选「自定义」并填 base_url + model）。
        </Paragraph>
        <ProForm
          form={form}
          layout="vertical"
          submitter={{ searchConfig: { submitText: "保存" } }}
          onFinish={async (values) => {
            try {
              const autoPick = normalizeAutoPick(values.auto_pick);
              const merged = mergeAutoPick(String(values.feature_flags_json || "{}"), autoPick);
              JSON.parse(merged);
              const data = await adminPutFeatureFlags(merged);
              const saved = data.feature_flags_json || "{}";
              const flags = parseFlags(saved);
              form.setFieldsValue({
                auto_pick: normalizeAutoPick(flags.auto_pick),
                feature_flags_json: saved,
              });
              message.success("功能开关已保存");
              return true;
            } catch (err) {
              message.error(err instanceof Error ? err.message : "JSON 无效");
              return false;
            }
          }}
        >
          <ProFormSelect
            name="auto_pick"
            label="群 Auto 选人"
            options={AUTO_PICK_OPTIONS.map((o) => ({
              value: o.value,
              label: `${o.label}（${o.value}）`,
              title: o.title,
            }))}
            rules={[{ required: true, message: "请选择选人策略" }]}
            extra="无人 @ 时如何选回复成员：全员自决 / 智能匹配 / 决策模型。有 @ 或 @everyone 仍强制点名，不受此项影响。"
            fieldProps={{
              optionRender: (option) => {
                const meta = AUTO_PICK_OPTIONS.find((o) => o.value === option.value);
                return (
                  <div>
                    <div>{option.label}</div>
                    {meta ? (
                      <div style={{ fontSize: 12, opacity: 0.65 }}>{meta.title}</div>
                    ) : null}
                  </div>
                );
              },
            }}
          />
          <ProFormTextArea
            name="feature_flags_json"
            label="高级 · 原始 JSON"
            extra="保存时会把上方「群 Auto 选人」写回 auto_pick 字段；可在此编辑其它开关。"
            fieldProps={{
              rows: 10,
              style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
            }}
            rules={[{ required: true, message: "请输入 JSON" }]}
          />
        </ProForm>
      </Card>
    </PageContainer>
  );
}
