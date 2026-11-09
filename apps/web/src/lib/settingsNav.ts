import type { SettingsTab } from "../types/app-ui";
import type { SettingsHubNav } from "../components/MobileSettingsHub";
import type { SettingsGeneralPane } from "../stores/shell";

export type SettingsNavTarget = {
  tab: SettingsTab;
  generalPane?: SettingsGeneralPane;
  /** Tab to prefetch (usually same as tab; account/server prefetch general). */
  prefetch: SettingsTab;
  /** Opens the shared connect-apps shell instead of a settings page. */
  opensConnectApps?: boolean;
};

/**
 * Single settings routing model: hub row → tab / general pane / prefetch.
 */
export function resolveSettingsHubNav(hub: SettingsHubNav): SettingsNavTarget {
  if (hub === "account") {
    return { tab: "general", generalPane: "account", prefetch: "general" };
  }
  if (hub === "server") {
    return { tab: "general", generalPane: "server", prefetch: "general" };
  }
  if (hub === "review") {
    return { tab: "review", prefetch: "review" };
  }
  if (hub === "general") {
    return { tab: "general", generalPane: "review", prefetch: "general" };
  }
  if (hub === "integrations") {
    return { tab: "integrations", prefetch: "integrations", opensConnectApps: true };
  }
  return { tab: hub, prefetch: hub };
}
