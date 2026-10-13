/**
 * Host exec: review policy (in-process) + session adapter (WS / Tauri).
 * Prefer importing from `./hostExecReview` or `./hostExecSession` when the seam matters.
 */
export type { HostExecRequest } from "./hostExecTypes";
export {
  HOST_WRITES_KEY,
  HOST_SHELL_READONLY_AUTO_KEY,
  hostWritesEnabled,
  setHostWritesEnabled,
  hostShellReadonlyAutoEnabled,
  setHostShellReadonlyAutoEnabled,
  hostShellAutoEligible,
  type HostExecReviewTier,
  type HostExecReview,
  setHostExecUserSettings,
  getHostExecUserSettings,
  setHostExecMachinePolicy,
  getHostExecMachinePolicy,
  applyUserAutoReview,
  classifyHostExecReviewForUser,
  classifyHostExecReviewForMachine,
  classifyHostExecReview,
} from "./hostExecReview";
export { startHostExecSession } from "./hostExecSession";
