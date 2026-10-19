import { API_BASE, authHeaders, readError } from "./client";

/** Micro-app kinds / lifecycle — aligned with services/api/internal/db/micro_apps.go */
export type MicroAppKind = "ui" | "skill" | "routine" | string;
export type MicroAppStatus = "draft" | "pinned" | "archived" | string;
export type MicroAppSurface = "hub" | "chat_pin" | "desktop_shortcut" | "mobile_shortcut" | string;
export type MicroAppGrantDecision = "allow_once" | "always_allow" | "deny";

/** User-triggered intent required for draft create / pin (never silent). */
export type MicroAppUserIntent = "save" | "pin_agree" | "user_save" | "user_pin" | "confirm";

export type MicroAppPlacement = {
  id: string;
  micro_app_id: string;
  surface: MicroAppSurface;
  context_id?: string;
  sort_rank: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

export type MicroAppGrant = {
  id: string;
  user_id: string;
  micro_app_id: string;
  capability: string;
  machine_id?: string;
  decision: MicroAppGrantDecision | string;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type MicroApp = {
  id: string;
  user_id: string;
  agent_id?: string;
  title: string;
  description: string;
  icon?: string;
  kind: MicroAppKind;
  status: MicroAppStatus;
  version: number;
  bundle_key?: string;
  bundle_hash?: string;
  entrypoint?: string;
  skill_slug?: string;
  routine_id?: string;
  capabilities: string[];
  source_conversation_id?: string;
  source_message_id?: string;
  confirmed_at?: string | null;
  confirmed_by?: string;
  created_at?: string;
  updated_at?: string;
  placements?: MicroAppPlacement[];
  /** Phase 0: relative path; Phase 1 signed MinIO URL. */
  bundle_url?: string;
};

export type MicroAppCreateInput = {
  title: string;
  description?: string;
  icon?: string;
  kind?: MicroAppKind;
  agent_id?: string;
  capabilities?: string[];
  skill_slug?: string;
  routine_id?: string;
  source_conversation_id?: string;
  source_message_id?: string;
  /** Required: save | pin_agree — API rejects silent draft. */
  user_intent: MicroAppUserIntent;
};

export type MicroAppSession = {
  micro_app_id: string;
  token: string;
  expires_at: string;
  note?: string;
};

export async function listMicroApps(opts?: {
  surface?: MicroAppSurface;
  status?: MicroAppStatus;
}): Promise<MicroApp[]> {
  const q = new URLSearchParams();
  if (opts?.surface) q.set("surface", opts.surface);
  if (opts?.status) q.set("status", opts.status);
  const qs = q.toString();
  const res = await fetch(`${API_BASE}/v1/micro-apps${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.micro_apps ?? [];
}

export async function getMicroApp(id: string): Promise<MicroApp> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createMicroApp(input: MicroAppCreateInput): Promise<MicroApp> {
  const res = await fetch(`${API_BASE}/v1/micro-apps`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Pin only after user save/pin intent (user_intent required). */
export async function pinMicroApp(
  id: string,
  userIntent: MicroAppUserIntent = "user_pin",
): Promise<MicroApp> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/pin`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ user_intent: userIntent }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function archiveMicroApp(id: string): Promise<MicroApp> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateMicroApp(
  id: string,
  patch: Partial<Pick<MicroApp, "title" | "description" | "icon" | "entrypoint" | "skill_slug" | "routine_id" | "capabilities">>,
): Promise<MicroApp> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function putMicroAppPlacements(
  id: string,
  placements: Array<Pick<MicroAppPlacement, "surface" | "context_id" | "sort_rank" | "enabled"> & { id?: string }>,
): Promise<MicroAppPlacement[]> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/placements`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ placements }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.placements ?? [];
}

export async function listMicroAppGrants(
  id: string,
  machineId?: string,
): Promise<{ grants: MicroAppGrant[]; defaults?: Record<string, string> }> {
  const q = machineId ? `?machine_id=${encodeURIComponent(machineId)}` : "";
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/grants${q}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function putMicroAppGrant(
  id: string,
  capability: string,
  body: { decision: MicroAppGrantDecision; machine_id?: string; expires_at?: string | null },
): Promise<MicroAppGrant> {
  const res = await fetch(
    `${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/grants/${encodeURIComponent(capability)}`,
    {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createMicroAppSession(id: string): Promise<MicroAppSession> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/session`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type MicroAppRuntimeFile = {
  encoding: "utf8" | "base64" | string;
  mime: string;
  content: string;
};

export type MicroAppRuntime = {
  micro_app_id: string;
  title: string;
  entrypoint: string;
  capabilities: string[];
  bundle_hash?: string;
  files: Record<string, MicroAppRuntimeFile>;
};

export async function uploadMicroAppBundle(id: string, file: Blob | File): Promise<{
  micro_app: MicroApp;
  files: number;
  entrypoint: string;
  bundle_hash: string;
}> {
  const form = new FormData();
  const name = file instanceof File ? file.name : "bundle.zip";
  form.append("bundle", file, name);
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/bundle`, {
    method: "PUT",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function downloadMicroAppBundle(id: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/bundle`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.blob();
}

export async function fetchMicroAppRuntime(id: string): Promise<MicroAppRuntime> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/runtime`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function microAppGrantCheck(
  id: string,
  capability: string,
  machineId?: string,
): Promise<{
  capability: string;
  decision: string;
  suggested_decision: MicroAppGrantDecision | string;
  needs_prompt: boolean;
  high_sensitivity?: boolean;
  grant_id?: string;
}> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/rpc/grant-check`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ capability, machine_id: machineId || "" }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function microAppGrantConsume(id: string, grantId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/rpc/grant-consume`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ grant_id: grantId }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function microAppCloudHTTP(
  id: string,
  body: { url: string; method?: string; headers?: Record<string, string>; body?: string; machine_id?: string },
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const res = await fetch(`${API_BASE}/v1/micro-apps/${encodeURIComponent(id)}/rpc/cloud.http`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** @deprecated use downloadMicroAppBundle */
export async function fetchMicroAppBundle(id: string): Promise<Blob> {
  return downloadMicroAppBundle(id);
}
