import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";
import type { GmailIntegrationStatus } from "../../api";

export type IntegrationsSettingsTabProps = {
  gmail: GmailIntegrationStatus | null;
  busy: boolean;
  loading?: boolean;
  loadError?: string;
  msg: string;
  onConnectGmail: () => void | Promise<void>;
  onDisconnectGmail: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
};

export function IntegrationsSettingsTab({
  gmail,
  busy,
  loading,
  loadError,
  msg,
  onConnectGmail,
  onDisconnectGmail,
  onRefresh,
}: IntegrationsSettingsTabProps) {
  const configured = gmail?.oauth_configured !== false;
  const connected = Boolean(gmail?.connected);

  return (
    <SettingsPage>
      <SettingsHint>
        连接个人邮箱后，Bot 可起草邮件并在你确认后通过 Gmail API 发送。不会擅自代发；桌面 himalaya /
        google-workspace 技能仍可用于本机 CLI。
      </SettingsHint>
      <SettingsSection title="Gmail">
        <SettingsCard padded>
          {!gmail ? (
            loading || !loadError ? (
              <SettingsEmpty>加载中…</SettingsEmpty>
            ) : (
              <div className="settings-status">
                <p>无法读取连接状态：{loadError}</p>
                <button type="button" className="ghost" disabled={busy || loading} onClick={() => void onRefresh()}>
                  重试
                </button>
              </div>
            )
          ) : !configured ? (
            <div className="settings-status">
              服务端未配置 Google OAuth。请在 API 环境变量中设置{" "}
              <code>GOOGLE_OAUTH_CLIENT_ID</code> / <code>GOOGLE_OAUTH_CLIENT_SECRET</code> /{" "}
              <code>GOOGLE_OAUTH_REDIRECT_URI</code>
              ，然后重启 API。详见 docs/Gmail连接与Web发信.md。
            </div>
          ) : connected ? (
            <>
              <div className="llm-item" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div className="agent-name">
                    {gmail.can_send === false ? "已连接（发送权限不足）" : "已连接"}
                  </div>
                  <div className="agent-desc">{gmail.email || "(未知邮箱)"}</div>
                </div>
                <div className="llm-actions">
                  <button type="button" className="ghost" disabled={busy} onClick={() => void onRefresh()}>
                    刷新
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onDisconnectGmail()}
                  >
                    断开连接
                  </button>
                </div>
              </div>
              {gmail.can_send === false ? (
                <div className="settings-status">
                  当前授权缺少 Gmail 发送范围。请先「断开连接」，再「连接 Gmail」，并在 Google
                  授权页勾选发送邮件权限；同时确认 Cloud 控制台 OAuth
                  同意屏幕已添加 <code>gmail.send</code>。
                </div>
              ) : null}
            </>
          ) : (
            <div className="llm-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void onConnectGmail()}
              >
                {busy ? "连接中…" : "连接 Gmail"}
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void onRefresh()}>
                刷新
              </button>
            </div>
          )}
          {msg ? <div className="settings-status">{msg}</div> : null}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
