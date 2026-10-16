/** Shared host-exec request shape (session + review callers). */
export type HostExecRequest = {
  type: "exec";
  req_id: string;
  op: "ls" | "read" | "write" | "delete" | "move" | string;
  path?: string;
  dest?: string;
  content?: string;
  conversation_id?: string;
  ssh_host?: string;
  ssh_user?: string;
  ssh_port?: number;
  ssh_fingerprint?: string;
  /** Optional shallow-list filters for host_ls. */
  limit?: number;
  sort?: string;
  glob?: string;
  /** Structured desktop-control arguments (click/type/key/scroll/ax/…). */
  args?: Record<string, unknown>;
  /** API already got allow/deny in chat; execute without asking again. */
  preconfirmed?: boolean;
};
