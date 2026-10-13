import { useCallback, useRef, useState } from "react";
import { uniq } from "es-toolkit";
import { Button, Drawer, Popconfirm, Switch, Tabs, Typography, message } from "antd";
import {
  ModalForm,
  PageContainer,
  ProForm,
  ProFormSelect,
  ProFormText,
  ProTable,
  type ActionType,
  type ProColumns,
} from "@ant-design/pro-components";
import {
  adminBatchDeleteUsers,
  adminCreateUser,
  adminDeleteUser,
  adminDeleteUserMachine,
  adminPurgeUserData,
  adminInviteMember,
  adminListMembers,
  adminListUserMachines,
  adminListUserSkills,
  adminListUsers,
  adminPatchUser,
  adminSetUserSkill,
  type AdminInvite,
  type AdminMachine,
  type AdminUser,
  type AdminUserSkill,
} from "../api";
import { useAuth } from "../auth/AuthContext";
import { LIST_PAGINATION } from "../pagination";

const { Paragraph } = Typography;

const ROLE_OPTIONS_BASE = [
  { label: "成员（终端用户 / 聊天）", value: "member" },
  { label: "组织管理员", value: "org_admin" },
  { label: "平台管理员", value: "platform_admin" },
];

export default function UsersPage() {
  const { user, refreshMe } = useAuth();
  const usersAction = useRef<ActionType>(null);
  const invitesAction = useRef<ActionType>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [skillsUser, setSkillsUser] = useState<AdminUser | null>(null);
  const [userSkills, setUserSkills] = useState<AdminUserSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [machinesUser, setMachinesUser] = useState<AdminUser | null>(null);
  const [userMachines, setUserMachines] = useState<AdminMachine[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(false);

  const loadUserMachines = useCallback(async (row: AdminUser) => {
    setMachinesUser(row);
    setMachinesLoading(true);
    try {
      const data = await adminListUserMachines(row.id);
      setUserMachines(data.machines || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setMachinesLoading(false);
    }
  }, []);

  const roleOptions =
    user?.role === "platform_admin"
      ? ROLE_OPTIONS_BASE
      : ROLE_OPTIONS_BASE.filter((o) => o.value !== "platform_admin");

  const reload = useCallback(() => {
    void usersAction.current?.reload();
    void invitesAction.current?.reload();
  }, []);

  const columns: ProColumns<AdminUser>[] = [
    { title: "用户名", dataIndex: "username", copyable: true },
    {
      title: "邮箱",
      dataIndex: "email",
      render: (_, row) => row.email || "—",
    },
    {
      title: "角色",
      dataIndex: "role",
      width: 140,
      valueEnum: {
        member: { text: "成员" },
        org_admin: { text: "组织管理员" },
        platform_admin: { text: "平台管理员" },
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      valueType: "dateTime",
      width: 180,
      defaultSortOrder: "descend",
      sorter: (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")),
    },
    {
      title: "操作",
      valueType: "option",
      width: 340,
      render: (_, row) => [
        <a
          key="machines"
          onClick={() => {
            void loadUserMachines(row);
          }}
        >
          设备
        </a>,
        <a
          key="skills"
          onClick={() => {
            setSkillsUser(row);
            setSkillsLoading(true);
            void adminListUserSkills(row.id)
              .then((data) => setUserSkills(data.skills || []))
              .catch((err) => message.error(err instanceof Error ? err.message : String(err)))
              .finally(() => setSkillsLoading(false));
          }}
        >
          技能
        </a>,
        <a
          key="edit"
          onClick={() => {
            setEditing(row);
            setEditOpen(true);
          }}
        >
          编辑
        </a>,
        <Popconfirm
          key="purge"
          title="删除该用户全部业务数据，保留账号"
          description="将永久删除对话、Bot、记忆、定时任务、设备、密钥、MCP、用量、运行环境文件与 Langfuse 调用追踪等；密码/角色/组织保留。此操作不可恢复。"
          okText="确认清空业务数据"
          okButtonProps={{ danger: true }}
          onConfirm={async () => {
            try {
              const res = await adminPurgeUserData(row.id);
              const lf = res.side_effects?.langfuse;
              message.success(
                lf ? `已清空业务数据（Langfuse: ${lf}）` : "已清空业务数据，账号已保留",
              );
              reload();
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <a style={{ color: "#ff4d4f" }}>清空业务数据</a>
        </Popconfirm>,
        row.id === user?.id ? (
          <span key="del" style={{ color: "#999" }}>
            删除
          </span>
        ) : (
          <Popconfirm
            key="del"
            title="确认删除该用户？此操作不可恢复"
            description="将清空该用户的会话、记忆、用量、机器、密钥、上传、运行环境、Mem0、Langfuse traces 等业务数据，然后软删除账号（users/agents 行保留 deleted_at 供审计）。删除后无法从管理端恢复。"
            okText="确认删除（清空数据并软删账号）"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              try {
                await adminDeleteUser(row.id);
                message.success("已删除（业务数据已清空）");
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

  const inviteColumns: ProColumns<AdminInvite>[] = [
    { title: "用户名或邮箱", dataIndex: "username_or_email" },
    {
      title: "角色",
      dataIndex: "role",
      valueEnum: {
        member: { text: "成员" },
        org_admin: { text: "组织管理员" },
        platform_admin: { text: "平台管理员" },
      },
    },
    { title: "状态", dataIndex: "status", width: 100 },
    {
      title: "创建时间",
      dataIndex: "created_at",
      valueType: "dateTime",
      width: 180,
      defaultSortOrder: "descend",
      sorter: (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")),
    },
  ];

  return (
    <PageContainer title="用户管理">
      <Tabs
        items={[
          {
            key: "users",
            label: "用户列表",
            children: (
              <>
                <Paragraph type="secondary">
                  创建组织内用户、重置密码、调整角色。系统账号不可见/不可删。「删除」会先清空该用户全部业务数据（会话、记忆、用量、设备、密钥、上传、运行环境、Mem0、Langfuse
                  traces 等，与「清空业务数据」相同），再软删除账号（users/agents 行保留 deleted_at 供审计）。「清空业务数据」只硬清业务数据并保留可登录账号（密码/角色/组织不变）。
                </Paragraph>
                <ProTable<AdminUser>
                  headerTitle="用户"
                  actionRef={usersAction}
                  rowKey="id"
                  search={false}
                  options={{ reload: true }}
                  pagination={{ ...LIST_PAGINATION }}
                  rowSelection={{
                    selectedRowKeys: selectedKeys,
                    onChange: (keys) => setSelectedKeys(keys as string[]),
                    getCheckboxProps: (row) => ({ disabled: row.id === user?.id }),
                  }}
                  toolBarRender={() => [
                    <Popconfirm
                      key="batch-delete"
                      title={`确认删除选中的 ${selectedKeys.length} 个用户？此操作不可恢复`}
                      description="将对每个用户先清空会话、记忆、用量、机器、密钥、上传、运行环境、Mem0、Langfuse traces 等业务数据，再软删除账号。部分失败时已清空并删除的不会回滚。"
                      okText="确认批量删除（清空数据并软删账号）"
                      okButtonProps={{ danger: true }}
                      disabled={selectedKeys.length === 0}
                      onConfirm={async () => {
                        try {
                          const res = await adminBatchDeleteUsers(selectedKeys);
                          setSelectedKeys([]);
                          const failed = res.failed || [];
                          const deleted = res.deleted || [];
                          if (failed.length) {
                            const detail = uniq(failed.map((f) => f.error)).join("；");
                            if (deleted.length) {
                              message.warning(
                                `已删除 ${deleted.length} 个用户（含数据清空），${failed.length} 个未删除：${detail}`,
                              );
                            } else {
                              message.error(detail || "删除失败");
                            }
                          } else {
                            message.success(`已删除 ${deleted.length} 个用户（业务数据已清空）`);
                          }
                          reload();
                        } catch (err) {
                          message.error(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      <Button danger disabled={selectedKeys.length === 0}>
                        批量删除
                      </Button>
                    </Popconfirm>,
                    <ModalForm
                      key="create"
                      title="创建用户"
                      trigger={<Button type="primary">新建用户</Button>}
                      modalProps={{ destroyOnClose: true }}
                      initialValues={{ role: "member" }}
                      onFinish={async (values) => {
                        try {
                          await adminCreateUser({
                            username: String(values.username).trim(),
                            password: String(values.password),
                            email: values.email ? String(values.email).trim() : undefined,
                            role: String(values.role || "member"),
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
                      <ProFormText
                        name="username"
                        label="用户名"
                        rules={[{ required: true, message: "请输入用户名" }]}
                      />
                      <ProFormText.Password
                        name="password"
                        label="密码"
                        rules={[{ required: true, message: "请输入密码" }]}
                      />
                      <ProFormText name="email" label="邮箱" />
                      <ProFormSelect
                        name="role"
                        label="角色"
                        options={roleOptions}
                        rules={[{ required: true }]}
                      />
                    </ModalForm>,
                  ]}
                  columns={columns}
                  request={async () => {
                    try {
                      const data = await adminListUsers();
                      return { data: data.users || [], success: true, total: (data.users || []).length };
                    } catch (err) {
                      message.error(err instanceof Error ? err.message : String(err));
                      return { data: [], success: false };
                    }
                  }}
                />
                <ModalForm
                  title="编辑用户"
                  open={editOpen}
                  onOpenChange={(open) => {
                    setEditOpen(open);
                    if (!open) setEditing(null);
                  }}
                  modalProps={{ destroyOnClose: true }}
                  initialValues={{
                    username: editing?.username || "",
                    email: editing?.email || "",
                    role: editing?.role || "member",
                    password: "",
                  }}
                  onFinish={async (values) => {
                    if (!editing) return false;
                    try {
                      const body: { email?: string; role?: string; password?: string } = {
                        email: values.email != null ? String(values.email).trim() : "",
                        role: String(values.role || "member"),
                      };
                      const pw = values.password ? String(values.password) : "";
                      if (pw) body.password = pw;
                      await adminPatchUser(editing.id, body);
                      message.success("已更新");
                      reload();
                      await refreshMe();
                      return true;
                    } catch (err) {
                      message.error(err instanceof Error ? err.message : String(err));
                      return false;
                    }
                  }}
                >
                  <ProFormText name="username" label="用户名" disabled />
                  <ProFormText name="email" label="邮箱" />
                  <ProFormSelect
                    name="role"
                    label="角色"
                    options={roleOptions}
                    rules={[{ required: true }]}
                    disabled={editing?.id === user?.id}
                  />
                  <ProFormText.Password
                    name="password"
                    label="重置密码"
                    placeholder="留空则不修改"
                  />
                  {editing ? (
                    <div style={{ marginTop: 16 }}>
                      <Popconfirm
                        title="删除该用户全部业务数据，保留账号"
                        description="将永久删除对话、Bot、记忆、定时任务、设备、密钥、MCP、用量、运行环境文件与 Langfuse 调用追踪等；密码/角色/组织保留。此操作不可恢复。"
                        okText="确认清空业务数据"
                        okButtonProps={{ danger: true }}
                        onConfirm={async () => {
                          try {
                            const res = await adminPurgeUserData(editing.id);
                            const lf = res.side_effects?.langfuse;
                            message.success(
                              lf ? `已清空业务数据（Langfuse: ${lf}）` : "已清空业务数据，账号已保留",
                            );
                            setEditOpen(false);
                            setEditing(null);
                            reload();
                          } catch (err) {
                            message.error(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        <Button danger>清空业务数据（保留账号）</Button>
                      </Popconfirm>
                    </div>
                  ) : null}
                </ModalForm>
              </>
            ),
          },
          {
            key: "invites",
            label: "邀请",
            children: (
              <>
                <ProForm
                  layout="inline"
                  submitter={{ searchConfig: { submitText: "邀请" } }}
                  initialValues={{ role: "member" }}
                  onFinish={async (values) => {
                    try {
                      const res = await adminInviteMember(
                        String(values.username).trim(),
                        String(values.role || "member"),
                      );
                      message.success(res.joined ? "已加入组织" : "已创建邀请");
                      reload();
                      return true;
                    } catch (err) {
                      message.error(err instanceof Error ? err.message : String(err));
                      return false;
                    }
                  }}
                  style={{ marginBottom: 16 }}
                >
                  <ProFormText
                    name="username"
                    placeholder="用户名或邮箱"
                    rules={[{ required: true, message: "请输入用户名或邮箱" }]}
                    width="md"
                  />
                  <ProFormSelect name="role" width="md" options={roleOptions} rules={[{ required: true }]} />
                </ProForm>
                <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  已注册用户会立即加入；未注册用户保留邀请，在用户端注册/登录后自动入组。完整 CRUD
                  请用「用户列表」页签。
                </Paragraph>
                <ProTable<AdminInvite>
                  headerTitle="待接受邀请"
                  actionRef={invitesAction}
                  rowKey="id"
                  search={false}
                  options={{ reload: true }}
                  pagination={false}
                  columns={inviteColumns}
                  request={async () => {
                    const data = await adminListMembers();
                    return { data: data.invites || [], success: true };
                  }}
                />
              </>
            ),
          },
        ]}
      />

      <Drawer
        title={skillsUser ? `技能权限 · ${skillsUser.username}` : "技能权限"}
        open={Boolean(skillsUser)}
        onClose={() => {
          setSkillsUser(null);
          setUserSkills([]);
        }}
        width={480}
        destroyOnClose
      >
        <Paragraph type="secondary">
          默认全部启用。关闭后该用户对话里不会出现对应 skill，也无法 load_skill。
        </Paragraph>
        <ProTable<AdminUserSkill>
          rowKey="name"
          search={false}
          options={false}
          pagination={false}
          loading={skillsLoading}
          dataSource={userSkills}
          columns={[
            { title: "技能", dataIndex: "name", width: 140 },
            { title: "说明", dataIndex: "description", ellipsis: true },
            {
              title: "可用",
              dataIndex: "enabled",
              width: 80,
              render: (_, row) => (
                <Switch
                  checked={row.enabled}
                  disabled={Boolean(row.disable_blocked || row.always_on)}
                  title={
                    row.disable_blocked || row.always_on
                      ? "find-skills 为技能发现入口，关闭后将无法发现生态技能"
                      : undefined
                  }
                  onChange={async (checked) => {
                    if (!skillsUser) return;
                    try {
                      const updated = await adminSetUserSkill(skillsUser.id, row.name, checked);
                      setUserSkills((prev) =>
                        prev.map((s) => (s.name === row.name ? { ...s, ...updated } : s)),
                      );
                    } catch (err) {
                      message.error(err instanceof Error ? err.message : String(err));
                    }
                  }}
                />
              ),
            },
          ]}
        />
      </Drawer>

      <Drawer
        title={machinesUser ? `注册设备 · ${machinesUser.username}` : "注册设备"}
        open={Boolean(machinesUser)}
        onClose={() => {
          setMachinesUser(null);
          setUserMachines([]);
        }}
        width={720}
        destroyOnClose
        extra={
          machinesUser ? (
            <Button
              size="small"
              loading={machinesLoading}
              onClick={() => void loadUserMachines(machinesUser)}
            >
              刷新
            </Button>
          ) : null
        }
      >
        <Paragraph type="secondary">
          桌面端 / 客户端注册的电脑。状态来自心跳；「执行通道」表示本机 exec WebSocket
          当前是否在线（可远程执行 host 操作）。
        </Paragraph>
        <ProTable<AdminMachine>
          rowKey="id"
          search={false}
          options={false}
          pagination={false}
          loading={machinesLoading}
          dataSource={userMachines}
          locale={{ emptyText: "该用户暂无注册设备" }}
          columns={[
            {
              title: "名称",
              dataIndex: "label",
              width: 140,
              render: (_, row) => row.label || row.machine_key || row.id,
            },
            {
              title: "平台",
              width: 160,
              render: (_, row) =>
                [row.platform || row.os, row.arch, row.app]
                  .filter(Boolean)
                  .join(" · ") || "—",
            },
            {
              title: "版本",
              dataIndex: "app_version",
              width: 90,
              render: (_, row) => row.app_version || "—",
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (_, row) => (row.status === "online" ? "在线" : "离线"),
            },
            {
              title: "执行通道",
              dataIndex: "connected",
              width: 90,
              render: (_, row) => (row.connected ? "已连接" : "未连接"),
            },
            {
              title: "文件操作",
              dataIndex: "file_op_count",
              width: 90,
            },
            {
              title: "最近心跳",
              dataIndex: "last_seen",
              valueType: "dateTime",
              width: 170,
            },
            {
              title: "注册时间",
              dataIndex: "created_at",
              valueType: "dateTime",
              width: 170,
            },
            {
              title: "操作",
              valueType: "option",
              width: 80,
              render: (_, row) => [
                <Popconfirm
                  key="del"
                  title="删除该设备注册记录？用户需重新打开客户端才会再次注册。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    if (!machinesUser) return;
                    try {
                      await adminDeleteUserMachine(machinesUser.id, row.id);
                      message.success("已删除");
                      setUserMachines((prev) => prev.filter((m) => m.id !== row.id));
                    } catch (err) {
                      message.error(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  <a style={{ color: "#ff4d4f" }}>删除</a>
                </Popconfirm>,
              ],
            },
          ]}
          expandable={{
            expandedRowRender: (row) => (
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.65)" }}>
                <div>
                  ID：<code>{row.id}</code>
                </div>
                <div>
                  machine_key：<code>{row.machine_key}</code>
                </div>
                <div>
                  OS：{row.os || "—"} · App：{row.app || "—"}
                </div>
              </div>
            ),
          }}
        />
      </Drawer>
    </PageContainer>
  );
}
