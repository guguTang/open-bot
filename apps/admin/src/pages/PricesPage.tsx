import { useEffect, useState } from "react";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography, message } from "antd";
import { PageContainer } from "@ant-design/pro-components";
import {
  adminCreatePrice,
  adminExpirePrice,
  adminListPrices,
  adminUpdatePrice,
  type ModelPrice,
} from "../api";
import { useAuth } from "../auth/AuthContext";

type PriceForm = {
  provider?: string;
  model: string;
  match_kind: "exact" | "prefix";
  input_per_million_minor: number;
  output_per_million_minor: number;
  cached_per_million_minor?: number | null;
  currency: string;
  note?: string;
  org_id?: string;
};

export default function PricesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "platform_admin";
  const [rows, setRows] = useState<ModelPrice[]>([]);
  const [policy, setPolicy] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ModelPrice | null>(null);
  const [form] = Form.useForm<PriceForm>();

  const load = () => {
    setLoading(true);
    void adminListPrices()
      .then((data) => {
        setRows(data.prices || []);
        setPolicy(data.cached_policy || "");
      })
      .catch((err: unknown) => message.error(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      match_kind: "exact",
      currency: "CNY",
      input_per_million_minor: 0,
      output_per_million_minor: 0,
      cached_per_million_minor: null,
      provider: "",
      model: "",
      note: "",
      org_id: "",
    });
    setOpen(true);
  };

  const openEdit = (row: ModelPrice) => {
    setEditing(row);
    form.setFieldsValue({
      provider: row.provider,
      model: row.model,
      match_kind: row.match_kind,
      input_per_million_minor: row.input_per_million_minor,
      output_per_million_minor: row.output_per_million_minor,
      cached_per_million_minor: row.cached_per_million_minor,
      currency: row.currency,
      note: row.note,
      org_id: row.org_id,
    });
    setOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const body = {
      ...values,
      cached_per_million_minor: values.cached_per_million_minor ?? null,
      org_id: values.org_id || "",
    };
    if (editing) {
      await adminUpdatePrice(editing.id, body);
    } else {
      await adminCreatePrice(body);
    }
    setOpen(false);
    load();
  };

  return (
    <PageContainer
      title="模型单价"
      extra={
        canEdit ? (
          <Button type="primary" onClick={openCreate}>
            新增单价
          </Button>
        ) : null
      }
    >
      <Typography.Paragraph type="secondary">
        单价按每百万 token 的最小货币单位（人民币为分）保存。记账时把当时生效的单价写进用量行，之后改价不会改历史估算。
        {policy ? ` ${policy}` : ""} 组织自带密钥，这里只估算，不扣费。留空组织 ID 表示平台默认；填写后仅该组织优先使用。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        size="small"
        columns={[
          { title: "组织", dataIndex: "org_id", render: (v: string) => v || "平台" },
          { title: "提供方", dataIndex: "provider", render: (v: string) => v || "任意" },
          { title: "模型", dataIndex: "model" },
          { title: "匹配", dataIndex: "match_kind", render: (v: string) => (v === "prefix" ? "前缀" : "精确") },
          { title: "输入 / 百万", dataIndex: "input_per_million_minor" },
          { title: "输出 / 百万", dataIndex: "output_per_million_minor" },
          {
            title: "缓存 / 百万",
            dataIndex: "cached_per_million_minor",
            render: (v: number | null) => (v == null ? "同输入" : v),
          },
          { title: "币种", dataIndex: "currency" },
          {
            title: "",
            key: "ops",
            render: (_: unknown, row: ModelPrice) =>
              canEdit ? (
                <Space>
                  <Button type="link" onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button
                    type="link"
                    danger
                    onClick={() => {
                      void adminExpirePrice(row.id).then(load).catch((err: unknown) => {
                        message.error(err instanceof Error ? err.message : String(err));
                      });
                    }}
                  >
                    停用
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title={editing ? "编辑单价" : "新增单价"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => {
          void save().catch((err: unknown) => message.error(err instanceof Error ? err.message : String(err)));
        }}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="org_id" label="组织 ID（空为平台）">
            <Input />
          </Form.Item>
          <Form.Item name="provider" label="提供方（空为任意）">
            <Input />
          </Form.Item>
          <Form.Item name="model" label="模型" rules={[{ required: true, message: "填写模型名" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="match_kind" label="匹配">
            <Select
              options={[
                { value: "exact", label: "精确" },
                { value: "prefix", label: "前缀" },
              ]}
            />
          </Form.Item>
          <Form.Item name="input_per_million_minor" label="输入单价（分 / 百万 token）" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="output_per_million_minor" label="输出单价（分 / 百万 token）" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="cached_per_million_minor" label="缓存单价（留空则按输入价）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="currency" label="币种">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
