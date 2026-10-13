import { API_BASE, authHeaders, getToken, readError } from "./client";

export function hostExecWebSocketUrl(machineId: string, token?: string | null): string {
  const t = (token ?? getToken() ?? "").trim();
  const wsBase = API_BASE.replace(/^http/i, (scheme) =>
    scheme.toLowerCase() === "https" ? "wss" : "ws",
  );
  const q = t ? `?token=${encodeURIComponent(t)}` : "";
  return `${wsBase}/v1/machines/${encodeURIComponent(machineId)}/exec${q}`;
}

// ---------------------------------------------------------------------------
// Registered host machines (ListMachines-like)
// ---------------------------------------------------------------------------

export type Machine = {
  id: string;
  user_id: string;
  machine_key: string;
  label: string;
  platform: string;
  os: string;
  arch: string;
  app: string;
  app_version: string;
  /** desktop | mobile | browser — optional on old servers; client always sends on register. */
  device_type?: "desktop" | "mobile" | "browser" | string;
  status: "online" | "offline" | string;
  last_seen: string;
  file_op_count?: number;
  /** allow | ask | deny — bot may run host ops on this machine (Auto-review still applies). */
  exec_policy?: "allow" | "ask" | "deny" | string;
  connected?: boolean;
  created_at: string;
  updated_at?: string;
};

export async function listMachines(): Promise<Machine[]> {
  const res = await fetch(`${API_BASE}/v1/machines`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machines?: Machine[] };
  return data.machines || [];
}

export async function registerMachine(input: {
  machine_key: string;
  label?: string;
  platform?: string;
  os?: string;
  arch?: string;
  app?: string;
  app_version?: string;
  /** Client sends; old servers ignore unknown fields. */
  device_type?: "desktop" | "mobile" | "browser";
}): Promise<Machine> {
  const res = await fetch(`${API_BASE}/v1/machines/register`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machine: Machine };
  return data.machine;
}

export async function heartbeatMachine(id: string): Promise<Machine> {
  const res = await fetch(`${API_BASE}/v1/machines/${encodeURIComponent(id)}/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machine: Machine };
  return data.machine;
}

export async function updateMachineLabel(id: string, label: string): Promise<Machine> {
  return updateMachine(id, { label });
}

export async function updateMachine(
  id: string,
  body: { label?: string; exec_policy?: "allow" | "ask" | "deny" | string },
): Promise<Machine> {
  const res = await fetch(`${API_BASE}/v1/machines/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { machine: Machine };
  return data.machine;
}

export async function deleteMachine(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/machines/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}
