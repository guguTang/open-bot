import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GrantPromptResult } from "../lib/microApp/hostBridge";
import { MicroAppGrantDecisionPanel } from "./MicroAppGrantDecisionPanel";

type Props = {
  open: boolean;
  capability: string;
  suggested?: string;
  highSensitivity?: boolean;
  /** host.shell.run: exact command requested by the micro-app. */
  command?: string;
  /** host.shell.run: default allowlist prefix for 「始终允许」. */
  suggestedPrefix?: string;
  /** An always_allow grant exists but didn't cover this command. */
  overridingAlwaysAllow?: boolean;
  reason?: string;
  onDecide: (r: GrantPromptResult) => void;
  onCancel: () => void;
};

/**
 * iframe Host Bridge grant modal — same three-state UX as chat MicroAppGrantConfirmCard
 * (shared MicroAppGrantDecisionPanel). Decision API for iframe remains putMicroAppGrant;
 * chat path uses /v1/.../micro-app-grants/.../decide (+ park resolve).
 */
export function MicroAppGrantDialog({
  open,
  capability,
  suggested,
  highSensitivity,
  command,
  suggestedPrefix,
  overridingAlwaysAllow,
  reason,
  onDecide,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>授权微应用能力</DialogTitle>
        </DialogHeader>
        <MicroAppGrantDecisionPanel
          variant="dialog"
          capability={capability}
          command={command}
          reason={reason}
          highSensitivity={highSensitivity}
          suggested={suggested}
          suggestedPrefix={suggestedPrefix}
          overridingAlwaysAllow={overridingAlwaysAllow}
          pending
          status="pending"
          onDecide={onDecide}
        />
      </DialogContent>
    </Dialog>
  );
}
