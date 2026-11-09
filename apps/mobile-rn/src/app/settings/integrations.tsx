/**
 * 连接应用 · Gmail。对齐 Web `IntegrationsSettingsTab` 的 Gmail 段。
 * Slack / GitHub 安装向导目前只在 Web。
 * OAuth 在系统浏览器完成；回调若落到 openbot://settings/integrations 则自动刷新。
 */

import { Button, Card, Typography } from "heroui-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useLocalSearchParams } from "expo-router";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import {
  disconnectGmail,
  getGmailIntegrationStatus,
  startGmailConnect,
  type GmailIntegrationStatus,
} from "@/api";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormActions, FormStatus, PageIntro } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { errText } from "@/lib/errors";
import { runWithFinally } from "@/lib/finally";

WebBrowser.maybeCompleteAuthSession();

export default function IntegrationsSettingsScreen(): JSX.Element {
  const params = useLocalSearchParams<{ gmail_connected?: string; gmail_error?: string }>();
  const { confirm } = useConfirm();

  const [gmail, setGmail] = useState<GmailIntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

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

  const configured = gmail?.oauth_configured !== false;
  const connected = Boolean(gmail?.connected);

  return (
    <ScreenScaffold
      title="连接应用"
      subtitle="Gmail 等邮箱授权"
      loading={loading && !gmail}
      error={loadError && !gmail ? loadError : null}
      onRetry={() => void refresh()}
    >
      <PageIntro>
        连接个人邮箱后，Bot 可在你确认后发信，并按需搜索、阅读邮件摘要。不会监听新邮件，也不创建入站 Hook。
      </PageIntro>

      <Card>
        <Card.Body className="gap-3">
          <Typography.Heading type="h6">Gmail</Typography.Heading>

          {!gmail && loadError ? (
            <Typography.Paragraph className="text-sm text-danger">{loadError}</Typography.Paragraph>
          ) : null}

          {gmail && !configured ? (
            <Typography.Paragraph color="muted" className="text-sm">
              服务端未配置 Google OAuth。请设置 GOOGLE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI
              后重启 API。
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
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void refresh()}
                >
                  <Button.Label>刷新</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={busy}
                  onPress={() => void onDisconnect()}
                >
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
                <Button size="sm" isDisabled={busy} onPress={() => void onConnect()}>
                  <Button.Label>{busy ? "连接中…" : "连接 Gmail"}</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy}
                  onPress={() => void refresh()}
                >
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
    </ScreenScaffold>
  );
}
