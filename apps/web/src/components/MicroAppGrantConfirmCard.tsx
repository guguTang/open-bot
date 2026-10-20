import type { MicroAppGrantDecisionResult } from "./MicroAppGrantDecisionPanel";
import { MicroAppGrantDecisionPanel } from "./MicroAppGrantDecisionPanel";
import type { MicroAppGrantPromptPayload } from "./microAppGrantModel";

export type MicroAppGrantCardDecision = MicroAppGrantDecisionResult;

/**
 * Chat-inline approval card for model-path grant_required.
 * Shares three-state UX with iframe MicroAppGrantDialog via MicroAppGrantDecisionPanel.
 */
export function MicroAppGrantConfirmCard({
  item,
  onDecide,
}: {
  item: MicroAppGrantPromptPayload;
  onDecide?: (d: MicroAppGrantCardDecision) => void;
}) {
  return (
    <div
      className="host-confirm-card"
      role="region"
      aria-label="微应用需要授权"
      data-capability={item.capability}
    >
      <MicroAppGrantDecisionPanel
        variant="card"
        capability={item.capability}
        command={item.command}
        reason={item.reason}
        highSensitivity={item.high_sensitivity}
        suggested={item.suggested_decision}
        suggestedPrefix={item.suggested_prefix}
        pending={item.status === "pending"}
        status={item.status}
        onDecide={onDecide}
      />
    </div>
  );
}
