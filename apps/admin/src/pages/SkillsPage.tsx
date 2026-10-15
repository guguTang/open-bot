import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Dropdown,
  Input,
  Popconfirm,
  Popover,
  Switch,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import {
  ModalForm,
  PageContainer,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
} from "@ant-design/pro-components";
import { EllipsisOutlined, PlusOutlined } from "@ant-design/icons";
import {
  adminDeleteSkill,
  adminExportSkillZip,
  adminImportSkillZip,
  adminListSkills,
  adminPatchSkill,
  adminUpsertSkill,
  type AdminSkill,
} from "../api";
import { LIST_PAGINATION } from "../pagination";

const { Paragraph, Text } = Typography;

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SkillsPage() {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [keyword, setKeyword] = useState("");

  const reload = useCallback(() => {
    void actionRef.current?.reload();
  }, []);

  const columns: ProColumns<AdminSkill>[] = [
    {
      title: "名称",
      dataIndex: "name",
      width: 180,
      render: (_, row) => (
        <a onClick={() => navigate(`/skills/${encodeURIComponent(row.name)}`)}>{row.name}</a>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      ellipsis: { showTitle: true },
    },
    {
      title: "来源",
      dataIndex: "source",
      width: 90,
      render: (_, row) =>
        row.source === "builtin" ? <Tag color="blue">内置</Tag> : <Tag>自建</Tag>,
    },
    {
      title: "启用 Bot",
      dataIndex: "bot_count",
      width: 100,
      render: (_, row) => {
        const n = row.bot_count ?? 0;
        if (!n) return <Text type="secondary">0</Text>;
        return (
          <Popover
            title="启用该技能的 Bot"
            content={
              <div style={{ maxWidth: 260 }}>
                {(row.bots || []).map((b) => (
                  <div key={b.id}>{b.name}</div>
                ))}
              </div>
            }
          >
            <a>{n}</a>
          </Popover>
        );
      },
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (_, row) => (
        <Switch
          checked={row.enabled}
          disabled={Boolean(row.disable_blocked || row.always_on)}
          title={
            row.disable_blocked || row.always_on
              ? "find-skills 为技能发现入口，关闭后将失去技能发现能力"
              : undefined
          }
          onChange={async (checked) => {
            try {
              await adminPatchSkill(row.name, { enabled: checked });
              message.success(checked ? "已启用" : "已下架");
              reload();
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 140,
      defaultSortOrder: "descend",
      sorter: (a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")),
      render: (_, row) => fmtTime(row.updated_at),
    },
    {
      title: "操作",
      valueType: "option",
      width: 80,
      render: (_, row) => [
        <Dropdown
          key="more"
          menu={{
            items: [
              {
                key: "edit",
                label: "编辑",
                onClick: () => navigate(`/skills/${encodeURIComponent(row.name)}`),
              },
              {
                key: "export",
                label: "导出 zip",
                onClick: () => {
                  void adminExportSkillZip(row.name)
                    .then(() => message.success(`已导出 ${row.name}.zip`))
                    .catch((err) => message.error(err instanceof Error ? err.message : String(err)));
                },
              },
              ...(row.disable_blocked || row.always_on
                ? []
                : [
                    {
                      key: "del",
                      label: (
                        <Popconfirm
                          title="确认删除该平台技能？"
                          description="用户侧目录会随之消失。"
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          onConfirm={async () => {
                            try {
                              await adminDeleteSkill(row.name);
                              message.success("已删除");
                              reload();
                            } catch (err) {
                              message.error(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          <span style={{ color: "#ff4d4f" }}>删除</span>
                        </Popconfirm>
                      ),
                    },
                  ]),
            ],
          }}
        >
          <a>
            <EllipsisOutlined />
          </a>
        </Dropdown>,
      ],
    },
  ];

  return (
    <PageContainer title="技能">
      <Paragraph type="secondary">
        平台级技能包（全局共享）。必有 <code>SKILL.md</code>，可含 <code>references/</code>、
        <code>scripts/</code> 等。列表点名称进入全页编辑器。Bot 页仅勾选启用，不在此编辑正文。
      </Paragraph>
      <ProTable<AdminSkill>
        headerTitle="技能列表"
        actionRef={actionRef}
        rowKey="name"
        search={false}
        options={{ reload: true }}
        pagination={{ ...LIST_PAGINATION }}
        toolbar={{
          search: (
            <Input.Search
              allowClear
              placeholder="搜索名称 / 描述"
              style={{ width: 240 }}
              onSearch={(v) => setKeyword(v.trim())}
              onChange={(e) => {
                if (!e.target.value) setKeyword("");
              }}
            />
          ),
        }}
        toolBarRender={() => [
          <Dropdown
            key="new"
            menu={{
              items: [
                {
                  key: "create",
                  label: "新建空技能",
                  onClick: () => setCreateOpen(true),
                },
                {
                  key: "import",
                  label: (
                    <Upload
                      accept=".zip,application/zip"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        setImporting(true);
                        void adminImportSkillZip(file)
                          .then((sk) => {
                            message.success(`已导入「${sk.name}」`);
                            reload();
                            navigate(`/skills/${encodeURIComponent(sk.name)}`);
                          })
                          .catch((err) => message.error(err instanceof Error ? err.message : String(err)))
                          .finally(() => setImporting(false));
                        return false;
                      }}
                    >
                      <span>上传 zip</span>
                    </Upload>
                  ),
                },
              ],
            }}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={importing}
              className="openbot-toolbar-new-btn"
              style={{ minWidth: 88, paddingInline: 14 }}
            >
              新建
            </Button>
          </Dropdown>,
        ]}
        columns={columns}
        request={async () => {
          try {
            const data = await adminListSkills(true);
            let list = data.skills || [];
            const q = keyword.toLowerCase();
            if (q) {
              list = list.filter(
                (s) =>
                  s.name.toLowerCase().includes(q) ||
                  (s.description || "").toLowerCase().includes(q),
              );
            }
            return { data: list, success: true, total: list.length };
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            return { data: [], success: false };
          }
        }}
        params={{ keyword }}
      />

      <ModalForm
        title="新建技能"
        open={createOpen}
        modalProps={{ destroyOnClose: true, onCancel: () => setCreateOpen(false) }}
        onFinish={async (values) => {
          try {
            const name = String(values.name || "").trim();
            await adminUpsertSkill({
              name,
              description: String(values.description || "").trim(),
              body_markdown: String(values.body_markdown || ""),
              enabled: values.enabled !== false,
            });
            message.success("已创建");
            setCreateOpen(false);
            reload();
            navigate(`/skills/${encodeURIComponent(name)}`);
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            return false;
          }
        }}
      >
        <ProFormText
          name="name"
          label="名称"
          placeholder="my-helper"
          rules={[
            { required: true, message: "必填" },
            { pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, message: "小写字母、数字与连字符" },
          ]}
        />
        <ProFormText
          name="description"
          label="描述"
          rules={[{ required: true, message: "必填（路由与目录用）" }]}
        />
        <ProFormTextArea
          name="body_markdown"
          label="SKILL.md 正文（可不含 frontmatter；留空则用模板）"
          fieldProps={{ rows: 10, style: { fontFamily: "ui-monospace, Menlo, monospace" } }}
        />
        <ProFormSwitch name="enabled" label="启用" initialValue={true} />
      </ModalForm>
    </PageContainer>
  );
}
