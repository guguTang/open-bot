/**
 * 连接应用市场骨架。Gmail 走现有 OAuth；Slack / GitHub / Telegram / 飞书在 RN 显示「即将」。
 * 没有 recommended 标记，因此不渲染推荐横滑。
 * OAuth 在系统浏览器完成；回调若落到 openbot://settings/integrations 则自动刷新。
 */

import { Button, Card, Chip, Typography } from "heroui-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import {
  disconnectGmail,
  getGmailIntegrationStatus,
  startGmailConnect,
  type GmailIntegrationStatus,
} from "@/api";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormActions, FormField, FormStatus, PageIntro } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { errText } from "@/lib/errors";
import { runWithFinally } from "@/lib/finally";

WebBrowser.maybeCompleteAuthSession();

type AppId = "gmail" | "slack" | "telegram" | "feishu" | "github";
type Pill = "全部" | "已连接" | "通信" | "代码";

type CatalogApp = {
  id: AppId;
  name: string;
  blurb: string;
  category: "通信" | "代码";
  soon?: boolean;
};

const APPS: readonly CatalogApp[] = [
  { id: "gmail", name: "Gmail", blurb: "确认后发信，并按需搜索、阅读邮件摘要。", category: "通信" },
  { id: "slack", name: "Slack", blurb: "安装到工作区，消息进来时唤醒例行任务。", category: "通信", soon: true },
  { id: "telegram", name: "Telegram", blurb: "粘贴 Bot token，接收消息并在同一会话回复。", category: "通信", soon: true },
  { id: "feishu", name: "飞书", blurb: "粘贴飞书或 Lark 应用凭据，接收消息并回复。", category: "通信", soon: true },
  { id: "github", name: "GitHub", blurb: "连接仓库事件，自动绑定一条入站 Hook。", category: "代码", soon: true },
];

const PILLS: readonly Pill[] = ["全部", "已连接", "通信", "代码"];

function filterApps(query: string, pill: Pill, gmailConnected: boolean): CatalogApp[] {
  const q = query.trim().toLowerCase();
  return APPS.filter((app) => {
    const connected = app.id === "gmail" && gmailConnected;
    if (pill === "已连接" && !connected) return false;
    if (pill === "通信" && app.category !== "通信") return false;
    if (pill === "代码" && app.category !== "代码") return false;
    if (!q) return true;
    return `${app.name} ${app.blurb} ${app.category} ${app.id}`.toLowerCase().includes(q);
  });
}

export default function IntegrationsSettingsScreen(): JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ gmail_connected?: string; gmail_error?: string }>();
  const { confirm } = useConfirm();

  const [gmail, setGmail] = useState<GmailIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<Pill>("全部");
  const [detail, setDetail] = useState<AppId | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    await runWithFinally(
      async () => {
        try {
          setGmail(await getGmailIntegrationStatus());
        } catch (err) {
          setLoadError(errText(err, "无法读取连接状态"));
          setGmail(null);
        }
      },
      () => {
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (params.gmail_connected === "1") {
      setMsg("Gmail 已连接");
      setDetail("gmail");
      void refresh();
    }
    const err = params.gmail_error;
    if (err) {
      const map: Record<string, string> = {
        token_exchange_failed: "换取 token 失败，请查看 API 日志中的 gmail oauth 行",
        missing_gmail_send_scope:
          "未获得 gmail.send 发送权限。请确认 Google Cloud 同意屏幕已添加该范围，重新连接时在授权页勾选发送邮件",
      };
      setMsg(map[err] || `连接失败：${err}`);
      setDetail("gmail");
    }
  }, [params.gmail_connected, params.gmail_error, refresh]);

  async function onConnect(): Promise<void> {
    setBusy(true);
    setMsg("");
    await runWithFinally(
      async () => {
        try {
          const { authorize_url } = await startGmailConnect();
          const redirect = Linking.createURL("/settings/integrations");
          const result = await WebBrowser.openAuthSessionAsync(authorize_url, redirect);
          if (result.type === "success" && result.url) {
            const q = Linking.parse(result.url).queryParams ?? {};
            if (q.gmail_connected === "1") setMsg("Gmail 已连接");
            if (typeof q.gmail_error === "string") setMsg(`连接失败：${q.gmail_error}`);
          }
          await refresh();
        } catch (err) {
          setMsg(errText(err, "连接失败"));
        }
      },
      () => {
        setBusy(false);
      }
    );
  }

  async function onDisconnect(): Promise<void> {
    const ok = await confirm({
      title: "断开 Gmail？",
      message: "断开后 Bot 将无法通过该邮箱发送或阅读邮件，需要重新授权才能恢复。",
      confirmLabel: "断开连接",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    setMsg("");
    await runWithFinally(
      async () => {
        try {
          await disconnectGmail();
          setMsg("已断开 Gmail");
          await refresh();
        } catch (err) {
          setMsg(errText(err, "断开失败"));
        }
      },
      () => {
        setBusy(false);
      }
    );
  }

  const gmailConnected = Boolean(gmail?.connected);
  const connectedCount = gmailConnected ? 1 : 0;
  const visible = useMemo(() => filterApps(query, pill, gmailConnected), [query, pill, gmailConnected]);
  const configured = gmail?.oauth_configured !== false;

  if (detail === "gmail") {
    return (
      <ScreenScaffold
        title="Gmail"
        subtitle={gmailConnected ? "已连接" : "未连接"}
        onBack={() => setDetail(null)}
        loading={loading && !gmail}
        error={loadError && !gmail ? loadError : null}
        onRetry={() => void refresh()}
      >
        <GmailDetail
          gmail={gmail}
          configured={configured}
          connected={gmailConnected}
          busy={busy}
          loadError={loadError}
          msg={msg}
          onConnect={() => void onConnect()}
          onDisconnect={() => void onDisconnect()}
          onRefresh={() => void refresh()}
        />
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold
      title="连接应用"
      subtitle={`已连接 ${connectedCount}`}
      loading={loading && !gmail}
      error={loadError && !gmail ? loadError : null}
      onRetry={() => void refresh()}
    >
      <PageIntro>搜索真实应用后点「连接」。Gmail 在这里授权；其余应用的手机端连接还在准备。</PageIntro>

      <FormField label="搜索" value={query} onChangeText={setQuery} placeholder="名称或简介" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
        {PILLS.map((item) => (
          <Chip
            key={item}
            size="sm"
            variant={pill === item ? "soft" : "secondary"}
            color={pill === item ? "accent" : "default"}
            onPress={() => setPill(item)}
            accessibilityRole="button"
            accessibilityLabel={item === "已连接" ? `已连接 ${connectedCount}` : item}
          >
            <Chip.Label>
              {item}
              {item === "已连接" ? ` ${connectedCount}` : ""}
            </Chip.Label>
          </Chip>
        ))}
      </ScrollView>

      {msg ? (
        <FormStatus
          message={msg}
          tone={msg.includes("失败") || msg.includes("不足") ? "danger" : msg.includes("已") ? "success" : "muted"}
        />
      ) : null}

      {visible.length === 0 ? (
        <View className="items-center gap-3 py-6">
          <Typography.Paragraph color="muted">没有匹配的应用</Typography.Paragraph>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setQuery("");
              setPill("全部");
            }}
          >
            <Button.Label>清除筛选</Button.Label>
          </Button>
        </View>
      ) : (
        <View className="gap-3">
          {visible.map((app) => {
            const linked = app.id === "gmail" && gmailConnected;
            return (
              <Card key={app.id}>
                <Card.Body className="gap-3">
                  <View className="gap-1">
                    <Typography.Heading type="h6">{app.name}</Typography.Heading>
                    <Typography.Paragraph color="muted" className="text-sm">
                      {app.blurb}
                    </Typography.Paragraph>
                  </View>
                  {app.soon ? (
                    <Button size="sm" variant="secondary" isDisabled accessibilityLabel={`${app.name} 即将支持`}>
                      <Button.Label>即将</Button.Label>
                    </Button>
                  ) : linked ? (
                    <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setDetail(app.id)}>
                      <Button.Label>管理</Button.Label>
                    </Button>
                  ) : (
                    <Button size="sm" isDisabled={busy} onPress={() => setDetail(app.id)}>
                      <Button.Label>连接</Button.Label>
                    </Button>
                  )}
                </Card.Body>
              </Card>
            );
          })}
        </View>
      )}

      <Button size="sm" variant="ghost" onPress={() => router.push("/settings/mcp")}>
        <Button.Label>高级：手动添加 MCP</Button.Label>
      </Button>
    </ScreenScaffold>
  );
}

function GmailDetail({
  gmail,
  configured,
  connected,
  busy,
  loadError,
  msg,
  onConnect,
  onDisconnect,
  onRefresh,
}: {
  gmail: GmailIntegrationStatus | null;
  configured: boolean;
  connected: boolean;
  busy: boolean;
  loadError: string | null;
  msg: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <Card>
      <Card.Body className="gap-3">
        {!gmail && loadError ? (
          <Typography.Paragraph className="text-sm text-danger">{loadError}</Typography.Paragraph>
        ) : null}

        {gmail && !configured ? (
          <Typography.Paragraph color="muted" className="text-sm">
            服务端未配置 Google OAuth。请设置 GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI 后重启 API。
          </Typography.Paragraph>
        ) : null}

        {gmail && configured && connected ? (
          <View className="gap-2">
            <Typography.Paragraph>
              {gmail.can_send && gmail.can_read
                ? "已连接"
                : !gmail.can_send && !gmail.can_read
                  ? "已连接（权限不足）"
                  : !gmail.can_send
                    ? "已连接（发送权限不足）"
                    : "已连接（读取权限不足）"}
            </Typography.Paragraph>
            <Typography.Paragraph color="muted" className="text-sm">
              {gmail.email || "(未知邮箱)"}
            </Typography.Paragraph>
            <Typography.Paragraph color="muted" className="text-sm">
              发送：{gmail.can_send ? "可以" : "不可以"}
            </Typography.Paragraph>
            <Typography.Paragraph color="muted" className="text-sm">
              读取：{gmail.can_read ? "可以" : "不可以"}
            </Typography.Paragraph>
            {gmail.can_send ? null : (
              <Typography.Paragraph className="text-xs text-warning">
                当前授权缺少 Gmail 发送范围。请先断开再重新连接，并在授权页勾选发送邮件。
              </Typography.Paragraph>
            )}
            {gmail.can_read ? null : (
              <Typography.Paragraph className="text-xs text-warning">
                当前授权缺少读取范围（gmail.readonly）。请先断开再重新连接，并在授权页勾选查看邮件。仅有发送权限的旧连接不能读信。
              </Typography.Paragraph>
            )}
            <FormActions>
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={onRefresh}>
                <Button.Label>刷新</Button.Label>
              </Button>
              <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={onDisconnect}>
                <Button.Label>断开连接</Button.Label>
              </Button>
            </FormActions>
          </View>
        ) : null}

        {gmail && configured && !connected ? (
          <View className="gap-3">
            <Typography.Paragraph color="muted" className="text-sm">
              尚未连接 Gmail。连接后可以确认后发信，并按需搜索、阅读邮件摘要。
            </Typography.Paragraph>
            <FormActions>
              <Button size="sm" isDisabled={busy} onPress={onConnect}>
                <Button.Label>{busy ? "连接中…" : "连接 Gmail"}</Button.Label>
              </Button>
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={onRefresh}>
                <Button.Label>刷新</Button.Label>
              </Button>
            </FormActions>
          </View>
        ) : null}

        {msg ? (
          <FormStatus
            message={msg}
            tone={
              msg.includes("失败") || msg.includes("不足")
                ? "danger"
                : msg.startsWith("已") || msg.includes("已连接")
                  ? "success"
                  : "muted"
            }
          />
        ) : null}
      </Card.Body>
    </Card>
  );
}
