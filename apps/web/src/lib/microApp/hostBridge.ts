import { toast } from "sonner";
import {
  microAppCloudHTTP,
  microAppGrantCheck,
  microAppGrantConsume,
  putMicroAppGrant,
  uploadConversationAttachment,
  persistConversationMessage,
  getMicroApp,
  updateRoutine,
  runRoutine,
  fetchMe,
  openPrimaryConversation,
  sendMessageStream,
  setSkillEnabled,
  setAgentSkill,
  listAgentSkills,
  listSkills,
  listSandbox,
  readSandboxFile,
  writeSandboxFile,
  type MicroAppGrantDecision,
} from "../../api";
import { reviewLocalHostOp, runLocalHostOp } from "../hostExecSession";
import { capabilityAvailability } from "./capabilities";
import {
  deviceCameraGetPhoto,
  deviceNotify,
  deviceShare,
  deviceMicCapture,
  deviceGeoGetCurrentPosition,
} from "./deviceBridge";
import type { ClientContext } from "../clientEnv";

export type GrantPromptOptions = {
  capability: string;
  suggested: MicroAppGrantDecision | string;
  highSensitivity?: boolean;
  /** host.shell.run: the exact command being requested. */
  command?: string;
  /** Suggested allowlist prefix for 「始终允许」 (e.g. "git status"). */
  suggestedPrefix?: string;
  /** Existing always_allow grant whose allowlist didn't cover this command. */
  overridingAlwaysAllow?: boolean;
  /** Why we are prompting (allowlist miss / Auto-review asks to confirm). */
  reason?: string;
};

export type GrantPromptResult = {
  decision: MicroAppGrantDecision;
  /** host.shell.run + always_allow: prefix to add to command_allowlist; "" = any command. */
  allowlistEntry?: string;
};

export type GrantPromptFn = (opts: GrantPromptOptions) => Promise<GrantPromptResult | null>;

/** User-visible confirm before starting an agent run (agent.invoke). */
export type ActionConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ActionConfirmFn = (opts: ActionConfirmOptions) => Promise<boolean>;

export type HostBridgeContext = {
  microAppId: string;
  declared: string[];
  /** Bound Bot id (micro_apps.agent_id); required for agent.invoke. */
  agentId?: string | null;
  machineId?: string;
  conversationId?: string | null;
  client?: ClientContext | null;
  promptGrant: GrantPromptFn;
  /** Extra confirm for agent.invoke (always shown before starting a run). */
  promptActionConfirm?: ActionConfirmFn;
};

type RpcMessage = {
  source?: string;
  type?: string;
  id?: string;
  capability?: string;
  params?: Record<string, unknown>;
};

function reply(
  source: MessageEventSource | null,
  id: string,
  ok: boolean,
  result?: unknown,
  error?: string,
) {
  if (!source || !("postMessage" in source)) return;
  (source as Window).postMessage(
    { source: "openbot.micro.host", type: "response", id, ok, result, error },
    "*",
  );
}

type GrantOutcome =
  | { ok: true; grantId?: string }
  | { ok: false; error: string; code?: string };

/** host.shell.run command text from SDK params. */
export function shellCommandFromParams(params: Record<string, unknown>): string {
  return String(params.command || params.cmd || "").trim();
}

/**
 * Default allowlist prefix suggestion: program + first sub-command word
 * ("git status -s" → "git status", "ls -la" → "ls"). Empty for compound commands.
 */
export function suggestShellAllowPrefix(command: string): string {
  const cmd = command.trim().replace(/\s+/g, " ");
  if (!cmd || /[;&|`<>\n\r]|\$\(/.test(cmd)) return "";
  const words = cmd.split(" ");
  const first = words[0] || "";
  const second = words[1] || "";
  if (second && /^[a-z][a-z0-9._:-]*$/i.test(second) && !second.startsWith("-")) {
    return `${first} ${second}`;
  }
  return first;
}

async function ensureGrant(
  ctx: HostBridgeContext,
  capability: string,
  params: Record<string, unknown> = {},
): Promise<GrantOutcome> {
  const isShell = capability === "host.shell.run";
  const command = isShell ? shellCommandFromParams(params) : "";
  if (isShell && !command) return { ok: false, error: "command required", code: "invalid_params" };

  // Host-side Auto-review stays authoritative: hard deny / exec_policy=deny always win,
  // regardless of any micro-app Grant.
  let reviewConfirm = false;
  let reviewReason = "";
  if (isShell) {
    const rev = reviewLocalHostOp({
      type: "exec",
      req_id: "micro-review",
      op: "shell",
      path: command,
      dest: params.terminal ? "terminal" : undefined,
    });
    if (rev.tier === "deny") return { ok: false, error: rev.reason || "Auto-review 拒绝了该命令", code: "auto_review_denied" };
    reviewConfirm = rev.tier === "confirm";
    reviewReason = rev.reason;
  }

  const check = await microAppGrantCheck(ctx.microAppId, capability, ctx.machineId, command || undefined);
  if (check.decision === "deny") {
    return { ok: false, error: "用户已拒绝该能力", code: "grant_denied" };
  }
  if (check.decision === "allow_once") {
    return { ok: true, grantId: check.grant_id };
  }
  if (check.decision === "always_allow") {
    // Shell: an empty allowlist means "any command" — but commands Auto-review wants
    // confirmed still prompt unless the user explicitly allowlisted them.
    if (!isShell || check.command_allowlisted || !reviewConfirm) {
      return { ok: true, grantId: check.grant_id };
    }
  }

  const overriding = isShell && check.grant_decision === "always_allow";
  const choice = await ctx.promptGrant({
    capability,
    suggested: check.suggested_decision || "allow_once",
    highSensitivity: check.high_sensitivity,
    command: command || undefined,
    suggestedPrefix: isShell ? suggestShellAllowPrefix(command) : undefined,
    overridingAlwaysAllow: overriding,
    reason:
      check.reason === "command_not_in_allowlist"
        ? "该命令不在此工具的命令白名单内"
        : reviewConfirm
          ? reviewReason
          : undefined,
  });
  if (!choice) {
    return { ok: false, error: "用户取消了授权", code: "grant_required" };
  }
  const { decision } = choice;

  if (overriding) {
    // Keep the existing always_allow grant: allow_once / deny apply to this run only;
    // 「始终允许」 extends the allowlist.
    if (decision === "deny") return { ok: false, error: "用户拒绝了这次命令", code: "grant_denied" };
    if (decision === "allow_once") return { ok: true };
    const entry = (choice.allowlistEntry ?? "").trim();
    const current = check.command_allowlist || [];
    const g = await putMicroAppGrant(ctx.microAppId, capability, {
      decision: "always_allow",
      machine_id: ctx.machineId || "",
      command_allowlist: entry ? Array.from(new Set([...current, entry])) : [],
    });
    return { ok: true, grantId: g.id };
  }

  const body: Parameters<typeof putMicroAppGrant>[2] = {
    decision,
    machine_id: ctx.machineId || "",
  };
  if (isShell && decision === "always_allow") {
    const entry = (choice.allowlistEntry ?? "").trim();
    body.command_allowlist = entry ? [entry] : [];
  }
  const g = await putMicroAppGrant(ctx.microAppId, capability, body);
  if (decision === "deny") {
    return { ok: false, error: "用户拒绝了该能力", code: "grant_denied" };
  }
  return { ok: true, grantId: g.id };
}


/** Always-on discovery skills (find-skills) must never be disabled via skill.toggle. */
const ALWAYS_ON_SKILL_SLUGS = new Set(["find-skills"]);

function isAlwaysOnSkillName(
  name: string,
  meta?: { always_on?: boolean; disable_blocked?: boolean } | null,
): boolean {
  if (meta?.always_on || meta?.disable_blocked) return true;
  return ALWAYS_ON_SKILL_SLUGS.has(name.trim());
}

/**
 * Resolve a Bot-workspace path. Only paths under /workspace are allowed
 * (no .., no absolute escape). Relative paths are joined under /workspace.
 */
export function resolveBotWorkspacePath(raw: string): string {
  let p = String(raw || "").trim() || "/workspace";
  if (p.includes("\0")) throw new Error("路径无效");
  p = p.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/workspace/${p}`;
  if (p !== "/workspace" && !p.startsWith("/workspace/")) {
    throw new Error("host.fs.workspace 仅允许 /workspace 下路径");
  }
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") throw new Error("路径不得包含 ..");
    parts.push(seg);
  }
  if (!parts.length || parts[0] !== "workspace") {
    throw new Error("host.fs.workspace 仅允许 /workspace 下路径");
  }
  return "/" + parts.join("/");
}

async function executeCapability(
  ctx: HostBridgeContext,
  capability: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (capability) {
    case "ui.notify": {
      const msg = String(params.message || params.text || "").trim() || "通知";
      toast.message(msg);
      return { ok: true };
    }
    case "host.screenshot": {
      const result = await runLocalHostOp({
        type: "exec",
        req_id: `micro-${Date.now()}`,
        op: "screenshot",
        path: String(params.scope || params.path || "main"),
        dest: params.display != null ? String(params.display) : undefined,
        args: params.window_id != null ? { window_id: params.window_id } : undefined,
        preconfirmed: true,
      });
      if (result.ok === false) throw new Error(String(result.error || "screenshot failed"));
      return result;
    }
    case "host.fs.read": {
      // System file picker — no broad disk scan.
      const file = await pickFile(params.accept ? String(params.accept) : undefined);
      if (!file) throw new Error("未选择文件");
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let encoding = "base64";
      let content: string;
      if (params.as === "text" || (file.type.startsWith("text/") && bytes.length < 2_000_000)) {
        encoding = "utf8";
        content = new TextDecoder().decode(bytes);
      } else {
        content = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
      }
      return { name: file.name, mime: file.type || "application/octet-stream", size: file.size, encoding, content };
    }
    case "host.fs.write": {
      const name = String(params.name || params.filename || "download.bin");
      const encoding = String(params.encoding || "utf8");
      let bytes: Uint8Array;
      if (encoding === "base64") {
        const bin = atob(String(params.content || ""));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = new TextEncoder().encode(String(params.content || ""));
      }
      const mime = String(params.mime || "application/octet-stream");
      await saveFile(name, bytes, mime);
      return { ok: true, name };
    }
    case "host.shell.run": {
      // Grant + Auto-review already passed in ensureGrant (hard deny re-checked there).
      const command = shellCommandFromParams(params);
      if (!command) throw new Error("command required");
      const result = await runLocalHostOp({
        type: "exec",
        req_id: `micro-shell-${Date.now()}`,
        op: "shell",
        path: command,
        dest: params.terminal ? "terminal" : undefined,
        preconfirmed: true,
      });
      if (result.ok === false) throw new Error(String(result.error || "shell failed"));
      return result;
    }
    case "cloud.http": {
      return microAppCloudHTTP(ctx.microAppId, {
        url: String(params.url || ""),
        method: params.method ? String(params.method) : "GET",
        headers: (params.headers as Record<string, string>) || undefined,
        body: params.body != null ? String(params.body) : undefined,
        machine_id: ctx.machineId,
      });
    }
    case "device.camera": {
      return deviceCameraGetPhoto(params);
    }
    case "device.notify": {
      return deviceNotify(params);
    }
    case "device.share": {
      return deviceShare(params);
    }
    case "chat.attach": {
      const convId = String(params.conversation_id || ctx.conversationId || "").trim();
      if (!convId) throw new Error("无当前会话，无法附到聊天");
      const name = String(params.filename || params.name || "image.png");
      const mime = String(params.mime || "image/png");
      const encoding = String(params.encoding || "base64");
      let file: File;
      if (encoding === "utf8") {
        file = new File([String(params.content || "")], name, { type: mime });
      } else {
        const bin = atob(String(params.content || ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        file = new File([new Uint8Array(bytes)], name, { type: mime });
      }
      const meta = await uploadConversationAttachment(convId, file);
      const md =
        mime.startsWith("image/")
          ? `![${name}](${meta.url || meta.path})`
          : `[${name}](${meta.url || meta.path})`;
      // Align with present_image: persist a user-visible message with attachment markdown.
      const msg = await persistConversationMessage(convId, md);
      return { ok: true, attachment: meta, message: msg, markdown: md };
    }
    case "host.clipboard.read": {
      if (!navigator.clipboard?.readText) throw new Error("剪贴板读取不可用");
      const text = await navigator.clipboard.readText();
      return { text };
    }
    case "host.clipboard.write": {
      if (!navigator.clipboard?.writeText) throw new Error("剪贴板写入不可用");
      const text = String(params.text ?? params.content ?? "");
      await navigator.clipboard.writeText(text);
      return { ok: true, bytes: text.length };
    }
    case "host.app.find": {
      const name = String(params.name || params.query || "").trim();
      if (!name) throw new Error("name required");
      const result = await runLocalHostOp({
        type: "exec",
        req_id: `micro-find-${Date.now()}`,
        op: "find_app",
        path: name,
        preconfirmed: true,
      });
      if (result.ok === false) throw new Error(String(result.error || "find_app failed"));
      return result;
    }
    case "host.app.open": {
      const name = String(params.name || params.path || "").trim();
      if (!name) throw new Error("name required");
      const result = await runLocalHostOp({
        type: "exec",
        req_id: `micro-open-${Date.now()}`,
        op: "open",
        path: name,
        preconfirmed: true,
      });
      if (result.ok === false) throw new Error(String(result.error || "open failed"));
      return result;
    }
    case "account.profile": {
      const me = await fetchMe();
      return {
        id: me.id,
        username: me.username,
        email: me.email || "",
        org_id: me.org_id || "",
        role: me.role || "",
      };
    }
    case "routine.manage": {
      const app = await getMicroApp(ctx.microAppId);
      const rid = String(app.routine_id || "").trim();
      if (!rid) throw new Error("该微应用未绑定例行任务（需 kind=routine 且已 pin）");
      const action = String(params.action || "").trim().toLowerCase();
      if (action === "enable" || action === "disable") {
        const enabled = action === "enable" ? true : action === "disable" ? false : Boolean(params.enabled);
        const rt = await updateRoutine(rid, { enabled });
        return { ok: true, action, routine: rt };
      }
      if (action === "update") {
        const patch: Parameters<typeof updateRoutine>[1] = {};
        if (params.prompt != null) patch.prompt = String(params.prompt);
        if (params.schedule_cron != null) patch.schedule_cron = String(params.schedule_cron);
        if (params.timezone != null) patch.timezone = String(params.timezone);
        if (params.name != null) patch.name = String(params.name);
        if (params.enabled != null) patch.enabled = Boolean(params.enabled);
        if (params.max_retries != null) patch.max_retries = Number(params.max_retries);
        if (params.quiet_unchanged != null) patch.quiet_unchanged = Boolean(params.quiet_unchanged);
        if (params.triggers != null) patch.triggers = params.triggers as never;
        if (Object.keys(patch).length === 0) throw new Error("update 需要 prompt / schedule_cron / timezone 等字段");
        const rt = await updateRoutine(rid, patch);
        return { ok: true, action: "update", routine: rt };
      }
      if (action === "run_now" || action === "run") {
        const res = await runRoutine(rid);
        return { ok: true, action: "run_now", ...res };
      }
      throw new Error("routine.manage action 须为 enable|disable|update|run_now");
    }
    case "host.fs.workspace": {
      const action = String(params.action || params.op || "read").trim().toLowerCase();
      const path = resolveBotWorkspacePath(String(params.path || "/workspace"));
      const agentId = String(ctx.agentId || "").trim() || undefined;
      const conversationId = String(params.conversation_id || ctx.conversationId || "").trim() || undefined;
      const opts = { agent_id: agentId, conversation_id: conversationId };
      if (action === "ls" || action === "list") {
        return listSandbox(path, opts);
      }
      if (action === "read" || action === "get") {
        return readSandboxFile(path, opts);
      }
      if (action === "write" || action === "put") {
        const content = params.content != null ? String(params.content) : "";
        return writeSandboxFile(path, content, opts);
      }
      throw new Error("host.fs.workspace action 须为 ls|read|write");
    }
    case "agent.invoke": {
      const bound = String(ctx.agentId || "").trim();
      if (!bound) {
        throw new Error("该微应用未绑定 agent_id，无法 agent.invoke");
      }
      // Only the micro_app's bound agent — ignore any other agent_id in params.
      const requested = String(params.agent_id || params.agentId || "").trim();
      if (requested && requested !== bound) {
        throw new Error("agent.invoke 仅允许调用本微应用绑定的 Bot");
      }
      const message = String(params.message || params.prompt || params.text || "").trim();
      if (!message) throw new Error("message required");
      const confirmFn = ctx.promptActionConfirm;
      if (!confirmFn) throw new Error("缺少用户确认入口，无法启动对话");
      const ok = await confirmFn({
        title: "确认启动 Bot 对话",
        description: `将向绑定 Bot 发送并开始一轮运行：\n\n${message.length > 280 ? message.slice(0, 280) + "…" : message}`,
        confirmLabel: "开始运行",
        cancelLabel: "取消",
      });
      if (!ok) throw new Error("用户取消了 agent.invoke");
      let conversationId = String(params.conversation_id || "").trim();
      if (!conversationId) {
        const conv = await openPrimaryConversation(bound);
        conversationId = conv.id;
      }
      let reply = "";
      let errMsg = "";
      await sendMessageStream(
        conversationId,
        message,
        {
          onToken: (t) => {
            reply += t;
          },
          onError: (msg) => {
            errMsg = msg || "agent.invoke 失败";
          },
        },
        undefined,
        undefined,
        [bound],
        ctx.client || undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        ctx.microAppId,
      );
      if (errMsg) throw new Error(errMsg);
      return {
        ok: true,
        agent_id: bound,
        conversation_id: conversationId,
        reply,
      };
    }
    case "skill.toggle": {
      const name = String(params.skill || params.name || params.slug || "").trim();
      if (!name) throw new Error("skill name required");
      if (params.enabled === undefined && params.enable === undefined) {
        throw new Error("enabled required");
      }
      const enabled = Boolean(params.enabled ?? params.enable);
      const scope = String(params.scope || "").trim().toLowerCase() || (ctx.agentId ? "agent" : "account");

      // Client-side always_on gate (server also returns skill_disable_blocked).
      if (!enabled) {
        if (isAlwaysOnSkillName(name)) {
          throw new Error("不可关闭 always_on 技能（含 find-skills）");
        }
        try {
          if (scope === "agent" || scope === "both") {
            const aid = String(ctx.agentId || "").trim();
            if (aid) {
              const skills = await listAgentSkills(aid);
              const hit = skills.find((s) => s.name === name);
              if (hit && isAlwaysOnSkillName(name, hit)) {
                throw new Error("不可关闭 always_on 技能（含 find-skills）");
              }
            }
          }
          if (scope === "account" || scope === "both" || scope === "agent") {
            const skills = await listSkills();
            const hit = skills.find((s) => s.name === name) as
              | { name: string; always_on?: boolean; disable_blocked?: boolean }
              | undefined;
            if (hit && isAlwaysOnSkillName(name, hit)) {
              throw new Error("不可关闭 always_on 技能（含 find-skills）");
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("always_on")) throw e;
          // listing failed — still attempt API (server enforces)
        }
      }

      const out: Record<string, unknown> = { ok: true, skill: name, enabled, scope };
      if (scope === "account" || scope === "both") {
        try {
          out.account = await setSkillEnabled(name, enabled);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/always-on|always_on|skill_disable_blocked|disable blocked/i.test(msg)) {
            throw new Error("不可关闭 always_on 技能（含 find-skills）");
          }
          throw e;
        }
      }
      if (scope === "agent" || scope === "both") {
        const aid = String(ctx.agentId || "").trim();
        if (!aid) throw new Error("skill.toggle scope=agent 需要微应用绑定 agent_id");
        try {
          out.agent = await setAgentSkill(aid, name, enabled);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/always-on|always_on|skill_disable_blocked|disable blocked/i.test(msg)) {
            throw new Error("不可关闭 always_on 技能（含 find-skills）");
          }
          throw e;
        }
      }
      if (scope !== "account" && scope !== "agent" && scope !== "both") {
        throw new Error("skill.toggle scope 须为 account|agent|both");
      }
      return out;
    }
    case "device.mic": {
      return deviceMicCapture(params);
    }
    case "device.geo": {
      return deviceGeoGetCurrentPosition(params);
    }
    default:
      throw new Error(`unsupported capability: ${capability}`);
  }
}

function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const f = input.files?.[0] || null;
      input.remove();
      resolve(f);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

async function saveFile(name: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const w = window as Window & {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
    }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw new Error("用户取消了保存");
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function createMicroAppMessageHandler(ctx: HostBridgeContext) {
  return async (ev: MessageEvent) => {
    const data = ev.data as RpcMessage;
    if (!data || data.source !== "openbot.micro" || data.type !== "request") return;
    const id = String(data.id || "");
    const capability = String(data.capability || "").trim();
    const params = (data.params || {}) as Record<string, unknown>;
    if (!id || !capability) return;

    try {
      const avail = capabilityAvailability(capability, {
        client: ctx.client,
        declared: ctx.declared,
      });
      if (!avail.available) {
        const code = avail.code || "capability_unavailable";
        reply(ev.source, id, false, undefined, `${code}: ${avail.reason || code}`);
        return;
      }
      const grant = await ensureGrant(ctx, capability, params);
      if (!grant.ok) {
        const code = grant.code || "grant_denied";
        reply(ev.source, id, false, undefined, `${code}: ${grant.error}`);
        return;
      }
      const result = await executeCapability(ctx, capability, params);
      if (grant.grantId) {
        // allow_once: server may already consume on cloud.http; still best-effort.
        try {
          const check = await microAppGrantCheck(
            ctx.microAppId,
            capability,
            ctx.machineId,
            capability === "host.shell.run" ? shellCommandFromParams(params) : undefined,
          );
          if (check.decision === "allow_once" && check.grant_id) {
            await microAppGrantConsume(ctx.microAppId, check.grant_id);
          }
        } catch {
          /* ignore */
        }
      }
      reply(ev.source, id, true, result);
    } catch (e) {
      reply(ev.source, id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  };
}
