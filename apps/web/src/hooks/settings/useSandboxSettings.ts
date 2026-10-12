import { FormEvent, useCallback, useState } from "react";
import {
  checkpointSandbox,
  ensureSandbox,
  execSandbox,
  getSandbox,
  listSandbox,
  readSandboxFile,
  resetSandbox,
  Sandbox,
  sandboxDesktopURL,
  stopSandbox,
  writeSandboxFile,
} from "../../api";

type ConfirmFn = (opts: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}) => Promise<boolean>;

type UseSandboxSettingsOptions = {
  agentId: string;
  computerMode: string | undefined;
  confirm: ConfirmFn;
};

export function useSandboxSettings({ agentId, computerMode, confirm }: UseSandboxSettingsOptions) {
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [sandboxMsg, setSandboxMsg] = useState("");
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxCmd, setSandboxCmd] = useState("echo hi");
  const [sandboxExecOut, setSandboxExecOut] = useState("");
  const [sandboxPath, setSandboxPath] = useState(".");
  const [sandboxLsOut, setSandboxLsOut] = useState("");
  const [sandboxFilePath, setSandboxFilePath] = useState("hello.txt");
  const [sandboxFileContent, setSandboxFileContent] = useState("hello from open-bot");

  const refreshSandbox = useCallback(async () => {
    const s = await getSandbox();
    if (s.status === "error") {
      try {
        const fresh = await ensureSandbox({});
        setSandbox(fresh);
        setSandboxMsg("已自动重试启动运行环境");
        return;
      } catch {
        /* keep original error */
      }
    }
    setSandbox(s);
  }, []);

  const doCheckpointSandbox = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await checkpointSandbox();
      setSandbox(res.sandbox);
      setSandboxMsg(`已快照：${res.checkpoint_path}`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, []);

  const doEnsureSandbox = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const s = await ensureSandbox({
        agent_id: agentId || undefined,
        mode: computerMode || undefined,
      });
      setSandbox(s);
      setSandboxMsg(
        `已确保运行：${s.container_id || "(no id)"} · 模式 ${s.computer_mode || computerMode || "team"}`,
      );
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, [agentId, computerMode]);

  const doOpenDesktop = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const s = await ensureSandbox({
        desktop: true,
        agent_id: agentId || undefined,
        mode: computerMode || undefined,
      });
      setSandbox(s);
      if (!s.desktop_port) {
        setSandboxMsg(
          s.last_error ||
            "桌面预览未就绪：请先构建桌面镜像（make sandbox-image-desktop）",
        );
        return;
      }
      const url = sandboxDesktopURL({ desktop_token: s.desktop_token });
      window.open(url, "openbot-sandbox-desktop", "noopener,noreferrer");
      setSandboxMsg(`桌面已打开（本地端口 ${s.desktop_port}，经 API JWT 反代）`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, [agentId, computerMode]);

  const doStopSandbox = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const s = await stopSandbox();
      setSandbox(s);
      setSandboxMsg("已停止");
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, []);

  const doResetSandbox = useCallback(async () => {
    const ok = await confirm({
      title: "重置将清空运行环境中的文件并重建，确认？",
      confirmLabel: "重置",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await resetSandbox();
      setSandbox(res.sandbox);
      setSandboxMsg(res.warning || "已重置");
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, [confirm]);

  const doExecSandbox = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSandboxBusy(true);
      setSandboxMsg("");
      setSandboxExecOut("");
      try {
        const res = await execSandbox({ cmd: sandboxCmd });
        setSandboxExecOut(
          `exit=${res.exit_code}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
        );
      } catch (err) {
        setSandboxMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setSandboxBusy(false);
      }
    },
    [sandboxCmd],
  );

  const doLsSandbox = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await listSandbox(sandboxPath || ".");
      const lines = (res.entries || []).map(
        (e) => `${e.is_dir ? "d" : "f"}\t${e.name}\t${e.size}`,
      );
      setSandboxLsOut(lines.join("\n") || "(empty)");
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, [sandboxPath]);

  const doWriteSandboxFile = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      await writeSandboxFile(sandboxFilePath, sandboxFileContent);
      setSandboxMsg(`已写入 ${sandboxFilePath}`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, [sandboxFilePath, sandboxFileContent]);

  const doReadSandboxFile = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxMsg("");
    try {
      const res = await readSandboxFile(sandboxFilePath);
      setSandboxFileContent(res.content);
      setSandboxMsg(`已读取 ${res.path}`);
    } catch (err) {
      setSandboxMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSandboxBusy(false);
    }
  }, [sandboxFilePath]);

  return {
    sandbox,
    sandboxMsg,
    setSandboxMsg,
    sandboxBusy,
    sandboxCmd,
    setSandboxCmd,
    sandboxExecOut,
    sandboxPath,
    setSandboxPath,
    sandboxLsOut,
    sandboxFilePath,
    setSandboxFilePath,
    sandboxFileContent,
    setSandboxFileContent,
    refreshSandbox,
    doCheckpointSandbox,
    doEnsureSandbox,
    doOpenDesktop,
    doStopSandbox,
    doResetSandbox,
    doExecSandbox,
    doLsSandbox,
    doWriteSandboxFile,
    doReadSandboxFile,
  };
}
