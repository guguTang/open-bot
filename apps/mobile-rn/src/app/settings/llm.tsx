import { Button, Card, Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { LLMConnection, LLMInput } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { formatRelativeTime } from "@/lib/format";

/**
 * 模型（LLM）连接管理。行为对齐 `apps/web/src/App.tsx` 的 `settingsTab === "llm"` 分区。
 *
 * 与 Web 端的两点结构差异：
 * 1. Web 是「列表 + 同一个表单」上下排布，RN 上沿用同样结构 —— 移动端表单在下方，
 *    滚动到底部即可编辑，不需要再开一个二级路由。
 * 2. 密钥字段在服务端永不明文回传（只有 `api_key_set` / `api_key_hint`），
 *    所以编辑态的 api_key 一律从空串开始，留空代表「不修改」。
 */

/** 新建时的表单默认值，与 Web 端 `emptyLLMForm` 保持一致。 */
const emptyLLMForm: LLMInput = {
  name: "默认连接",
  base_url: "",
  api_key: "",
  model: "",
  enable_tools: false,
  is_default: true,
  context_window: null,
};

type FieldErrors = {
  name?: string;
};

export default function LlmSettingsScreen(): JSX.Element {
  // `useConfirm` 返回的是 `{ confirm }` 上下文对象，取方法本身再 await。
  const { confirm } = useConfirm();

  const [connections, setConnections] = useState<LLMConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LLMInput>(emptyLLMForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (): Promise<LLMConnection[]> => {
    try {
      setError(null);
      const list = await api.listLLMConnections();
      setConnections(list);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * `isDefault` 由列表长度推导：一条连接都没有时新建的那条自动成为默认，
   * 这样首个用户不必手动勾「设为默认」也能让聊天跑起来。
   */
  function resetForm(hasAny: boolean): void {
    setEditingId(null);
    setForm({ ...emptyLLMForm, is_default: !hasAny });
    setErrors({});
    setMsg("");
  }

  function patch(next: Partial<LLMInput>): void {
    setForm((prev) => ({ ...prev, ...next }));
  }

  /** 进入编辑态。api_key 故意置空：服务端不返回明文，字段里留着旧值反而会误提交。 */
  function startEdit(c: LLMConnection): void {
    setEditingId(c.id);
    setForm({
      name: c.name,
      base_url: c.base_url,
      api_key: "",
      model: c.model,
      enable_tools: c.enable_tools,
      is_default: c.is_default,
      context_window: c.context_window ?? null,
    });
    setErrors({});
    setMsg(c.api_key_set ? `已保存密钥 ${c.api_key_hint || ""}（留空则不修改）` : "");
  }

  async function save(): Promise<void> {
    const name = form.name.trim();
    if (!name) {
      setErrors({ name: "名称必填" });
      return;
    }
    setErrors({});
    setBusy(true);
    setMsg("");
    try {
      // 留空 = 自动（按模型名推断），所以非法或 0 一律归一成 null 而不是报错。
      const contextWindow =
        form.context_window && form.context_window > 0 ? form.context_window : null;

      if (editingId) {
        const payload: Partial<LLMInput> = {
          name,
          base_url: form.base_url,
          model: form.model,
          enable_tools: form.enable_tools,
          is_default: form.is_default,
          context_window: contextWindow,
        };
        // 只有真的填了新密钥才带上 api_key —— 空串提交会把已存的密钥清掉。
        const key = form.api_key?.trim();
        if (key) payload.api_key = key;
        await api.updateLLMConnection(editingId, payload);
        setMsg("已更新");
      } else {
        await api.createLLMConnection({ ...form, name, context_window: contextWindow });
        setMsg("已创建");
      }
      const list = await load();
      resetForm(list.length > 0);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(c: LLMConnection): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      await api.setDefaultLLMConnection(c.id);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: LLMConnection): Promise<void> {
    // 删掉当前正在用的默认连接会让聊天立刻失去模型，所以必须先确认。
    const ok = await confirm({
      title: `确定删除连接「${c.name}」？`,
      message: "删除后聊天将改用其它默认连接。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api.deleteLLMConnection(c.id);
      const list = await load();
      // 删掉的正好是正在编辑的那条时，让表单退回新建态而不是留在脏数据上。
      if (editingId === c.id) resetForm(list.length > 0);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenScaffold
      title="模型"
      subtitle="OpenAI 兼容连接"
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      <Typography.Paragraph color="muted">
        每个用户可配置多个 OpenAI 兼容连接；聊天默认使用「默认」连接。密钥不会完整回显。
      </Typography.Paragraph>

      {connections.length === 0 ? (
        <Typography.Paragraph color="muted">暂无连接，请在下方新增。</Typography.Paragraph>
      ) : (
        connections.map((c) => (
          <Card key={c.id} className={c.is_default ? "border-accent" : undefined}>
            <Card.Body className="gap-2">
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Typography.Heading type="h4" numberOfLines={1}>
                    {c.name}
                  </Typography.Heading>
                </View>
                {c.is_default ? (
                  <Chip size="sm" variant="soft" color="accent">
                    默认
                  </Chip>
                ) : null}
              </View>
              <Typography.Paragraph color="muted">
                {c.model || "(无 model)"} · {c.base_url || "(无 base_url)"} · key{" "}
                {c.api_key_set ? c.api_key_hint || "已设置" : "未设置"}
                {c.enable_tools ? " · tools" : ""}
              </Typography.Paragraph>
              {c.updated_at ? (
                <Typography.Paragraph color="muted" className="text-xs">
                  更新于 {formatRelativeTime(c.updated_at)}
                </Typography.Paragraph>
              ) : null}
              <View className="mt-1 flex-row flex-wrap gap-2">
                {!c.is_default ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={() => void setDefault(c)}
                  >
                    <Button.Label>设默认</Button.Label>
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" isDisabled={busy} onPress={() => startEdit(c)}>
                  <Button.Label>编辑</Button.Label>
                </Button>
                <Button size="sm" variant="danger" isDisabled={busy} onPress={() => void remove(c)}>
                  <Button.Label>删除</Button.Label>
                </Button>
              </View>
            </Card.Body>
          </Card>
        ))
      )}

      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>{editingId ? "编辑连接" : "新增连接"}</SectionTitle>

          <FormField
            label="名称"
            value={form.name}
            onChangeText={(t) => patch({ name: t })}
            placeholder="默认连接"
            error={errors.name}
            required
          />
          <FormField
            label="Base URL"
            value={form.base_url}
            onChangeText={(t) => patch({ base_url: t })}
            placeholder="https://api.openai.com/v1"
            keyboardType="url"
          />
          <FormField
            label="API Key"
            value={form.api_key ?? ""}
            onChangeText={(t) => patch({ api_key: t })}
            placeholder="sk-..."
            // 编辑态的 hint 是「留空不改」这条业务规则唯一可见的说明，不能省。
            hint={editingId ? savedKeyHint(connections, editingId) : undefined}
          />
          <FormField
            label="Model"
            value={form.model}
            onChangeText={(t) => patch({ model: t })}
            placeholder="gpt-4o-mini"
          />
          <FormField
            label="上下文窗口 (tokens)"
            value={form.context_window == null ? "" : String(form.context_window)}
            onChangeText={(t) => {
              const raw = t.trim();
              if (!raw) {
                patch({ context_window: null });
                return;
              }
              const n = Number(raw);
              patch({ context_window: Number.isFinite(n) && n > 0 ? Math.floor(n) : null });
            }}
            placeholder="留空=自动（按模型名推断）"
            hint="留空 = 自动（按模型名推断）"
            keyboardType="numeric"
          />

          <SwitchRow
            label="启用 tools"
            description="上游需支持 tool calling"
            value={Boolean(form.enable_tools)}
            onValueChange={(v) => patch({ enable_tools: v })}
          />
          <SwitchRow
            label="设为默认"
            description="聊天默认走这条连接"
            value={Boolean(form.is_default)}
            onValueChange={(v) => patch({ is_default: v })}
          />

          {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}

          <View className="flex-row gap-3">
            <Button isDisabled={busy} onPress={() => void save()}>
              <Button.Label>{busy ? "保存中…" : "保存"}</Button.Label>
            </Button>
            {editingId ? (
              <Button
                variant="ghost"
                isDisabled={busy}
                onPress={() => resetForm(connections.length > 0)}
              >
                <Button.Label>取消编辑</Button.Label>
              </Button>
            ) : null}
          </View>
        </Card.Body>
      </Card>
    </ScreenScaffold>
  );
}

/** 编辑态下回显已存密钥的提示语，取当前列表里那条连接。 */
function savedKeyHint(list: LLMConnection[], id: string): string | undefined {
  const c = list.find((item) => item.id === id);
  if (!c?.api_key_set) return undefined;
  return `已保存密钥 ${c.api_key_hint || ""}，留空则不修改`;
}
