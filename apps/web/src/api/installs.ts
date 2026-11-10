import { API_BASE, authHeaders, readError } from "./client";

/** Slack / GitHub install wizard and Telegram / Feishu credential connect（侧栏底部「连接应用」，设置里的同名入口打开同一壳）. */
export type InstallIntegrationStatus = {
  provider: string;
  connected: boolean;
  account?: string;
  scopes?: string;
  updated_at?: string;
  oauth_configured: boolean;
  /** oauth | github_app | bot_token | app_credentials */
  mode?: string;
  /** credentials = user pastes a token / app secret instead of an OAuth redirect. */
  connect_mode?: string;
  hook_url?: string;
  hook_path?: string;
  hook_id?: string;
  /** GitHub only: secret for the auto-created hook (manual webhook fallback). */
  hook_secret?: string;
  repo?: string;
  webhook_attached?: boolean;
  attach_error?: string;
  setup_hint?: string;
  hook_missing?: boolean;
  mention_only?: boolean;
  /** feishu | lark */
  domain?: string;
  app_id?: string;
};

export type InstallProvider = "slack" | "github" | "telegram" | "feishu";

export type TelegramConnectInput = {
  bot_token: string;
  mention_only?: boolean;
};

export type FeishuConnectInput = {
  app_id: string;
  app_secret: string;
  encrypt_key: string;
  verification_token?: string;
  mention_only?: boolean;
  domain?: "feishu" | "lark";
};

export type InstallDisconnectResult = {
  ok: boolean;
  connected: boolean;
  removed_hook_id?: string;
  removed_oauth_hook?: boolean;
  kept_other_hooks?: boolean;
};

export async function getInstallIntegrationStatus(
  provider: InstallProvider,
): Promise<InstallIntegrationStatus> {
  const res = await fetch(`${API_BASE}/v1/integrations/${provider}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startInstallConnect(
  provider: "slack" | "github",
  repo?: string,
): Promise<{ authorize_url: string; state?: string; mode?: string; repo?: string }> {
  const res = await fetch(`${API_BASE}/v1/integrations/${provider}/start`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(provider === "github" ? { repo: repo?.trim() || "" } : {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function disconnectInstall(provider: InstallProvider): Promise<InstallDisconnectResult> {
  const res = await fetch(`${API_BASE}/v1/integrations/${provider}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function connectTelegram(input: TelegramConnectInput): Promise<InstallIntegrationStatus> {
  const res = await fetch(`${API_BASE}/v1/integrations/telegram/connect`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      bot_token: input.bot_token.trim(),
      mention_only: Boolean(input.mention_only),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function connectFeishu(input: FeishuConnectInput): Promise<InstallIntegrationStatus> {
  const res = await fetch(`${API_BASE}/v1/integrations/feishu/connect`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      app_id: input.app_id.trim(),
      app_secret: input.app_secret.trim(),
      encrypt_key: input.encrypt_key.trim(),
      verification_token: input.verification_token?.trim() || "",
      mention_only: Boolean(input.mention_only),
      domain: input.domain || "feishu",
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function attachGitHubRepo(repo: string): Promise<InstallIntegrationStatus> {
  const res = await fetch(`${API_BASE}/v1/integrations/github/attach`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ repo: repo.trim() }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
