import { hostExecWebSocketUrl } from "../api";
import {
  classifyHostExecReviewForMachine,
  getHostExecMachinePolicy,
  getHostExecUserSettings,
  hostShellReadonlyAutoEnabled,
  hostWritesEnabled,
  type HostExecReview,
} from "./hostExecReview";
import type { HostExecRequest } from "./hostExecTypes";

export type { HostExecRequest } from "./hostExecTypes";

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } })
    .__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

function isWriteOp(op: string): boolean {
  return op === "write" || op === "delete" || op === "move" || op === "ssh_write" || op === "ssh_delete" || op === "ssh_exec";
}

const COMPUTER_INVOKE: Record<string, string> = {
  click: "host_click",
  type: "host_type",
  key: "host_key",
  scroll: "host_scroll",
  mouse_move: "host_mouse_move",
  drag: "host_drag",
  list_windows: "host_list_windows",
  ax: "host_ax",
  tcc_status: "host_tcc_status",
};

const COMPUTER_ARG_KEYS: Record<string, string[]> = {
  click: ["frame_id", "x", "y", "button", "clicks", "modifiers", "element_ref", "background", "pid"],
  type: ["frame_id", "text", "element_ref", "background", "pid"],
  key: ["frame_id", "key", "modifiers", "element_ref", "background", "pid"],
  scroll: ["frame_id", "x", "y", "dx", "dy", "background", "pid"],
  mouse_move: ["frame_id", "x", "y", "background", "pid"],
  drag: ["frame_id", "x", "y", "x2", "y2", "button", "background", "pid"],
  list_windows: ["frame_id"],
  ax: ["frame_id", "app", "pid", "window_id", "max_depth", "limit", "x", "y"],
  tcc_status: [],
};

function computerInvokeArgs(op: string, args: Record<string, unknown> | undefined): Record<string, unknown> {
  const src = args || {};
  const keys = COMPUTER_ARG_KEYS[op] || [];
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = src[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

async function runOp(req: HostExecRequest): Promise<Record<string, unknown>> {
  const invoke = tauriInvoke();
  if (!invoke) {
    return { ok: false, error: "当前窗口不能操作本机文件" };
  }
  const path = req.path || "";
  if (req.op === "ls") {
    return (await invoke("host_ls", {
      path,
      limit: req.limit,
      sort: req.sort,
      glob: req.glob,
    })) as Record<string, unknown>;
  }
  if (req.op === "read") return (await invoke("host_read", { path })) as Record<string, unknown>;
  if (req.op === "write") {
    return (await invoke("host_write", { path, content: req.content || "" })) as Record<string, unknown>;
  }
  if (req.op === "delete") return (await invoke("host_delete", { path })) as Record<string, unknown>;
  if (req.op === "move") {
    return (await invoke("host_move", { path, dest: req.dest || "" })) as Record<string, unknown>;
  }
  if (req.op === "find_app") {
    return (await invoke("host_find_app", { name: path })) as Record<string, unknown>;
  }
  if (req.op === "open") return (await invoke("host_open", { name: path })) as Record<string, unknown>;
  if (req.op === "screenshot") {
    const args: Record<string, unknown> = {};
    const rawWindow = req.args?.window_id;
    const windowId = typeof rawWindow === "number" ? rawWindow : Number(rawWindow);
    if (path === "window" && Number.isInteger(windowId) && windowId > 0) {
      args.window_id = windowId;
    } else {
      args.scope = path === "all" ? "all" : "main";
      const display = Number(req.dest);
      if (req.dest && Number.isInteger(display) && display >= 1 && display <= 16) {
        args.display = display;
      }
    }
    return (await invoke("host_screenshot", args)) as Record<string, unknown>;
  }
  const computerCmd = COMPUTER_INVOKE[req.op];
  if (computerCmd) {
    return (await invoke(computerCmd, computerInvokeArgs(req.op, req.args))) as Record<string, unknown>;
  }
  if (req.op === "shell") {
    return (await invoke("host_shell", {
      command: path,
      terminal: req.dest === "terminal",
    })) as Record<string, unknown>;
  }
  if (req.op.startsWith("ssh_")) {
    const args = {
      host: req.ssh_host || "",
      user: req.ssh_user || "",
      port: req.ssh_port || 0,
      path,
    };
    if (req.op === "ssh_ls") return (await invoke("host_ssh_ls", args)) as Record<string, unknown>;
    if (req.op === "ssh_read") return (await invoke("host_ssh_read", args)) as Record<string, unknown>;
    if (req.op === "ssh_write") {
      return (await invoke("host_ssh_write", { ...args, content: req.content || "" })) as Record<string, unknown>;
    }
    if (req.op === "ssh_delete") return (await invoke("host_ssh_delete", args)) as Record<string, unknown>;
    if (req.op === "ssh_exec") {
      return (await invoke("host_ssh_exec", {
        host: args.host,
        user: args.user,
        port: args.port,
        command: path,
      })) as Record<string, unknown>;
    }
  }
  return { ok: false, error: "不支持的操作" };
}

async function probeSsh(req: HostExecRequest): Promise<Record<string, unknown>> {
  const invoke = tauriInvoke();
  if (!invoke) return { ok: false, error: "当前窗口不能连接远程主机" };
  try {
    return (await invoke("host_ssh_probe", {
      host: req.ssh_host || "",
      user: req.ssh_user || "",
      port: req.ssh_port || 0,
    })) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Client Auto-review gate: machine exec_policy + user settings + built-in tiers. */
function reviewForRequest(req: HostExecRequest): HostExecReview {
  let settings = getHostExecUserSettings();
  // Legacy kill-switch: off forces confirm (same as Auto-review off), even for 始终允许.
  if (!hostShellReadonlyAutoEnabled()) {
    settings = { ...settings, auto_review_enabled: false };
  }
  return classifyHostExecReviewForMachine(
    req.op,
    req.path || "",
    req.dest || "",
    settings,
    getHostExecMachinePolicy(),
  );
}

async function refineWriteReview(req: HostExecRequest, base: HostExecReview): Promise<HostExecReview> {
  if (req.op !== "write") return base;
  const invoke = tauriInvoke();
  if (!invoke) return base;
  try {
    const stat = (await invoke("host_stat", { path: req.path || "" })) as {
      exists?: boolean;
      is_dir?: boolean;
      under_home?: boolean;
    };
    if (stat.under_home === false) {
      return { tier: "confirm", reason: "主目录外写入，需你确认", code: "write_outside_home" };
    }
    if (stat.exists && !stat.is_dir) {
      return { tier: "confirm", reason: "覆盖已有文件，需你确认", code: "write_overwrite" };
    }
    // New file under home: still confirm via API hostOpNeedsConfirm; keep confirm.
    return base;
  } catch {
    return base;
  }
}

async function needsConfirm(req: HostExecRequest): Promise<boolean> {
  let rev = reviewForRequest(req);
  if (rev.code === "write") rev = await refineWriteReview(req, rev);
  return rev.tier === "confirm";
}

function hardDenyReview(req: HostExecRequest): HostExecReview | null {
  const rev = reviewForRequest(req);
  return rev.tier === "deny" ? rev : null;
}

export function startHostExecSession(opts: {
  token: string;
  machineId: string;
  confirm: (req: HostExecRequest) => Promise<boolean>;
}): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(hostExecWebSocketUrl(opts.machineId, opts.token));
    socket = ws;
    ws.onmessage = (ev) => {
      void (async () => {
        let req: HostExecRequest;
        try {
          req = JSON.parse(String(ev.data)) as HostExecRequest;
        } catch {
          return;
        }
        if (req.type !== "exec" || !req.req_id) return;
        let result: Record<string, unknown>;
        try {
          const hard = hardDenyReview(req);
          if (hard) {
            result = {
              ok: false,
              denied: true,
              auto_review: hard.code === "exec_policy_deny" ? undefined : "deny",
              exec_policy: hard.code === "exec_policy_deny" ? "deny" : undefined,
              review_code: hard.code,
              error: hard.reason,
            };
          } else if (isWriteOp(req.op) && !hostWritesEnabled()) {
            result = {
              ok: false,
              error: req.op.startsWith("ssh_") ? "写入已关闭，远程写入、删除和命令也停着" : "本机写入已关闭",
            };
          } else if (req.preconfirmed) {
            result = await runOp(req);
            result.confirmed = true;
          } else if (await needsConfirm(req)) {
            let confirmReq = req;
            let blocked: Record<string, unknown> | null = null;
            if (req.op.startsWith("ssh_")) {
              const probe = await probeSsh(req);
              if (probe.ok !== true) {
                blocked = probe;
              } else if (probe.host_key_status === "changed") {
                blocked = {
                  ok: false,
                  error: `主机密钥和 known_hosts 不一致（${String(probe.fingerprint || "")}）。连接已断开`,
                };
              } else if (probe.host_key_status === "unknown" && probe.fingerprint) {
                confirmReq = { ...req, ssh_fingerprint: String(probe.fingerprint) };
              }
            }
            if (blocked) {
              result = blocked;
            } else {
              const allowed = await opts.confirm(confirmReq);
              if (!allowed) {
                result = { ok: false, denied: true, error: "用户拒绝了这次操作" };
              } else {
                result = await runOp(req);
                result.confirmed = true;
              }
            }
          } else {
            result = await runOp(req);
          }
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "exec_result", req_id: req.req_id, ...result }));
        }
      })();
    };
    ws.onclose = () => {
      if (stopped) return;
      retry = setTimeout(connect, 2000);
    };
  };
  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}

