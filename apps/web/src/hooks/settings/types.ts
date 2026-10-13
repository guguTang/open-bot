import type { Dispatch, SetStateAction } from "react";
import type { BotSecretRequest, Machine } from "../../api";
import type { ToolAllowEntry } from "../../lib/toolAllowlist";
import type { SettingsTab } from "../../types/app-ui";

/** Shell controls for the settings dialog — open/close/tab/prefetch only. */
export type SettingsShell = {
  show: boolean;
  setShow: Dispatch<SetStateAction<boolean>>;
  tab: SettingsTab;
  setTab: Dispatch<SetStateAction<SettingsTab>>;
  selectTab: (tab: SettingsTab) => void;
  prefetch: (tab: SettingsTab) => void;
  open: (tab?: SettingsTab) => void;
  close: () => void;
  emailCopied: boolean;
  onCopyEmail: (email: string) => void;
  secretPrompt: BotSecretRequest | null;
  /** Dismiss/open secret prompt (null dismisses; mirrors secrets tab API). */
  setSecretPrompt: (req: BotSecretRequest | null) => void;
};

/**
 * Narrow slice for chat/host paths that need review allowlist, machines list,
 * and LLM refresh — without depending on the full settings tab universe.
 */
export type ChatSettingsSlice = {
  toolAllowEntries: ToolAllowEntry[];
  setToolAllowEntries: Dispatch<SetStateAction<ToolAllowEntry[]>>;
  machines: Machine[];
  deviceDisplayName: string;
  refreshLLMs: () => Promise<unknown>;
};
