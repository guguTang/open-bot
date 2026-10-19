import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchMicroAppRuntime,
  uploadMicroAppBundle,
  type MicroApp,
  type MicroAppGrantDecision,
} from "../api";
import { detectClientContext } from "../lib/clientEnv";
import { summarizeUnavailable } from "../lib/microApp/capabilities";
import { MicroAppCapabilityMatrix } from "./MicroAppCapabilityMatrix";
import { buildMicroAppSrcdoc } from "../lib/microApp/sdk";
import { createMicroAppMessageHandler } from "../lib/microApp/hostBridge";
import { useWorkspaceStore } from "../stores/workspace";
import { Button } from "@/components/ui/button";
import { MicroAppGrantDialog } from "./MicroAppGrantDialog";

type Props = {
  app: MicroApp;
  onBack: () => void;
  onAppUpdated?: (app: MicroApp) => void;
};

type GrantPromptState = {
  capability: string;
  suggested: string;
  highSensitivity?: boolean;
  resolve: (d: MicroAppGrantDecision | null) => void;
};

export function MicroAppShell({ app, onBack, onAppUpdated }: Props) {
  const conversation = useWorkspaceStore((s) => s.conversation);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [grantPrompt, setGrantPrompt] = useState<GrantPromptState | null>(null);
  const [uploading, setUploading] = useState(false);
  const revokeRef = useRef<(() => void) | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const client = useMemo(() => {
    try {
      return detectClientContext();
    } catch {
      return null;
    }
  }, []);

  const unavailable = useMemo(
    () => summarizeUnavailable(app.capabilities || [], client),
    [app.capabilities, client],
  );

  const promptGrant = (opts: {
    capability: string;
    suggested: MicroAppGrantDecision | string;
    highSensitivity?: boolean;
  }) =>
    new Promise<MicroAppGrantDecision | null>((resolve) => {
      setGrantPrompt({
        capability: opts.capability,
        suggested: String(opts.suggested || "allow_once"),
        highSensitivity: opts.highSensitivity,
        resolve,
      });
    });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSrcdoc(null);
    revokeRef.current?.();
    revokeRef.current = null;

    void (async () => {
      try {
        const runtime = await fetchMicroAppRuntime(app.id);
        if (cancelled) return;
        const built = buildMicroAppSrcdoc(runtime.entrypoint, runtime.files);
        revokeRef.current = built.revoke;
        setSrcdoc(built.srcdoc);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      revokeRef.current?.();
      revokeRef.current = null;
    };
  }, [app.id, app.bundle_hash, app.updated_at]);

  useEffect(() => {
    const handler = createMicroAppMessageHandler({
      microAppId: app.id,
      declared: app.capabilities || [],
      conversationId: conversation?.id,
      client,
      promptGrant,
    });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [app.id, app.capabilities, conversation?.id, client]);

  async function onUpload(file: File) {
    setUploading(true);
    try {
      const res = await uploadMicroAppBundle(app.id, file);
      toast.success("Bundle 已上传");
      onAppUpdated?.(res.micro_app);
      // reload runtime
      const runtime = await fetchMicroAppRuntime(app.id);
      revokeRef.current?.();
      const built = buildMicroAppSrcdoc(runtime.entrypoint, runtime.files);
      revokeRef.current = built.revoke;
      setSrcdoc(built.srcdoc);
      setError("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={onBack}>
          ← 返回
        </Button>
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{app.title}</div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onUpload(f);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
          上传 Bundle
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={onBack} aria-label="关闭">
          <X className="size-4" />
        </Button>
      </div>

      {(app.capabilities?.length || 0) > 0 ? (
        <details className="shrink-0 border-b border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-xs text-[var(--muted)]">
            能力矩阵
            {unavailable.length > 0
              ? ` · ${unavailable.length} 项在此端不可用`
              : " · 本端均可尝试"}
          </summary>
          <MicroAppCapabilityMatrix
            className="mt-2"
            capabilities={app.capabilities || []}
            client={client}
            compact
          />
        </details>
      ) : null}

      <div className="relative min-h-[320px] flex-1 bg-[var(--bg)]">
        {app.kind === "skill" && !loading && (!srcdoc || /bundle_not_found|404/i.test(error)) ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-[var(--text)]">技能型微应用</p>
            <p className="max-w-sm text-xs text-[var(--muted)]">
              已绑定技能 <code>{app.skill_slug || "（未设置 skill_slug）"}</code>。
              固定到「我的工具」时会在账号与来源 Bot 上启用对应 agent_skills。
            </p>
            <MicroAppCapabilityMatrix
              capabilities={app.capabilities || []}
              client={client}
              className="w-full max-w-sm text-left"
            />
          </div>
        ) : loading ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 className="size-4 animate-spin" /> 加载中…
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-[var(--muted)]">{error.includes("bundle_not_found") || error.includes("404") ? "尚未上传 UI Bundle" : error}</p>
            <Button type="button" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              上传 zip（含 index.html / manifest.json）
            </Button>
            <p className="max-w-sm text-[11px] text-[var(--muted)]">
              对象存储键：micro-apps/&#123;owner&#125;/&#123;app&#125;/。沙箱 iframe 无 allow-same-origin；能力经父页面 Host Bridge。
            </p>
          </div>
        ) : srcdoc ? (
          <iframe
            title={app.title}
            className="size-full min-h-[320px] border-0 bg-white"
            sandbox="allow-scripts allow-forms"
            srcDoc={srcdoc}
            // CSP-ish via sandbox; Phase 1 keeps allow-scripts only.
          />
        ) : null}
      </div>

      <MicroAppGrantDialog
        open={Boolean(grantPrompt)}
        capability={grantPrompt?.capability || ""}
        suggested={grantPrompt?.suggested}
        highSensitivity={grantPrompt?.highSensitivity}
        onCancel={() => {
          grantPrompt?.resolve(null);
          setGrantPrompt(null);
        }}
        onDecide={(d) => {
          grantPrompt?.resolve(d);
          setGrantPrompt(null);
        }}
      />
    </div>
  );
}
