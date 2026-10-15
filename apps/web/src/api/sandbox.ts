import { API_BASE, authHeaders, getToken, readError, triggerBrowserDownload } from "./client";

export type Sandbox = {
  id: string;
  user_id: string;
  container_id: string;
  status: string;
  image: string;
  workdir_host: string;
  computer_mode?: string;
  desktop_port?: number;
  desktop_token?: string;
  checkpoint_path?: string;
  created_at: string;
  updated_at: string;
  last_error?: string;
};

export type SandboxExecResult = {
  exit_code: number;
  stdout: string;
  stderr: string;
};

export type SandboxDirEntry = {
  name: string;
  is_dir: boolean;
  size: number;
};

export async function getSandbox(ensure?: boolean): Promise<Sandbox> {
  const q = ensure ? "?ensure=1" : "";
  const res = await fetch(`${API_BASE}/v1/sandbox${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function ensureSandbox(opts?: {
  desktop?: boolean;
  agent_id?: string;
  mode?: string;
}): Promise<Sandbox> {
  const res = await fetch(`${API_BASE}/v1/sandbox/ensure`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      desktop: Boolean(opts?.desktop),
      agent_id: opts?.agent_id || undefined,
      mode: opts?.mode || undefined,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** Proxied noVNC URL (JWT via access_token query + cookie). */
export function sandboxDesktopURL(extra?: { desktop_token?: string }): string {
  const token = getToken() || "";
  const q = new URLSearchParams();
  if (token) q.set("access_token", token);
  if (extra?.desktop_token) q.set("desktop_token", extra.desktop_token);
  const qs = q.toString();
  return `${API_BASE}/v1/sandbox/desktop${qs ? `?${qs}` : ""}`;
}

export async function stopSandbox(): Promise<Sandbox> {
  const res = await fetch(`${API_BASE}/v1/sandbox/stop`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function resetSandbox(): Promise<{ sandbox: Sandbox; warning?: string }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/reset`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function execSandbox(body: {
  cmd: string;
  workdir?: string;
  timeout_sec?: number;
}): Promise<SandboxExecResult> {
  const res = await fetch(`${API_BASE}/v1/sandbox/exec`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function downloadSandboxFile(
  path: string,
  opts?: { agent_id?: string; conversation_id?: string },
): Promise<void> {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  if (opts?.conversation_id) q.set("conversation_id", opts.conversation_id);
  const res = await fetch(`${API_BASE}/v1/sandbox/files/download?${q.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const quoted = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
  const name = quoted?.[1] || path.split("/").filter(Boolean).pop() || "download";
  triggerBrowserDownload(blob, name);
}

export async function readSandboxFile(
  path: string,
  opts?: { agent_id?: string; conversation_id?: string },
): Promise<{ path: string; content: string }> {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  if (opts?.conversation_id) q.set("conversation_id", opts.conversation_id);
  const res = await fetch(`${API_BASE}/v1/sandbox/files?${q.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function writeSandboxFile(
  path: string,
  content: string,
  opts?: { agent_id?: string; conversation_id?: string },
): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/files`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      path,
      content,
      agent_id: opts?.agent_id,
      conversation_id: opts?.conversation_id,
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function listSandbox(
  path = "/workspace",
  opts?: { agent_id?: string; conversation_id?: string },
): Promise<{
  path: string;
  entries: SandboxDirEntry[];
}> {
  const q = new URLSearchParams({ path });
  if (opts?.agent_id) q.set("agent_id", opts.agent_id);
  if (opts?.conversation_id) q.set("conversation_id", opts.conversation_id);
  const res = await fetch(`${API_BASE}/v1/sandbox/ls?${q.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function checkpointSandbox(): Promise<{ checkpoint_path: string; sandbox: Sandbox }> {
  const res = await fetch(`${API_BASE}/v1/sandbox/checkpoint`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
