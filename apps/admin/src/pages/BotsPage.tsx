import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Checkbox, Popconfirm, Space, Spin, Typography, message } from "antd";
import {
  ModalForm,
  PageContainer,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
} from "@ant-design/pro-components";
import {
  adminCreateBot,
  adminDeleteBot,
  adminListBotSkills,
  adminListBots,
  adminListUsers,
  adminPatchBot,
  adminSetBotSkill,
  type AdminBot,
  type AdminBotSkill,
  type AdminUser,
} from "../api";
import { LIST_PAGINATION } from "../pagination";

const { Paragraph, Text } = Typography;

const MODE_OPTIONS = [
  { label: "团队模式", value: "team" },
  { label: "私人模式", value: "private" },
];

function BotSkillsEditor({ botId }: { botId: string }) {
  const [skills, setSkills] = useState<AdminBotSkill[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListBotSkills(botId);
      setSkills(data.skills || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spin size="small" tip="加载技能…" />;

  const visible = skills.filter((s) => s.account_enabled !== false);

  return (
    <div style={{ marginTop: 8 }}>
      <Text strong>启用的技能</Text>
      <Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
        仅勾选本 Bot 可用技能；正文请到「技能」页编辑。名称可点进编辑页。
      </Paragraph>
      {visible.length === 0 ? (
        <Text type="secondary">暂无可用技能</Text>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }} size={4}>
          {visible.map((s) => (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Checkbox
                checked={s.enabled}
                disabled={Boolean(s.disable_blocked || s.always_on)}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  try {
                    const updated = await adminSetBotSkill(botId, s.name, checked);
                    setSkills((prev) => prev.map((x) => (x.name === s.name ? { ...x, ...updated } : x)));
                  } catch (err) {
                    message.error(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
              <Link to={`/skills/${encodeURIComponent(s.name)}`}>{s.name}</Link>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {s.custom ? "自建" : "内置"}
                {s.always_on || s.disable_blocked ? " · 技能发现（不可关闭）" : ""}
              </Text>
            </div>
          ))}
        </Space>
      )}
    </div>
  );
}

export default function BotsPage() {
  const actionRef = useRef<ActionType>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBot | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const data = await adminListUsers();
      setUsers(data.users || []);
    } catch {
      /* ignore for owner select */
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const reload = useCallback(() => {
    void actionRef.current?.reload();
  }, []);

  const columns: ProColumns<AdminBot>[] = [
    { title: "名称", dataIndex: "name", copyable: true },
    {
      title: "所有者",
      dataIndex: "owner_username",
      width: 140,
      render: (_, row) => row.owner_username || row.user_id,
    },
    {
      title: "描述",
      dataIndex: "description",
      ellipsis: true,
      render: (_, row) => row.description || "—",
    },
    {
      title: "电脑模式",
      dataIndex: "computer_mode",
      width: 110,
      valueEnum: {
        team: { text: "团队" },
        private: { text: "私人" },
      },
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      valueType: "dateTime",
      width: 180,
      defaultSortOrder: "descend",
      sorter: (a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")),
    },
    {
      title: "操作",
      valueType: "option",
      width: 140,
      render: (_, row) => [
        <a
          key="edit"
          onClick={() => {
            setEditing(row);
            setEditOpen(true);
          }}
        >
          编辑
        </a>,
        row.is_builtin ? (
          <span key="del" style={{ color: "#999" }}>
            删除
          </span>
        ) : (
          <Popconfirm
            key="del"
            title="确认软删除该 Bot？数据仍保留在库中。"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                await adminDeleteBot(row.id);
                message.success("已软删除");
                reload();
              } catch (err) {
                message.error(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <a style={{ color: "#ff4d4f" }}>删除</a>
          </Popconfirm>
        ),
      ],
    },
  ];

  return (
    <PageContainer title="Bot 管理">
      <Paragraph type="secondary">
        管理本组织成员名下的助手（Bot）：创建、编辑系统提示与电脑模式、删除。技能正文在「技能」页维护；此处仅勾选启用。
      </Paragraph>
      <ProTable<AdminBot>
        headerTitle="Bot 列表"
        actionRef={actionRef}
        rowKey="id"
        search={false}
        options={{ reload: true }}
        pagination={{ ...LIST_PAGINATION }}
        toolBarRender={() => [
          <ModalForm
            key="create"
            title="创建 Bot"
            trigger={<Button type="primary" style={{ minWidth: "max-content", paddingInline: 14 }}>新建 Bot</Button>}
            modalProps={{ destroyOnClose: true }}
            initialValues={{ computer_mode: "team" }}
            onOpenChange={(open) => {
              if (open) void loadUsers();
            }}
            onFinish={async (values) => {
              try {
                await adminCreateBot({
                  user_id: String(values.user_id),
                  name: String(values.name).trim(),
                  description: values.description ? String(values.description) : "",
                  system_prompt: values.system_prompt ? String(values.system_prompt) : "",
                  computer_mode: String(values.computer_mode || "team"),
                });
                message.success("已创建");
                reload();
                return true;
              } catch (err) {
                message.error(err instanceof Error ? err.message : String(err));
                return false;
              }
            }}
          >
            <ProFormSelect
              name="user_id"
              label="所属用户"
              options={users.map((u) => ({
                label: `${u.username}（${u.role}）`,
                value: u.id,
              }))}
              rules={[{ required: true, message: "请选择所属用户" }]}
              showSearch
            />
            <ProFormText name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]} />
            <ProFormTextArea name="description" label="描述" fieldProps={{ rows: 2 }} />
            <ProFormTextArea name="system_prompt" label="系统提示" fieldProps={{ rows: 4 }} />
            <ProFormSelect name="computer_mode" label="电脑模式" options={MODE_OPTIONS} />
          </ModalForm>,
        ]}
        columns={columns}
        request={async () => {
          try {
            const data = await adminListBots();
            const bots = data.bots || [];
            return { data: bots, success: true, total: bots.length };
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            return { data: [], success: false, total: 0 };
          }
        }}
      />

      <ModalForm
        title="编辑 Bot"
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditing(null);
        }}
        modalProps={{ destroyOnClose: true, width: 640 }}
        initialValues={{
          name: editing?.name,
          description: editing?.description || "",
          system_prompt: editing?.system_prompt || "",
          computer_mode: editing?.computer_mode || "team",
        }}
        onFinish={async (values) => {
          if (!editing) return false;
          try {
            await adminPatchBot(editing.id, {
              name: String(values.name).trim(),
              description: values.description ? String(values.description) : "",
              system_prompt: values.system_prompt ? String(values.system_prompt) : "",
              computer_mode: String(values.computer_mode || "team"),
            });
            message.success("已更新");
            reload();
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            return false;
          }
        }}
      >
        <ProFormText name="name" label="名称" rules={[{ required: true }]} />
        <ProFormTextArea name="description" label="描述" fieldProps={{ rows: 2 }} />
        <ProFormTextArea name="system_prompt" label="系统提示" fieldProps={{ rows: 4 }} />
        <ProFormSelect name="computer_mode" label="电脑模式" options={MODE_OPTIONS} />
        {editing ? <BotSkillsEditor botId={editing.id} /> : null}
      </ModalForm>
    </PageContainer>
  );
}
