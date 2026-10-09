import { Button, Card, Chip, Input, Label, ListGroup, TextField, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { BotSecretMeta, BotSecretRequest } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatDateTime } from "@/lib/format";

/**
 * 密钥。对齐 Web 端 `settingsTab === "secrets"` + `SecretPromptModal`：
 * 列表 + 新增 + 删除，以及待授权请求的「授权 / 忽略」两种处理。
 *
 * 与 Web 的差异：Web 用一个全局弹窗抢占式地问第一条请求，
 * RN 上把待处理请求内联成卡片逐条处理——手机上弹窗会盖住上下文，
 * 内联卡片能同时看清「谁要、为什么、来自哪个会话」。
 *
 * 明文只在提交的瞬间经过内存，服务端只存密文，列表 API 永不回传。
 */

const POLL_MS = 8000;

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function SecretsScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [secrets, setSecrets] = useState<BotSecretMeta[]>([]);
  const [requests, setRequests] = useState<BotSecretRequest[]>([]);
  /** 每条待处理请求各自一个输入框的值 */
  const [values, setValues] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [name, setName] = useState("api_token");
  const [origin, setOrigin] = useState("https://api.github.com");
  const [value, setValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /**
   * 助手随时可能发起新的密钥请求，所以列表要轮询（与 Web 端同频 8s）。
   * 失败静默：轮询请求报错不该把整页打成错误态，下一轮会自愈。
   */
  const load = useCallback(async () => {
    try {
      setError(null);
      const [secs, reqs] = await Promise.all([api.listBotSecrets(), api.listBotSecretRequests()]);
      setSecrets(secs);
      setRequests(reqs);
    } catch {
      setError("加载密钥失败，请检查服务端是否已配置加密密钥（ENCRYPTION_KEY / BOT_SECRETS_KEY）");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function submit(): Promise<void> {
    if (!name.trim()) {
      setFormError("请填写名称");
      return;
    }
    if (!value.trim()) {
      setFormError("请填写密钥值");
      return;
    }

    setFormError(null);
    setBusy(true);
    setMsg("");
    try {
      await api.createBotSecret({
        name: name.trim(),
        value,
        origin: origin.trim(),
        auth_type: "bearer",
      });
      // 存完立刻清空输入框：明文不该在屏幕上多留一秒
      setValue("");
      setMsg("已保存");
      await load();
    } catch (err) {
      setMsg(errText(err, "保存失败"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(secret: BotSecretMeta): Promise<void> {
    const ok = await confirm({
      title: "删除该密钥？",
      message: `「${secret.name}」将被永久删除，依赖它的助手会立刻拿不到凭据。此操作不可撤销。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    setMsg("");
    try {
      await api.deleteBotSecret(secret.id);
      setMsg(`已删除 ${secret.name}`);
      await load();
    } catch (err) {
      setMsg(errText(err, "删除失败"));
    } finally {
      setBusy(false);
    }
  }

  async function approve(req: BotSecretRequest): Promise<void> {
    const secret = values[req.id] ?? "";
    if (!secret.trim()) {
      setMsg("请先填写密钥值");
      return;
    }

    setBusy(true);
    setMsg("");
    try {
      // 原样带回助手请求时的元信息，后端据此决定把凭据绑定到哪个会话/助手
      await api.resolveBotSecretRequest(req.id, {
        value: secret,
        name: req.name,
        origin: req.origin,
        auth_type: req.auth_type,
        agent_id: req.agent_id,
      });
      setValues((prev) => ({ ...prev, [req.id]: "" }));
      setMsg("已授权，助手可以继续了");
      await load();
    } catch (err) {
      setMsg(errText(err, "授权失败"));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(req: BotSecretRequest): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      // dismiss：本次拒绝，请求就此结束，助手会收到「用户未提供」的信号
      await api.resolveBotSecretRequest(req.id, { dismiss: true });
      setMsg("已忽略");
      await load();
    } catch (err) {
      setMsg(errText(err, "忽略失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenScaffold
      title="密钥"
      subtitle="助手可用的凭据"
      loading={loading}
      error={error}
      empty={
        requests.length === 0 && secrets.length === 0 ? (
          <EmptyState icon="key-outline" title="还没有密钥" hint="在下方添加一个助手需要访问的凭据" />
        ) : undefined
      }
      onRetry={() => void load()}
      headerRight={
        <Button size="sm" variant="secondary" onPress={() => void load()}>
          <Button.Label>刷新</Button.Label>
        </Button>
      }
    >
      <Typography.Paragraph color="muted">
        仅存元数据与密文；列表 API 永不返回明文。服务端需配置 ENCRYPTION_KEY / BOT_SECRETS_KEY。
      </Typography.Paragraph>

      {requests.length > 0 ? (
        <View className="gap-3">
          <SectionTitle>待授权请求（{requests.length}）</SectionTitle>
          {requests.map((req) => (
            <Card key={req.id}>
              <Card.Body className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Typography.Paragraph weight="medium" className="flex-1">
                    {req.name || "secret"}
                  </Typography.Paragraph>
                  <Chip size="sm" variant="soft" color="warning">
                    <Chip.Label>{req.auth_type || "待授权"}</Chip.Label>
                  </Chip>
                </View>

                <Typography.Paragraph type="body-sm" color="muted">
                  {req.reason || "助手请求一个密钥。明文仅加密存库，不会回传给模型。"}
                </Typography.Paragraph>

                <Typography.Paragraph type="body-xs" color="muted">
                  {req.origin ? `来源 ${req.origin} · ` : ""}
                  {formatDateTime(req.created_at)}
                </Typography.Paragraph>

                {/* 这里是唯一必须用裸 Input 的地方：FormField 没有 secureTextEntry，
                    而密钥明文绝对不能明文显示。 */}
                <TextField>
                  <Label>
                    <Label.Text>密钥值</Label.Text>
                  </Label>
                  <Input
                    value={values[req.id] ?? ""}
                    onChangeText={(next) => setValues((prev) => ({ ...prev, [req.id]: next }))}
                    placeholder="粘贴 token / API key"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!busy}
                  />
                </TextField>

                <View className="flex-row gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    isDisabled={busy}
                    onPress={() => void dismiss(req)}
                  >
                    <Button.Label>忽略</Button.Label>
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    isDisabled={busy || !(values[req.id] ?? "").trim()}
                    onPress={() => void approve(req)}
                  >
                    <Button.Label>授权</Button.Label>
                  </Button>
                </View>
              </Card.Body>
            </Card>
          ))}
        </View>
      ) : null}

      <View className="gap-3">
        <SectionTitle>已保存（{secrets.length}）</SectionTitle>

        {secrets.length > 0 ? (
          <ListGroup>
            {secrets.map((s) => (
              <ListGroup.Item key={s.id}>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>{s.name}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {s.origin || "(无来源限制)"} · {s.auth_type} · 更新于{" "}
                    {formatDateTime(s.updated_at)}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    isDisabled={busy}
                    onPress={() => void remove(s)}
                  >
                    <Button.Label>删除</Button.Label>
                  </Button>
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            ))}
          </ListGroup>
        ) : (
          <Typography.Paragraph color="muted">还没有保存任何密钥。</Typography.Paragraph>
        )}
      </View>

      <View className="gap-3">
        <SectionTitle>添加密钥</SectionTitle>

        <FormField
          label="名称"
          required
          value={name}
          onChangeText={setName}
          placeholder="api_token"
          error={name.trim() ? null : formError === "请填写名称" ? formError : null}
        />

        <FormField
          label="来源（仅 HTTPS）"
          value={origin}
          onChangeText={setOrigin}
          placeholder="https://api.github.com"
          keyboardType="url"
          hint="留空表示不限制来源"
        />

        {/* 同上：明文输入必须用裸 Input，FormField 缺 secureTextEntry */}
        <TextField isInvalid={formError === "请填写密钥值"}>
          <Label>
            <Label.Text>值 *</Label.Text>
          </Label>
          <Input
            value={value}
            onChangeText={setValue}
            placeholder="粘贴 token / API key"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          {formError === "请填写密钥值" ? (
            <Label>
              <Label.Text className="text-danger text-xs">{formError}</Label.Text>
            </Label>
          ) : (
            <Label>
              <Label.Text className="text-muted text-xs">
                保存后只保留密文，页面不会再次显示
              </Label.Text>
            </Label>
          )}
        </TextField>

        <Button size="sm" className="self-start" isDisabled={busy} onPress={() => void submit()}>
          <Button.Label>{busy ? "保存中…" : "添加密钥"}</Button.Label>
        </Button>
      </View>

      {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}
    </ScreenScaffold>
  );
}
