import { useEffect, useState, type ReactNode } from "react";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";
import type { GmailIntegrationStatus, InstallIntegrationStatus } from "../../api";

export type IntegrationsSettingsTabProps = {
  gmail: GmailIntegrationStatus | null;
  slack: InstallIntegrationStatus | null;
  github: InstallIntegrationStatus | null;
  busy: boolean;
  loading?: boolean;
  loadError?: string;
  slackLoadError?: string;
  githubLoadError?: string;
  msg: string;
  onConnectGmail: () => void | Promise<void>;
  onDisconnectGmail: () => void | Promise<void>;
  onConnectSlack: () => void | Promise<void>;
  onDisconnectSlack: () => void | Promise<void>;
  onConnectGitHub: (repo: string) => void | Promise<void>;
  onAttachGitHub: (repo: string) => void | Promise<void>;
  onDisconnectGitHub: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
};

export function IntegrationsSettingsTab({
  gmail,
  slack,
  github,
  busy,
  loading,
  loadError,
  slackLoadError,
  githubLoadError,
  msg,
  onConnectGmail,
  onDisconnectGmail,
  onConnectSlack,
  onDisconnectSlack,
  onConnectGitHub,
  onAttachGitHub,
  onDisconnectGitHub,
  onCopy,
  onRefresh,
}: IntegrationsSettingsTabProps) {
  const configured = gmail?.oauth_configured !== false;
  const connected = Boolean(gmail?.connected);

  return (
    <SettingsPage>
      <SettingsHint>
        连接个人邮箱后，Bot 可起草邮件并在你确认后通过 Gmail API 发送。不会擅自代发；桌面 himalaya /
        google-workspace 技能仍可用于本机 CLI。Slack / GitHub
        可在这里安装并自动绑定一条入站 Hook，供例行任务按事件唤醒。未配置对应 Client
        时显示空态。例行任务里手工创建的 Hook 仍然可用。
      </SettingsHint>
      {msg ? <div className="settings-status">{msg}</div> : null}
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
        </SettingsCard>
      </SettingsSection>

      <InstallChannelCard
        title="Slack"
        connectLabel="安装到 Slack 工作区"
        status={slack}
        loadError={slackLoadError}
        loading={loading}
        busy={busy}
        unconfigured={
          <>
            服务端未配置 Slack OAuth。请在 API 环境变量中设置 <code>SLACK_CLIENT_ID</code> /{" "}
            <code>SLACK_CLIENT_SECRET</code> / <code>SLACK_OAUTH_REDIRECT_URI</code>
            ，然后重启 API。不会假装已连接。
          </>
        }
        onConnect={() => onConnectSlack()}
        onDisconnect={onDisconnectSlack}
        onCopy={onCopy}
        onRefresh={onRefresh}
      />

      <GitHubInstallCard
        status={github}
        loadError={githubLoadError}
        loading={loading}
        busy={busy}
        onConnect={onConnectGitHub}
        onAttach={onAttachGitHub}
        onDisconnect={onDisconnectGitHub}
        onCopy={onCopy}
        onRefresh={onRefresh}
      />
    </SettingsPage>
  );
}

function InstallChannelCard({
  title,
  connectLabel,
  status,
  loadError,
  loading,
  busy,
  unconfigured,
  onConnect,
  onDisconnect,
  onCopy,
  onRefresh,
  extra,
}: {
  title: string;
  connectLabel: string;
  status: InstallIntegrationStatus | null;
  loadError?: string;
  loading?: boolean;
  busy: boolean;
  unconfigured: ReactNode;
  onConnect: () => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  extra?: ReactNode;
}) {
  const configured = status?.oauth_configured !== false;
  const connected = Boolean(status?.connected);
  return (
    <SettingsSection title={title}>
      <SettingsCard padded>
        {!status ? (
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
          <div className="settings-status">{unconfigured}</div>
        ) : connected ? (
          <>
            <div className="llm-item" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div className="agent-name">已连接</div>
                <div className="agent-desc">{status.account || "(未知账号)"}</div>
              </div>
              <div className="llm-actions">
                <button type="button" className="ghost" disabled={busy} onClick={() => void onRefresh()}>
                  刷新
                </button>
                <button type="button" className="danger" disabled={busy} onClick={() => void onDisconnect()}>
                  断开连接
                </button>
              </div>
            </div>
            {status.hook_missing ? (
              <div className="settings-status">
                已连接，但自动创建的入站 Hook 不在了。请断开后重新连接以生成新的 URL。这不会删除你手工创建的其它 Hook。
              </div>
            ) : status.hook_url ? (
              <CopyRow
                label={title === "Slack" ? "Event Request URL" : "Webhook URL"}
                value={status.hook_url}
                busy={busy}
                onCopy={onCopy}
              />
            ) : null}
            {status.setup_hint ? <div className="settings-status">{status.setup_hint}</div> : null}
            <div className="settings-status">
              断开会清除本服务保存的凭据，并且只删除这次安装自动创建的那条入站 Hook（标记为{" "}
              <code>openbot-oauth-install</code>
              ）。不会删除「例行任务」里手工粘贴的 Hook，也不会删除其它 provider 的连接。
            </div>
            {extra}
          </>
        ) : (
          <>
            {status.setup_hint ? <div className="settings-status">{status.setup_hint}</div> : null}
            {extra}
            <div className="llm-actions">
              <button type="button" className="primary" disabled={busy} aria-busy={busy} onClick={() => void onConnect()}>
                {busy ? "连接中…" : connectLabel}
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void onRefresh()}>
                刷新
              </button>
            </div>
          </>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function GitHubInstallCard({
  status,
  loadError,
  loading,
  busy,
  onConnect,
  onAttach,
  onDisconnect,
  onCopy,
  onRefresh,
}: {
  status: InstallIntegrationStatus | null;
  loadError?: string;
  loading?: boolean;
  busy: boolean;
  onConnect: (repo: string) => void | Promise<void>;
  onAttach: (repo: string) => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [repo, setRepo] = useState("");
  useEffect(() => {
    if (status?.repo) setRepo(status.repo);
  }, [status?.repo]);

  const repoField = (
    <label className="settings-status" style={{ display: "block" }}>
      仓库（可选，owner/name）
      <input
        type="text"
        value={repo}
        placeholder="octo/hello"
        disabled={busy}
        onChange={(e) => setRepo(e.target.value)}
        aria-label="GitHub 仓库 owner/name"
      />
    </label>
  );

  return (
    <InstallChannelCard
      title="GitHub"
      connectLabel={status?.mode === "github_app" ? "安装 GitHub App" : "连接 GitHub"}
      status={status}
      loadError={loadError}
      loading={loading}
      busy={busy}
      unconfigured={
        <>
          服务端未配置 GitHub 安装。OAuth App 需要 <code>GITHUB_CLIENT_ID</code> /{" "}
          <code>GITHUB_CLIENT_SECRET</code> / <code>GITHUB_OAUTH_REDIRECT_URI</code>
          。GitHub App 需要 <code>GITHUB_APP_ID</code> / <code>GITHUB_APP_SLUG</code> /{" "}
          <code>GITHUB_APP_PRIVATE_KEY</code>（同时配置时优先走 App 安装）。然后重启 API。
        </>
      }
      onConnect={() => onConnect(repo)}
      onDisconnect={onDisconnect}
      onCopy={onCopy}
      onRefresh={onRefresh}
      extra={
        status?.oauth_configured === false ? null : (
          <>
            {repoField}
            {status?.connected && status.hook_secret ? (
              <CopyRow label="签名密钥" value={status.hook_secret} busy={busy} onCopy={onCopy} />
            ) : null}
            {status?.connected && status.webhook_attached ? (
              <div className="settings-status">已用 API 挂到仓库 {status.repo || ""}。验签仍用上面的签名密钥。</div>
            ) : null}
            {status?.connected && status.attach_error ? (
              <div className="settings-status">自动挂载未成功：{status.attach_error}。可以改用手工粘贴，或填写仓库后重试。</div>
            ) : null}
            {status?.connected && !status.webhook_attached ? (
              <div className="llm-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || !repo.trim()}
                  onClick={() => void onAttach(repo)}
                >
                  用 API 挂到仓库
                </button>
              </div>
            ) : null}
          </>
        )
      }
    />
  );
}

function CopyRow({
  label,
  value,
  busy,
  onCopy,
}: {
  label: string;
  value: string;
  busy: boolean;
  onCopy: (text: string, label: string) => void | Promise<void>;
}) {
  return (
    <div className="settings-status" style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
      <div style={{ minWidth: 0 }}>
        <div className="agent-desc">{label}</div>
        <code style={{ wordBreak: "break-all" }}>{value}</code>
      </div>
      <button type="button" className="ghost" disabled={busy} onClick={() => void onCopy(value, label)}>
        复制
      </button>
    </div>
  );
}
