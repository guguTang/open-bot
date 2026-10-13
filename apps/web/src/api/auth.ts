import { API_BASE, apiExtraHeaders, authHeaders, readError, type User } from "./client";

export async function register(username: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/auth/register`, {
    method: "POST",
    headers: { ...apiExtraHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: "POST",
    headers: { ...apiExtraHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchMe(): Promise<User> {
  const res = await fetch(`${API_BASE}/v1/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type AutoReviewRule = {
  id: string;
  when: string;
  action: "ask_first" | "auto_allow";
};

export type UserSettings = {
  user_id?: string;
  timezone: string;
  auto_review_enabled: boolean;
  auto_review_rules: AutoReviewRule[];
  updated_at?: string;
};

export async function fetchUserSettings(): Promise<UserSettings> {
  const res = await fetch(`${API_BASE}/v1/me/settings`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateUserSettings(body: {
  timezone?: string;
  auto_review_enabled?: boolean;
  auto_review_rules?: AutoReviewRule[];
}): Promise<UserSettings> {
  const res = await fetch(`${API_BASE}/v1/me/settings`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function fetchOIDCConfig(): Promise<{
  enabled: boolean;
  endpoint?: string;
  client_id?: string;
  redirect_uri?: string;
}> {
  const res = await fetch(`${API_BASE}/v1/auth/oidc/config`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startOIDCLogin(): Promise<{ authorize_url: string; state: string }> {
  const res = await fetch(`${API_BASE}/v1/auth/oidc/start?redirect=0`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function exchangeOIDCCode(
  code: string,
  state: string,
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${API_BASE}/v1/auth/oidc/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ code, state }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
