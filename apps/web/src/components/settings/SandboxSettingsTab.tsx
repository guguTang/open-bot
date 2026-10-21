import type { FormEvent } from "react";
import type { Sandbox } from "../../api";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void onEnsureSandbox()} disabled={sandboxBusy}>
                  确保启动
                </Button>
                <Button type="button" variant="outline" onClick={() => void onOpenDesktop()} disabled={sandboxBusy}>
                  打开桌面
                </Button>
                <Button type="button" variant="outline" onClick={() => void onCheckpointSandbox()} disabled={sandboxBusy}>
                  快照
                </Button>
                <Button type="button" variant="outline" onClick={() => void onStopSandbox()} disabled={sandboxBusy}>
                  停止
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void onResetSandbox()}
                  disabled={sandboxBusy}
                >
                  重置
                </Button>
                <Button type="button" variant="outline" onClick={() => void onRefreshSandbox()}>
                  刷新
                </Button>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="执行命令">
        <SettingsCard padded>
          <form onSubmit={onExecSandbox}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="sandbox-cmd">命令</FieldLabel>
                <Input
                  id="sandbox-cmd"
                  value={sandboxCmd}
                  onChange={(e) => setSandboxCmd(e.target.value)}
                  placeholder="echo hi"
                  required
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={sandboxBusy}>
                  运行
                </Button>
              </div>
              {sandboxExecOut ? <pre className="settings-status m-0">{sandboxExecOut}</pre> : null}
            </FieldGroup>
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="文件">
        <SettingsCard padded>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sandbox-path">目录路径</FieldLabel>
              <Input
                id="sandbox-path"
                value={sandboxPath}
                onChange={(e) => setSandboxPath(e.target.value)}
                placeholder="."
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void onLsSandbox()} disabled={sandboxBusy}>
                列出
              </Button>
            </div>
            {sandboxLsOut ? <pre className="settings-status m-0">{sandboxLsOut}</pre> : null}
            <Field>
              <FieldLabel htmlFor="sandbox-file-path">文件路径</FieldLabel>
              <Input
                id="sandbox-file-path"
                value={sandboxFilePath}
                onChange={(e) => setSandboxFilePath(e.target.value)}
                placeholder="hello.txt"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="sandbox-file-content">内容</FieldLabel>
              <Textarea
                id="sandbox-file-content"
                rows={3}
                value={sandboxFileContent}
                onChange={(e) => setSandboxFileContent(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => void onWriteSandboxFile()} disabled={sandboxBusy}>
                写入
              </Button>
              <Button type="button" variant="outline" onClick={() => void onReadSandboxFile()} disabled={sandboxBusy}>
                读取
              </Button>
            </div>
          </FieldGroup>
        </SettingsCard>
        {sandboxMsg ? <p className="settings-status m-0">{sandboxMsg}</p> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
