import { API_BASE, authHeaders, readError } from "./client";

/** Slack / GitHub install wizard (Settings → 连接应用). */
export type InstallIntegrationStatus = {
  provider: string;
  connected: boolean;
  account?: string;
  scopes?: string;
  updated_at?: string;
  oauth_configured: boolean;
  /** oauth | github_app */
  mode?: string;
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
};

export type InstallDisconnectResult = {
  ok: boolean;
  connected: boolean;
  removed_hook_id?: string;
  removed_oauth_hook?: boolean;
  kept_other_hooks?: boolean;
};

export async function getInstallIntegrationStatus(
  provider: "slack" | "github",
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

export async function disconnectInstall(provider: "slack" | "github"): Promise<InstallDisconnectResult> {
  const res = await fetch(`${API_BASE}/v1/integrations/${provider}`, {
    method: "DELETE",
    headers: authHeaders(),
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
