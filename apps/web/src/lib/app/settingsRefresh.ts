import type { SettingsTab } from "../../types/app-ui";

export type SettingsRefreshApi = {
  refreshLLMs: () => Promise<unknown>;
  refreshAgents: () => Promise<unknown>;
  refreshSkills: () => Promise<unknown>;
  refreshCompact: () => Promise<unknown>;
  refreshMCP: () => Promise<unknown>;
  refreshRoutines: () => Promise<unknown>;
  refreshSandbox: () => Promise<unknown>;
  refreshMachines: () => Promise<unknown>;
  refreshSecrets: () => Promise<unknown>;
  refreshToolAllowlist: () => Promise<unknown> | void;
};

export type SettingsRefreshErrors = {
  onLLMError: (message: string) => void;
  onSkillsError: (message: string) => void;
  onMcpError: (message: string) => void;
  onRoutinesError: (message: string) => void;
  onSandboxError: (message: string) => void;
  onMachinesError: (message: string) => void;
};

/** Tab-scoped refresh — parallel within tab, no cross-tab waterfall. */
export async function refreshSettingsForTab(
  tab: SettingsTab,
  api: SettingsRefreshApi,
  errors: SettingsRefreshErrors,
): Promise<void> {
  const run = async (fn: () => Promise<unknown>, onErr?: (msg: string) => void) => {
    try {
      await fn();
    } catch (err) {
      onErr?.(err instanceof Error ? err.message : String(err));
    }
  };

  switch (tab) {
    case "general":
      return;
    case "review":
      await run(() => Promise.resolve(api.refreshToolAllowlist()));
      return;
    case "bot":
      await run(() => api.refreshAgents());
      return;
    case "llm":
      await run(() => api.refreshLLMs(), errors.onLLMError);
      return;
    case "skills":
      await run(() => api.refreshSkills(), errors.onSkillsError);
      return;
    case "mcp":
      await run(() => api.refreshMCP(), errors.onMcpError);
      return;
    case "compact":
      await run(() => api.refreshCompact());
      return;
    case "routines":
      await run(() => api.refreshRoutines(), errors.onRoutinesError);
      return;
    case "sandbox":
      await run(() => api.refreshSandbox(), errors.onSandboxError);
      return;
    case "machines":
      await run(() => api.refreshMachines(), errors.onMachinesError);
      return;
    case "secrets":
      await run(() => api.refreshSecrets());
      return;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

/** Deep link / desktop nav: only the opened tab (+ bot/llm often paired). */
export function tabsToPrefetchOnOpen(tab: SettingsTab): SettingsTab[] {
  if (tab === "bot") return ["bot"];
  return [tab];
}
