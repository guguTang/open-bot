import type { FormEvent } from "react";
import type { Sandbox } from "../../api";
import {
  SettingsCard,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type SandboxSettingsTabProps = {
  sandbox: Sandbox | null;
  sandboxBusy: boolean;
  sandboxMsg: string;
  sandboxCmd: string;
  setSandboxCmd: (v: string) => void;
  sandboxExecOut: string;
  sandboxPath: string;
  setSandboxPath: (v: string) => void;
  sandboxLsOut: string;
  sandboxFilePath: string;
  setSandboxFilePath: (v: string) => void;
  sandboxFileContent: string;
  setSandboxFileContent: (v: string) => void;
  onEnsureSandbox: () => void | Promise<void>;
  onOpenDesktop: () => void | Promise<void>;
  onCheckpointSandbox: () => void | Promise<void>;
  onStopSandbox: () => void | Promise<void>;
  onResetSandbox: () => void | Promise<void>;
  onRefreshSandbox: () => void | Promise<void>;
  onExecSandbox: (e: FormEvent) => void | Promise<void>;
  onLsSandbox: () => void | Promise<void>;
  onWriteSandboxFile: () => void | Promise<void>;
  onReadSandboxFile: () => void | Promise<void>;
};

export function SandboxSettingsTab({
  sandbox,
  sandboxBusy,
  sandboxMsg,
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
  onEnsureSandbox,
  onOpenDesktop,
  onCheckpointSandbox,
  onStopSandbox,
  onResetSandbox,
  onRefreshSandbox,
  onExecSandbox,
  onLsSandbox,
  onWriteSandboxFile,
  onReadSandboxFile,
}: SandboxSettingsTabProps) {
  return (
    <SettingsPage>
      <SettingsHint>
        运行环境由本账户下的 Bot 共用。电脑模式决定读写文件时是账户内多 Bot 共用一份，还是每个 Bot 单独一份。你自己的设备请到「电脑」里查看。
      </SettingsHint>
      <SettingsSection title="状态">
        <SettingsCard>
          <div className="llm-list">
            <div className="llm-item">
              <div>
                <div className="agent-name">状态：{sandbox?.status || "未知"}</div>
                <div className="agent-desc">
                  {sandbox?.image ? `环境 ${sandbox.image}` : "尚未就绪"}
                </div>
                {sandbox?.last_error ? (
                  <div className="agent-desc" style={{ color: "var(--danger)" }}>
                    错误：{sandbox.last_error}
                  </div>
                ) : null}
              </div>
              <div className="llm-actions">
                <button type="button" onClick={() => void onEnsureSandbox()} disabled={sandboxBusy}>
                  确保启动
                </button>
                <button type="button" onClick={() => void onOpenDesktop()} disabled={sandboxBusy}>
                  打开桌面
                </button>
                <button type="button" onClick={() => void onCheckpointSandbox()} disabled={sandboxBusy}>
                  快照
                </button>
                <button type="button" onClick={() => void onStopSandbox()} disabled={sandboxBusy}>
                  停止
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void onResetSandbox()}
                  disabled={sandboxBusy}
                >
                  重置
                </button>
                <button type="button" onClick={() => void onRefreshSandbox()}>
                  刷新
                </button>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="执行命令">
        <SettingsCard padded>
          <form className="llm-form" onSubmit={onExecSandbox}>
            <label>
              命令
              <input
                value={sandboxCmd}
                onChange={(e) => setSandboxCmd(e.target.value)}
                placeholder="echo hi"
                required
              />
            </label>
            <div className="llm-actions">
              <button type="submit" className="primary" disabled={sandboxBusy}>
                运行
              </button>
            </div>
            {sandboxExecOut ? <pre className="settings-status">{sandboxExecOut}</pre> : null}
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="文件">
        <SettingsCard padded>
          <div className="llm-form">
            <label>
              目录路径
              <input
                value={sandboxPath}
                onChange={(e) => setSandboxPath(e.target.value)}
                placeholder="."
              />
            </label>
            <div className="llm-actions">
              <button type="button" onClick={() => void onLsSandbox()} disabled={sandboxBusy}>
                列出
              </button>
            </div>
            {sandboxLsOut ? <pre className="settings-status">{sandboxLsOut}</pre> : null}
            <label>
              文件路径
              <input
                value={sandboxFilePath}
                onChange={(e) => setSandboxFilePath(e.target.value)}
                placeholder="hello.txt"
              />
            </label>
            <label>
              内容
              <textarea
                rows={3}
                value={sandboxFileContent}
                onChange={(e) => setSandboxFileContent(e.target.value)}
              />
            </label>
            <div className="llm-actions">
              <button type="button" onClick={() => void onWriteSandboxFile()} disabled={sandboxBusy}>
                写入
              </button>
              <button type="button" onClick={() => void onReadSandboxFile()} disabled={sandboxBusy}>
                读取
              </button>
            </div>
          </div>
        </SettingsCard>
        {sandboxMsg ? <div className="settings-status">{sandboxMsg}</div> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
