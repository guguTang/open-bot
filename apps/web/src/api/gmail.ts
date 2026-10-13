import { API_BASE, authHeaders, readError } from "./client";

/** Gmail Web OAuth integration (Settings → 连接应用). */
export type GmailIntegrationStatus = {
  provider: string;
  connected: boolean;
  email?: string;
  scopes?: string;
  /** False when connected but token lacks gmail.send (need reconnect). */
  can_send?: boolean;
  updated_at?: string;
  oauth_configured: boolean;
};

export async function getGmailIntegrationStatus(): Promise<GmailIntegrationStatus> {
  const res = await fetch(`${API_BASE}/v1/integrations/gmail`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startGmailConnect(): Promise<{ authorize_url: string; state?: string }> {
  // credentials:"include" so API can set openbot_gmail_oauth_state (CSRF cookie).
  // Binding itself is HMAC-signed state; cookie is optional double-submit.
  const res = await fetch(`${API_BASE}/v1/integrations/gmail/start`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function disconnectGmail(): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/integrations/gmail`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
}
