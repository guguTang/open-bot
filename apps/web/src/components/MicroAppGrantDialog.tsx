import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { MicroAppGrantDecision } from "../api";

type Props = {
  open: boolean;
  capability: string;
  suggested?: string;
  highSensitivity?: boolean;
  onDecide: (d: MicroAppGrantDecision) => void;
  onCancel: () => void;
};

const LABELS: Record<string, string> = {
  "host.screenshot": "截取屏幕",
  "host.fs.read": "读取你选择的文件",
  "host.fs.write": "保存文件到你选择的位置",
  "host.shell.run": "在本机运行命令",
  "cloud.http": "由服务端代发网络请求",
  "chat.attach": "把结果发到当前会话",
  "ui.notify": "显示应用内通知",
};

export function MicroAppGrantDialog({
  open,
  capability,
  suggested,
  highSensitivity,
  onDecide,
  onCancel,
}: Props) {
  const label = LABELS[capability] || capability;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>授权微应用能力</DialogTitle>
          <DialogDescription>
            该工具请求：<strong>{label}</strong>
            <code className="mt-1 block text-[11px] text-[var(--muted)]">{capability}</code>
            {highSensitivity ? (
              <span className="mt-2 block text-amber-700">
                高敏感能力：默认建议「仅一次」。可改为始终允许或拒绝。
              </span>
            ) : null}
            {suggested ? (
              <span className="mt-1 block text-[11px] text-[var(--muted)]">建议：{suggested}</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button type="button" onClick={() => onDecide("allow_once")}>
            仅一次
          </Button>
          <Button type="button" variant="secondary" onClick={() => onDecide("always_allow")}>
            始终允许
          </Button>
          <Button type="button" variant="ghost" className="text-[var(--danger)]" onClick={() => onDecide("deny")}>
            拒绝
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
