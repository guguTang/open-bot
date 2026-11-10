import { useEffect, useState } from "react";
import { Alert, Card, Col, Row, Statistic, Table, message, Select, Space } from "antd";
import { PageContainer } from "@ant-design/pro-components";
import {
  CommentOutlined,
  MessageOutlined,
  RobotOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  adminGetUsage,
  getAdminScopeOrgId,
  type OrgUsage,
  type UsageRunDay,
} from "../api";

function formatEstimatedCost(row: {
  estimated_cost_minor?: number | null;
  currency?: string;
  unpriced_tokens?: number;
  unpriced_calls?: number;
} | null | undefined): string {
  const unpriced = (row?.unpriced_tokens ?? 0) > 0 || (row?.unpriced_calls ?? 0) > 0;
  const minor = row?.estimated_cost_minor;
  if (minor == null) return unpriced ? "未定价" : "—";
  const cur = row?.currency || "CNY";
  const amount = cur === "CNY" ? `¥${(minor / 100).toFixed(2)}` : `${cur} ${(minor / 100).toFixed(2)}`;
  return unpriced ? `${amount}（部分未定价）` : amount;
}

const costColumn = {
  title: "估算成本",
  key: "cost",
  render: (_: unknown, row: UsageRunDay) => formatEstimatedCost(row),
};

const splitColumns = [
  { title: "官方 token", dataIndex: "provider_tokens" as const },
  { title: "估算 token", dataIndex: "estimated_tokens" as const },
  { title: "未定价 token", dataIndex: "unpriced_tokens" as const },
  costColumn,
];

export default function UsagePage() {
  const [usage, setUsage] = useState<OrgUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    const orgId = getAdminScopeOrgId() || undefined;
    void adminGetUsage(days, orgId)
      .then(setUsage)
      .catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <PageContainer
      title="用量"
      extra={
        <Space>
          <span>统计窗口</span>
          <Select
            value={days}
            style={{ width: 120 }}
            onChange={setDays}
            options={[
              { value: 7, label: "近 7 天" },
              { value: 30, label: "近 30 天" },
              { value: 90, label: "近 90 天" },
            ]}
          />
        </Space>
      }
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="成员数" value={usage?.member_count ?? 0} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="会话数" value={usage?.conversation_count ?? 0} prefix={<CommentOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="消息数" value={usage?.message_count ?? 0} prefix={<MessageOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="助手数" value={usage?.agent_count ?? 0} prefix={<RobotOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Runs" value={usage?.run_count ?? 0} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Prompt tokens" value={usage?.prompt_tokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Completion tokens" value={usage?.completion_tokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="Tokens（合计）" value={usage?.total_tokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="官方 token" value={usage?.provider_tokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="估算 token" value={usage?.estimated_tokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title="未定价 token" value={usage?.unpriced_tokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card loading={loading}>
            <Statistic title={`估算成本（${usage?.currency || "CNY"}）`} value={formatEstimatedCost(usage)} />
          </Card>
        </Col>
      </Row>
      {usage?.usage_source === "mixed" ? (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="合计含官方与估算，不是官方用量"
        />
      ) : null}

      <Card title="按日" style={{ marginTop: 16 }} loading={loading}>
        <Table
          rowKey={(r) => r.day || String(Math.random())}
          size="small"
          pagination={false}
          dataSource={usage?.by_day || []}
          columns={[
            { title: "日期", dataIndex: "day" },
            { title: "Runs", dataIndex: "run_count" },
            { title: "Prompt", dataIndex: "prompt_tokens" },
            { title: "Completion", dataIndex: "completion_tokens" },
            { title: "合计", dataIndex: "total_tokens" },
            ...splitColumns,
          ]}
        />
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Card title="按用户" loading={loading}>
            <Table
              rowKey={(r) => r.user_id || r.username || String(Math.random())}
              size="small"
              pagination={false}
              dataSource={usage?.by_user || []}
              columns={[
                { title: "用户", dataIndex: "username" },
                { title: "Runs", dataIndex: "run_count" },
                { title: "合计 token", dataIndex: "total_tokens" },
                ...splitColumns,
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="按 Bot" loading={loading}>
            <Table
              rowKey={(r) => r.agent_id || r.agent_name || String(Math.random())}
              size="small"
              pagination={false}
              dataSource={usage?.by_bot || []}
              columns={[
                { title: "Bot", dataIndex: "agent_name" },
                { title: "Runs", dataIndex: "run_count" },
                { title: "合计 token", dataIndex: "total_tokens" },
                ...splitColumns,
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card title="按模型" style={{ marginTop: 16 }} loading={loading}>
        <Table
          rowKey={(r) => `${r.provider || ""}:${r.model || ""}`}
          size="small"
          pagination={false}
          dataSource={usage?.by_model || []}
          columns={[
            { title: "模型", dataIndex: "model" },
            { title: "提供方", dataIndex: "provider" },
            { title: "调用", dataIndex: "run_count" },
            { title: "合计 token", dataIndex: "total_tokens" },
            ...splitColumns,
          ]}
        />
      </Card>
    </PageContainer>
  );
}
