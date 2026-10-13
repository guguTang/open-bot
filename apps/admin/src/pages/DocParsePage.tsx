import { useEffect, useState } from "react";
import { Card, Form, message, Typography } from "antd";
import { PageContainer, ProForm, ProFormDigit } from "@ant-design/pro-components";
import { adminGetDocParse, adminPutDocParse, type DocParseSettings } from "../api";

const { Paragraph, Text } = Typography;

export default function DocParsePage() {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<DocParseSettings | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    setLoading(true);
    void adminGetDocParse()
      .then((data) => {
        setMeta(data);
        form.setFieldsValue({
          doc_parse_timeout_seconds:
            data.doc_parse_timeout_seconds ?? data.default_timeout_seconds ?? 60,
        });
      })
      .catch((err) => {
        message.error(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [form]);

  const min = meta?.min_timeout_seconds ?? 5;
  const max = meta?.max_timeout_seconds ?? 300;
  const def = meta?.default_timeout_seconds ?? 60;

  return (
    <PageContainer title="附件解析">
      <Card loading={loading}>
        <Paragraph type="secondary">
          聊天上传的 PDF / DOCX / XLSX / XLS / PPTX 在发送时抽成 Markdown，仅注入模型输入，
          <Text strong>不会写进会话消息正文</Text>（聊天界面只显示用户原话与附件卡片）。
          超时时间保存后立即对下一请求生效，无需重启 API 或解析侧车。
        </Paragraph>
        <ProForm
          form={form}
          layout="vertical"
          submitter={{ searchConfig: { submitText: "保存" } }}
          onFinish={async (values) => {
            try {
              const raw = values.doc_parse_timeout_seconds;
              const n = typeof raw === "number" ? raw : Number(raw);
              if (!Number.isFinite(n) || n < min || n > max) {
                message.error(`超时需在 ${min}–${max} 秒之间`);
                return false;
              }
              const data = await adminPutDocParse({ doc_parse_timeout_seconds: Math.round(n) });
              setMeta(data);
              form.setFieldsValue({
                doc_parse_timeout_seconds:
                  data.doc_parse_timeout_seconds ?? data.default_timeout_seconds ?? def,
              });
              message.success("附件解析超时已保存");
              return true;
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              return false;
            }
          }}
        >
          <ProFormDigit
            name="doc_parse_timeout_seconds"
            label="文档解析超时（秒）"
            min={min}
            max={max}
            fieldProps={{ precision: 0, addonAfter: "秒" }}
            extra={`单次 MarkItDown 转换上限。默认 ${def}，允许 ${min}–${max}。字段名 doc_parse_timeout_seconds。`}
            rules={[{ required: true, message: "请输入超时秒数" }]}
          />
        </ProForm>
      </Card>
    </PageContainer>
  );
}
