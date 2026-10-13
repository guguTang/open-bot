import { API_BASE, authHeaders, readError } from "./client";

export type MCPServer = {
  id: string;
  user_id: string;
  name: string;
  transport: "stdio" | "sse" | "http" | string;
  command: string;
  args: string[];
  url: string;
  env: Record<string, string>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type MCPServerInput = {
  name: string;
  transport: "stdio" | "sse" | "http" | string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
};

export type MCPToolSummary = {
  name: string;
  description?: string;
};

export async function listMCPServers(): Promise<MCPServer[]> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  return data.servers ?? [];
}

export async function createMCPServer(body: MCPServerInput): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateMCPServer(
  id: string,
  body: Partial<MCPServerInput>,
): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteMCPServer(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function testMCPServer(
  id: string,
): Promise<{
  ok: boolean;
  tool_names?: string[];
  tools?: MCPToolSummary[];
  error?: string;
  count?: number;
}> {
  const res = await fetch(`${API_BASE}/v1/mcp-servers/${id}/test`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function mcpListTools(serverId?: string): Promise<{
  tools: Array<{
    name: string;
    description?: string;
    server_id?: string;
    server_name?: string;
    qualified_name?: string;
    error?: string;
  }>;
  count: number;
}> {
  const res = await fetch(`${API_BASE}/v1/mcp/list-tools`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(serverId ? { server_id: serverId } : {}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function mcpCallTool(body: {
  server_id: string;
  tool: string;
  arguments?: Record<string, unknown>;
}): Promise<{
  ok?: boolean;
  text?: string;
  error?: string;
  content?: string[];
}> {
  const res = await fetch(`${API_BASE}/v1/mcp/call-tool`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
