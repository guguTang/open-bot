import { useEffect, useState, type ReactNode } from "react";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";
import type {
  FeishuConnectInput,
  GmailIntegrationStatus,
  InstallIntegrationStatus,
  TelegramConnectInput,
} from "../../api";

export type IntegrationsSettingsTabProps = {
  gmail: GmailIntegrationStatus | null;
  slack: InstallIntegrationStatus | null;
  github: InstallIntegrationStatus | null;
  telegram: InstallIntegrationStatus | null;
  feishu: InstallIntegrationStatus | null;
  busy: boolean;
  loading?: boolean;
  loadError?: string;
  slackLoadError?: string;
  githubLoadError?: string;
  telegramLoadError?: string;
  feishuLoadError?: string;
  msg: string;
  onConnectGmail: () => void | Promise<void>;
  onDisconnectGmail: () => void | Promise<void>;
  onConnectSlack: () => void | Promise<void>;
  onDisconnectSlack: () => void | Promise<void>;
  onConnectGitHub: (repo: string) => void | Promise<void>;
  onAttachGitHub: (repo: string) => void | Promise<void>;
  onDisconnectGitHub: () => void | Promise<void>;
  onConnectTelegram: (input: TelegramConnectInput) => void | Promise<void>;
  onDisconnectTelegram: () => void | Promise<void>;
  onConnectFeishu: (input: FeishuConnectInput) => void | Promise<void>;
  onDisconnectFeishu: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
};

function gmailConnectionTitle(gmail: GmailIntegrationStatus): string {
  const canSend = Boolean(gmail.can_send);
  const canRead = Boolean(gmail.can_read);
  if (!canSend && !canRead) return "已连接（权限不足）";
  if (!canSend) return "已连接（发送权限不足）";
  if (!canRead) return "已连接（读取权限不足）";
  return "已连接";
}

export function IntegrationsSettingsTab({
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
  onConnectGmail,
  onDisconnectGmail,
  onConnectSlack,
  onDisconnectSlack,
  onConnectGitHub,
  onAttachGitHub,
  onDisconnectGitHub,
  onConnectTelegram,
  onDisconnectTelegram,
  onConnectFeishu,
  onDisconnectFeishu,
  onCopy,
  onRefresh,
}: IntegrationsSettingsTabProps) {
  const configured = gmail?.oauth_configured !== false;
  const connected = Boolean(gmail?.connected);

  return (
    <SettingsPage>
      <SettingsHint>
        连接个人邮箱后，Bot 可在你确认后发信，并按需搜索、阅读邮件摘要（正文会截断）。不会擅自代发，也不会监听新邮件。
        桌面 himalaya / google-workspace 仍可用于本机 CLI。Slack / GitHub 可在这里安装，Telegram /
        飞书可粘贴凭据；这四项成功后会自动绑定一条入站 Hook。Gmail 不创建入站 Hook。未连接或未配置 Client
        时这里是空态。例行任务里手工创建的 Hook 仍然可用。
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
                  <div className="agent-name">{gmailConnectionTitle(gmail)}</div>
                  <div className="agent-desc">{gmail.email || "(未知邮箱)"}</div>
                  <div className="agent-desc">发送：{gmail.can_send ? "可以" : "不可以"}</div>
                  <div className="agent-desc">读取：{gmail.can_read ? "可以" : "不可以"}</div>
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
              {gmail.can_send ? null : (
                <div className="settings-status">
                  当前授权缺少 Gmail 发送范围。请先「断开连接」，再「连接 Gmail」，并在 Google
                  授权页勾选发送邮件权限；同时确认 Cloud 控制台 OAuth
                  同意屏幕已添加 <code>gmail.send</code>。
                </div>
              )}
              {gmail.can_read ? null : (
                <div className="settings-status">
                  当前授权缺少读取邮件范围（<code>gmail.readonly</code>
                  ）。请先「断开连接」，再「连接 Gmail」，并在 Google
                  授权页勾选查看邮件。仅有发送权限的旧连接不能搜索或打开邮件；重新连接才会申请新的同意，不会静默追加权限。
                </div>
              )}
            </>
          ) : (
            <>
              <SettingsEmpty>
                尚未连接 Gmail。连接后可以在你确认后发信，并按需搜索、阅读邮件摘要。不会创建入站 Hook，也不会在后台监听新邮件。
              </SettingsEmpty>
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
            </>
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

      <TelegramConnectCard
        status={telegram}
        loadError={telegramLoadError}
        loading={loading}
        busy={busy}
        onConnect={onConnectTelegram}
        onDisconnect={onDisconnectTelegram}
        onCopy={onCopy}
        onRefresh={onRefresh}
      />
      <FeishuConnectCard
        status={feishu}
        loadError={feishuLoadError}
        loading={loading}
        busy={busy}
        onConnect={onConnectFeishu}
        onDisconnect={onDisconnectFeishu}
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

function ChannelShell({
  title,
  status,
  loadError,
  loading,
  busy,
  onRefresh,
  children,
}: {
  title: string;
  status: InstallIntegrationStatus | null;
  loadError?: string;
  loading?: boolean;
  busy: boolean;
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
}) {
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
        ) : (
          children
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function ConnectedInstallBody({
  status,
  urlLabel,
  busy,
  onDisconnect,
  onCopy,
  onRefresh,
  extra,
}: {
  status: InstallIntegrationStatus;
  urlLabel: string;
  busy: boolean;
  onDisconnect: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  extra?: ReactNode;
}) {
  return (
    <>
      <div className="llm-item" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="agent-name">已连接</div>
          <div className="agent-desc">{status.account || "(未知账号)"}</div>
          <div className="agent-desc">
            {status.mention_only ? "群聊里只在被 @ 时唤醒，私聊始终接收。" : "私聊和群聊文本消息都会唤醒。"}
          </div>
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
        <CopyRow label={urlLabel} value={status.hook_url} busy={busy} onCopy={onCopy} />
      ) : (
        <div className="settings-status">已连接，但还没有可复制的 Webhook URL。请断开后重连。</div>
      )}
      {status.attach_error ? <div className="settings-status">{status.attach_error}</div> : null}
      {status.provider === "telegram" && status.webhook_attached ? (
        <div className="settings-status">Telegram 已接受 setWebhook。</div>
      ) : null}
      {status.setup_hint ? <div className="settings-status">{status.setup_hint}</div> : null}
      <div className="settings-status">
        断开会清除本服务保存的凭据，并且只删除这次连接自动创建的那条入站 Hook（标记为{" "}
        <code>openbot-oauth-install</code>
        ）。不会删除「例行任务」里手工粘贴的 Hook，也不会删除其它 provider 的连接。
      </div>
      {extra}
    </>
  );
}

function TelegramConnectCard({
  status,
  loadError,
  loading,
  busy,
  onConnect,
  onDisconnect,
  onCopy,
  onRefresh,
}: {
  status: InstallIntegrationStatus | null;
  loadError?: string;
  loading?: boolean;
  busy: boolean;
  onConnect: (input: TelegramConnectInput) => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <ChannelShell title="Telegram" status={status} loadError={loadError} loading={loading} busy={busy} onRefresh={onRefresh}>
      {status && status.oauth_configured === false ? (
        <div className="settings-status">
          服务端还不能加密保存凭据。请设置 <code>BOT_SECRETS_KEY</code> 或 <code>ENCRYPTION_KEY</code>
          后重启 API。未配置时不会显示 Webhook URL，也不会假装已连接。
        </div>
      ) : status && status.connected ? (
        <ConnectedInstallBody
          status={status}
          urlLabel="Webhook URL"
          busy={busy}
          onDisconnect={onDisconnect}
          onCopy={onCopy}
          onRefresh={onRefresh}
        />
      ) : (
        <TelegramTokenForm
          busy={busy}
          setupHint={status?.setup_hint}
          onConnect={onConnect}
          onRefresh={onRefresh}
        />
      )}
    </ChannelShell>
  );
}

function FeishuConnectCard({
  status,
  loadError,
  loading,
  busy,
  onConnect,
  onDisconnect,
  onCopy,
  onRefresh,
}: {
  status: InstallIntegrationStatus | null;
  loadError?: string;
  loading?: boolean;
  busy: boolean;
  onConnect: (input: FeishuConnectInput) => void | Promise<void>;
  onDisconnect: () => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  return (
    <ChannelShell title="飞书 / Lark" status={status} loadError={loadError} loading={loading} busy={busy} onRefresh={onRefresh}>
      {status && status.oauth_configured === false ? (
        <div className="settings-status">
          服务端还不能加密保存凭据。请设置 <code>BOT_SECRETS_KEY</code> 或 <code>ENCRYPTION_KEY</code>
          后重启 API。未配置时不会显示事件订阅 URL，也不会假装已连接。
        </div>
      ) : status && status.connected ? (
        <ConnectedInstallBody
          status={status}
          urlLabel="事件订阅 URL"
          busy={busy}
          onDisconnect={onDisconnect}
          onCopy={onCopy}
          onRefresh={onRefresh}
          extra={
            <div className="settings-status">
              当前开放平台：{status.domain === "lark" ? "Lark（open.larksuite.com）" : "飞书（open.feishu.cn）"}
              {status.app_id ? ` · App ID ${status.app_id}` : ""}
            </div>
          }
        />
      ) : (
        <FeishuCredentialForm
          busy={busy}
          setupHint={status?.setup_hint}
          onConnect={onConnect}
          onRefresh={onRefresh}
        />
      )}
    </ChannelShell>
  );
}

function TelegramTokenForm({
  busy,
  setupHint,
  onConnect,
  onRefresh,
}: {
  busy: boolean;
  setupHint?: string;
  onConnect: (input: TelegramConnectInput) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [botToken, setBotToken] = useState("");
  const [mentionOnly, setMentionOnly] = useState(false);
  return (
    <form
      className="llm-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!botToken.trim()) return;
        void onConnect({ bot_token: botToken, mention_only: mentionOnly });
      }}
    >
      <div className="settings-status">尚未连接。填好 Bot token 并保存后，这里才会出现可复制的 Webhook URL。</div>
      {setupHint ? <div className="settings-status">{setupHint}</div> : null}
      <label>
        Bot token
        <input
          type="password"
          name="telegram-bot-token"
          autoComplete="off"
          value={botToken}
          placeholder="123456:AAA..."
          disabled={busy}
          aria-label="Telegram Bot token"
          onChange={(e) => setBotToken(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={mentionOnly} disabled={busy} onChange={(e) => setMentionOnly(e.target.checked)} />
        群聊里只在被 @ 时唤醒（私聊始终接收）
      </label>
      <div className="llm-actions">
        <button type="submit" className="primary" disabled={busy || !botToken.trim()} aria-busy={busy}>
          {busy ? "连接中…" : "连接 Telegram"}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void onRefresh()}>
          刷新
        </button>
      </div>
    </form>
  );
}

function FeishuCredentialForm({
  busy,
  setupHint,
  onConnect,
  onRefresh,
}: {
  busy: boolean;
  setupHint?: string;
  onConnect: (input: FeishuConnectInput) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [appID, setAppID] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [encryptKey, setEncryptKey] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [domain, setDomain] = useState<"feishu" | "lark">("feishu");
  const [mentionOnly, setMentionOnly] = useState(false);
  const ready = Boolean(appID.trim() && appSecret.trim() && encryptKey.trim());
  return (
    <form
      className="llm-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void onConnect({
          app_id: appID,
          app_secret: appSecret,
          encrypt_key: encryptKey,
          verification_token: verificationToken,
          mention_only: mentionOnly,
          domain,
        });
      }}
    >
      <div className="settings-status">
        尚未连接。填好 App ID、App Secret 和 Encrypt Key 并保存后，这里才会出现可复制的事件订阅 URL。
      </div>
      {setupHint ? <div className="settings-status">{setupHint}</div> : null}
      <label>
        开放平台
        <select
          value={domain}
          disabled={busy}
          aria-label="飞书或 Lark"
          onChange={(e) => setDomain(e.target.value === "lark" ? "lark" : "feishu")}
        >
          <option value="feishu">飞书 open.feishu.cn</option>
          <option value="lark">Lark open.larksuite.com</option>
        </select>
      </label>
      <label>
        App ID
        <input
          type="text"
          value={appID}
          autoComplete="off"
          placeholder="cli_xxx"
          disabled={busy}
          aria-label="飞书 App ID"
          onChange={(e) => setAppID(e.target.value)}
        />
      </label>
      <label>
        App Secret
        <input
          type="password"
          value={appSecret}
          autoComplete="off"
          disabled={busy}
          aria-label="飞书 App Secret"
          onChange={(e) => setAppSecret(e.target.value)}
        />
      </label>
      <label>
        Encrypt Key
        <input
          type="password"
          value={encryptKey}
          autoComplete="off"
          disabled={busy}
          aria-label="飞书 Encrypt Key"
          onChange={(e) => setEncryptKey(e.target.value)}
        />
      </label>
      <label>
        Verification Token（可选）
        <input
          type="password"
          value={verificationToken}
          autoComplete="off"
          disabled={busy}
          aria-label="飞书 Verification Token"
          onChange={(e) => setVerificationToken(e.target.value)}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={mentionOnly} disabled={busy} onChange={(e) => setMentionOnly(e.target.checked)} />
        群聊里只在被 @ 时唤醒（私聊始终接收）
      </label>
      <div className="llm-actions">
        <button type="submit" className="primary" disabled={busy || !ready} aria-busy={busy}>
          {busy ? "连接中…" : "连接飞书"}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void onRefresh()}>
          刷新
        </button>
      </div>
    </form>
  );
}
