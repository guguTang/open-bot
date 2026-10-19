import { toast } from "sonner";
import {
  microAppCloudHTTP,
  microAppGrantCheck,
  microAppGrantConsume,
  putMicroAppGrant,
  uploadConversationAttachment,
  persistConversationMessage,
  type MicroAppGrantDecision,
} from "../../api";
import { runLocalHostOp } from "../hostExecSession";
import { capabilityAvailability } from "./capabilities";
import { deviceCameraGetPhoto, deviceNotify, deviceShare } from "./deviceBridge";
import type { ClientContext } from "../clientEnv";

export type GrantPromptFn = (opts: {
  capability: string;
  suggested: MicroAppGrantDecision | string;
  highSensitivity?: boolean;
}) => Promise<MicroAppGrantDecision | null>;

export type HostBridgeContext = {
  microAppId: string;
  declared: string[];
  machineId?: string;
  conversationId?: string | null;
  client?: ClientContext | null;
  promptGrant: GrantPromptFn;
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

async function ensureGrant(
  ctx: HostBridgeContext,
  capability: string,
): Promise<{ ok: true; grantId?: string } | { ok: false; error: string }> {
  const check = await microAppGrantCheck(ctx.microAppId, capability, ctx.machineId);
  if (check.decision === "deny") {
    return { ok: false, error: "用户已拒绝该能力" };
  }
  if (check.decision === "always_allow" || check.decision === "allow_once") {
    return { ok: true, grantId: check.grant_id };
  }
  const decision = await ctx.promptGrant({
    capability,
    suggested: check.suggested_decision || "allow_once",
    highSensitivity: check.high_sensitivity,
  });
  if (!decision) {
    return { ok: false, error: "用户取消了授权" };
  }
  const g = await putMicroAppGrant(ctx.microAppId, capability, {
    decision,
    machine_id: ctx.machineId || "",
  });
  if (decision === "deny") {
    return { ok: false, error: "用户拒绝了该能力" };
  }
  return { ok: true, grantId: g.id };
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
      const command = String(params.command || params.cmd || "").trim();
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
        reply(ev.source, id, false, undefined, avail.reason || "capability_unavailable");
        return;
      }
      const grant = await ensureGrant(ctx, capability);
      if (!grant.ok) {
        reply(ev.source, id, false, undefined, grant.error);
        return;
      }
      const result = await executeCapability(ctx, capability, params);
      if (grant.grantId) {
        // allow_once: server may already consume on cloud.http; still best-effort.
        try {
          const check = await microAppGrantCheck(ctx.microAppId, capability, ctx.machineId);
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
