import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Popconfirm, Space, Switch, Tag, Typography, message } from "antd";
import {
  ModalForm,
  PageContainer,
  ProFormDigit,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
  ProTable,
  type ActionType,
  type ProColumns,
} from "@ant-design/pro-components";
import {
  adminCreateOnboardingPreset,
  adminDeleteOnboardingPreset,
  adminListOnboardingPresets,
  adminPatchOnboardingPreset,
  adminReorderOnboardingPresets,
  type AdminOnboardingPreset,
} from "../api";
import { LIST_PAGINATION } from "../pagination";

const { Paragraph, Text } = Typography;

type FormValues = {
  id: string;
  title: string;
  card_desc?: string;
  user_prompt?: string;
  description?: string;
  system_prompt?: string;
  skills_text?: string;
  sort_order?: number;
  enabled?: boolean;
  is_custom_fallback?: boolean;
};

function skillsTextFromJSON(raw: string): string {
  const s = (raw || "").trim();
  if (!s || s === "null") return "";
  if (s === "__curated__") return "__curated__";
  try {
    const arr = JSON.parse(s) as unknown;
    if (Array.isArray(arr)) return arr.map(String).join("\n");
  } catch {
    /* keep raw */
  }
  return s;
}

function skillsJSONFromText(text: string | undefined): string {
  const raw = (text || "").trim();
  if (!raw) return "null";
  if (raw === "__curated__") return "__curated__";
  if (raw.startsWith("[")) {
    JSON.parse(raw); // validate
    return raw;
  }
  const lines = raw
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return JSON.stringify(lines);
}

export default function OnboardingPage() {
  const actionRef = useRef<ActionType>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<AdminOnboardingPreset | null>(null);
  const [rows, setRows] = useState<AdminOnboardingPreset[]>([]);

  const reload = useCallback(() => {
    void actionRef.current?.reload();
  }, []);

  const move = useCallback(
    async (id: string, dir: -1 | 1) => {
      const ids = rows.map((r) => r.id);
      const idx = ids.indexOf(id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= ids.length) return;
      const next = [...ids];
      [next[idx], next[j]] = [next[j], next[idx]];
      try {
        await adminReorderOnboardingPresets(next);
        message.success("已调整顺序");
        reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
    [rows, reload],
  );

  const columns: ProColumns<AdminOnboardingPreset>[] = useMemo(
    () => [
      {
        title: "排序",
        dataIndex: "sort_order",
        width: 88,
        search: false,
        render: (_, row) => (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => void move(row.id, -1)}>
              ↑
            </Button>
            <Button type="link" size="small" onClick={() => void move(row.id, 1)}>
              ↓
            </Button>
            <Text type="secondary">{row.sort_order}</Text>
          </Space>
        ),
      },
      {
        title: "Key",
        dataIndex: "id",
        width: 120,
        copyable: true,
      },
      {
        title: "标题",
        dataIndex: "title",
        ellipsis: true,
      },
      {
        title: "卡片说明",
        dataIndex: "card_desc",
        ellipsis: true,
        search: false,
      },
      {
        title: "状态",
        dataIndex: "enabled",
        width: 160,
        search: false,
        render: (_, row) => (
          <Space size={4} wrap>
            <Switch
              size="small"
              checked={row.enabled}
              onChange={async (checked) => {
                try {
                  await adminPatchOnboardingPreset(row.id, { enabled: checked });
                  reload();
                } catch (err) {
                  message.error(err instanceof Error ? err.message : String(err));
                }
              }}
            />
            {row.is_custom_fallback ? <Tag color="blue">自定义回落</Tag> : null}
          </Space>
        ),
      },
      {
        title: "操作",
        valueType: "option",
        width: 160,
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
          <Popconfirm
            key="del"
            title={`删除选项「${row.title}」？`}
            description="客户端下次拉取将不再显示；已用该方向的 Bot 人设不受影响。"
            onConfirm={async () => {
              try {
                await adminDeleteOnboardingPreset(row.id);
                message.success("已删除");
                reload();
              } catch (err) {
                message.error(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <a style={{ color: "var(--ant-color-error)" }}>删除</a>
          </Popconfirm>,
        ],
      },
    ],
    [move, reload],
  );

  return (
    <PageContainer title="岗位引导">
      <Paragraph type="secondary">
        配置空会话岗位引导卡上的选项（可增删改排序）。客户端通过{" "}
        <Text code>GET /v1/onboarding/presets</Text>{" "}
        拉取启用项；选中后由{" "}
        <Text code>{"POST /v1/agents/{id}/onboarding"}</Text>{" "}
        按本表写入岗位描述、人设与默认技能。自由输入映射到标记为「自定义回落」的选项（默认{" "}
        <Text code>E</Text>
        ）。技能字段填每行一个 slug，或 <Text code>__curated__</Text>（ curated 默认包），留空表示不改写
        agent_skills。
      </Paragraph>
      <ProTable<AdminOnboardingPreset>
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        search={false}
        pagination={LIST_PAGINATION}
        toolBarRender={() => [
          <Button key="add" type="primary" onClick={() => setCreateOpen(true)}>
            新建选项
          </Button>,
        ]}
        request={async () => {
          const data = await adminListOnboardingPresets();
          const list = data.presets || [];
          setRows(list);
          return { data: list, success: true, total: list.length };
        }}
      />

      <ModalForm<FormValues>
        title="新建岗位引导选项"
        open={createOpen}
        onOpenChange={setCreateOpen}
        modalProps={{ destroyOnClose: true }}
        initialValues={{ enabled: true, is_custom_fallback: false, sort_order: 60 }}
        onFinish={async (values) => {
          try {
            await adminCreateOnboardingPreset({
              id: values.id.trim(),
              title: values.title.trim(),
              card_desc: values.card_desc || "",
              user_prompt: values.user_prompt || "",
              description: values.description || "",
              system_prompt: values.system_prompt || "",
              skills_json: skillsJSONFromText(values.skills_text),
              sort_order: values.sort_order,
              enabled: values.enabled,
              is_custom_fallback: values.is_custom_fallback,
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
          name="id"
          label="Key"
          placeholder="如 G 或 micro_apps"
          rules={[{ required: true, message: "请输入 key" }]}
          extra="写入 focus 的稳定键；单字母会规范为大写。创建后不可改。"
        />
        <ProFormText name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]} />
        <ProFormText name="card_desc" label="卡片短说明" />
        <ProFormTextArea name="user_prompt" label="首条用户消息" fieldProps={{ rows: 3 }} />
        <ProFormTextArea name="description" label="写入岗位描述" fieldProps={{ rows: 3 }} />
        <ProFormTextArea name="system_prompt" label="写入人设 system_prompt" fieldProps={{ rows: 4 }} />
        <ProFormTextArea
          name="skills_text"
          label="默认技能"
          extra="每行一个 skill slug；或 __curated__；留空=不改写 agent_skills"
          fieldProps={{ rows: 4 }}
        />
        <ProFormDigit name="sort_order" label="排序值" min={0} fieldProps={{ precision: 0 }} />
        <ProFormSwitch name="enabled" label="启用" />
        <ProFormSwitch name="is_custom_fallback" label="作为自由输入回落" />
      </ModalForm>

      <ModalForm<FormValues>
        title={editing ? `编辑「${editing.title}」` : "编辑"}
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditing(null);
        }}
        modalProps={{ destroyOnClose: true }}
        initialValues={
          editing
            ? {
                id: editing.id,
                title: editing.title,
                card_desc: editing.card_desc,
                user_prompt: editing.user_prompt,
                description: editing.description,
                system_prompt: editing.system_prompt,
                skills_text: skillsTextFromJSON(editing.skills_json),
                sort_order: editing.sort_order,
                enabled: editing.enabled,
                is_custom_fallback: editing.is_custom_fallback,
              }
            : undefined
        }
        onFinish={async (values) => {
          if (!editing) return false;
          try {
            await adminPatchOnboardingPreset(editing.id, {
              title: values.title.trim(),
              card_desc: values.card_desc || "",
              user_prompt: values.user_prompt || "",
              description: values.description || "",
              system_prompt: values.system_prompt || "",
              skills_json: skillsJSONFromText(values.skills_text),
              sort_order: values.sort_order,
              enabled: values.enabled,
              is_custom_fallback: values.is_custom_fallback,
            });
            message.success("已保存");
            reload();
            return true;
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            return false;
          }
        }}
      >
        <ProFormText name="id" label="Key" disabled />
        <ProFormText name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]} />
        <ProFormText name="card_desc" label="卡片短说明" />
        <ProFormTextArea name="user_prompt" label="首条用户消息" fieldProps={{ rows: 3 }} />
        <ProFormTextArea name="description" label="写入岗位描述" fieldProps={{ rows: 3 }} />
        <ProFormTextArea name="system_prompt" label="写入人设 system_prompt" fieldProps={{ rows: 4 }} />
        <ProFormTextArea
          name="skills_text"
          label="默认技能"
          extra="每行一个 skill slug；或 __curated__；留空=不改写 agent_skills"
          fieldProps={{ rows: 4 }}
        />
        <ProFormDigit name="sort_order" label="排序值" min={0} fieldProps={{ precision: 0 }} />
        <ProFormSwitch name="enabled" label="启用" />
        <ProFormSwitch name="is_custom_fallback" label="作为自由输入回落" />
      </ModalForm>
    </PageContainer>
  );
}
