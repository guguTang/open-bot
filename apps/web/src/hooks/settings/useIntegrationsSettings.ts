import { useCallback, useState } from "react";
import {
  attachGitHubRepo,
  connectFeishu,
  connectTelegram,
  disconnectGmail,
  disconnectInstall,
  getGmailIntegrationStatus,
  getInstallIntegrationStatus,
  getToken,
  startGmailConnect,
  startInstallConnect,
  type FeishuConnectInput,
  type GmailIntegrationStatus,
  type InstallIntegrationStatus,
  type TelegramConnectInput,
} from "../../api";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useIntegrationsSettings() {
  const [gmail, setGmail] = useState<GmailIntegrationStatus | null>(null);
  const [slack, setSlack] = useState<InstallIntegrationStatus | null>(null);
  const [github, setGithub] = useState<InstallIntegrationStatus | null>(null);
  const [telegram, setTelegram] = useState<InstallIntegrationStatus | null>(null);
  const [feishu, setFeishu] = useState<InstallIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [slackLoadError, setSlackLoadError] = useState("");
  const [githubLoadError, setGithubLoadError] = useState("");
  const [telegramLoadError, setTelegramLoadError] = useState("");
  const [feishuLoadError, setFeishuLoadError] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    setLoadError("");
    setSlackLoadError("");
    setGithubLoadError("");
    setTelegramLoadError("");
    setFeishuLoadError("");
    try {
      const [g, s, h, tg, fs] = await Promise.allSettled([
        getGmailIntegrationStatus(),
        getInstallIntegrationStatus("slack"),
        getInstallIntegrationStatus("github"),
        getInstallIntegrationStatus("telegram"),
        getInstallIntegrationStatus("feishu"),
      ]);
      if (g.status === "fulfilled") setGmail(g.value);
      else {
        setGmail(null);
        setLoadError(errText(g.reason));
      }
      if (s.status === "fulfilled") setSlack(s.value);
      else {
        setSlack(null);
        setSlackLoadError(errText(s.reason));
      }
      if (h.status === "fulfilled") setGithub(h.value);
      else {
        setGithub(null);
        setGithubLoadError(errText(h.reason));
      }
      if (tg.status === "fulfilled") setTelegram(tg.value);
      else {
        setTelegram(null);
        setTelegramLoadError(errText(tg.reason));
      }
      if (fs.status === "fulfilled") setFeishu(fs.value);
      else {
        setFeishu(null);
        setFeishuLoadError(errText(fs.reason));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const connectGmail = useCallback(async () => {
    setBusy(true);
    setMsg("正在跳转 Google 授权…");
    try {
      const { authorize_url } = await startGmailConnect();
      if (!authorize_url) throw new Error("未返回授权地址");
      window.location.href = authorize_url;
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      await disconnectGmail();
      setMsg("已断开 Gmail");
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const connectSlack = useCallback(async () => {
    setBusy(true);
    setMsg("正在跳转 Slack 授权…");
    try {
      const { authorize_url } = await startInstallConnect("slack");
      if (!authorize_url) throw new Error("未返回授权地址");
      window.location.href = authorize_url;
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnectSlack = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await disconnectInstall("slack");
      setMsg(
        res.removed_oauth_hook
          ? "已断开 Slack。已清除 bot token，并只删除了这次安装自动创建的入站 Hook。手工粘贴的其它 Hook 未改动。"
          : "已断开 Slack。已清除 bot token，没有删除其它入站 Hook。",
      );
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const connectGitHub = useCallback(async (repo: string) => {
    setBusy(true);
    setMsg("正在跳转 GitHub 授权…");
    try {
      const { authorize_url } = await startInstallConnect("github", repo);
      if (!authorize_url) throw new Error("未返回授权地址");
      window.location.href = authorize_url;
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const attachGitHub = useCallback(
    async (repo: string) => {
      setBusy(true);
      setMsg("");
      try {
        await attachGitHubRepo(repo);
        setMsg("已用 API 把 webhook 挂到仓库。签名密钥就是这条自动创建的 Hook secret。");
        await refresh();
      } catch (e) {
        setMsg(errText(e));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const disconnectGitHub = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await disconnectInstall("github");
      setMsg(
        res.removed_oauth_hook
          ? "已断开 GitHub。已清除凭据，并只删除了这次安装自动创建的入站 Hook。若之前用 API 挂过 webhook，只尝试删除那一个远程 hook。手工 Hook 和仓库里的其它 webhook 未改动。"
          : "已断开 GitHub。已清除凭据，没有删除其它入站 Hook。",
      );
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const connectTelegramBot = useCallback(async (input: TelegramConnectInput) => {
    setBusy(true);
    setMsg("");
    try {
      const res = await connectTelegram(input);
      setMsg(
        res.webhook_attached
          ? "已连接 Telegram，并已调用 setWebhook。可以复制 Webhook URL。"
          : res.attach_error
            ? `已保存 Telegram 连接，但 setWebhook 未成功：${res.attach_error}`
            : "已保存 Telegram 连接。",
      );
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disconnectTelegram = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await disconnectInstall("telegram");
      setMsg(
        res.removed_oauth_hook
          ? "已断开 Telegram。已清除 Bot token，并只删除了这次连接自动创建的入站 Hook，同时尝试了 deleteWebhook。手工粘贴的其它 Hook 未改动。"
          : "已断开 Telegram。已清除 Bot token，没有删除其它入站 Hook。",
      );
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const connectFeishuApp = useCallback(async (input: FeishuConnectInput) => {
    setBusy(true);
    setMsg("");
    try {
      await connectFeishu(input);
      setMsg("已连接飞书 / Lark。请把事件订阅 URL 填到开放平台，加密方式与这里的 Encrypt Key 一致。");
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disconnectFeishu = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await disconnectInstall("feishu");
      setMsg(
        res.removed_oauth_hook
          ? "已断开飞书。已清除应用凭据，并只删除了这次连接自动创建的入站 Hook。开放平台里的事件订阅需要你自己关掉。手工 Hook 和其它连接未改动。"
          : "已断开飞书。已清除应用凭据，没有删除其它入站 Hook。",
      );
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`已复制${label}`);
    } catch (e) {
      setMsg(errText(e) || "复制失败，请手动选择文本");
    }
  }, []);

  return {
    gmail,
    slack,
    github,
    telegram,
    feishu,
    busy,
    loading,
    loadError,
    slackLoadError,
    githubLoadError,
    telegramLoadError,
    feishuLoadError,
    msg,
    setMsg,
    refresh,
    connectGmail,
    disconnect,
    connectSlack,
    disconnectSlack,
    connectGitHub,
    attachGitHub,
    disconnectGitHub,
    connectTelegramBot,
    disconnectTelegram,
    connectFeishuApp,
    disconnectFeishu,
    copyText,
  };
}
