import { useCallback, useState } from "react";
import {
  disconnectGmail,
  getGmailIntegrationStatus,
  getToken,
  startGmailConnect,
  type GmailIntegrationStatus,
} from "../../api";

export function useIntegrationsSettings() {
  const [gmail, setGmail] = useState<GmailIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    setLoadError("");
    try {
      const st = await getGmailIntegrationStatus();
      setGmail(st);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setLoadError(text);
      setMsg(text);
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
      // Keep busy + msg until navigation; do not clear on success.
      window.location.href = authorize_url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
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
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return {
    gmail,
    busy,
    loading,
    loadError,
    msg,
    setMsg,
    refresh,
    connectGmail,
    disconnect,
  };
}
