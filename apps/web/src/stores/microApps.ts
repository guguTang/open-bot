/**
 * Account-level 「我的工具」 list. Refreshed on WS micro_apps_changed.
 */
import { create } from "zustand";
import { listMicroApps, type MicroApp } from "../api";

type MicroAppsStore = {
  apps: MicroApp[];
  loading: boolean;
  error: string;
  hubOpen: boolean;
  openAppId: string | null;
  setHubOpen: (open: boolean) => void;
  setOpenAppId: (id: string | null) => void;
  refresh: (opts?: { surface?: string }) => Promise<MicroApp[]>;
  reset: () => void;
};

export const useMicroAppsStore = create<MicroAppsStore>()((set) => ({
  apps: [],
  loading: false,
  error: "",
  hubOpen: false,
  openAppId: null,
  setHubOpen: (hubOpen) => set({ hubOpen, openAppId: hubOpen ? null : null }),
  setOpenAppId: (openAppId) => set({ openAppId }),
  refresh: async (opts) => {
    set({ loading: true, error: "" });
    try {
      // No surface → include drafts (pin confirm) + pinned; exclude archived server-side.
      // Pass surface: "hub" when only placement-filtered hub entries are needed.
      const apps = await listMicroApps(
        opts?.surface ? { surface: opts.surface as "hub" } : undefined,
      );
      set({ apps, loading: false });
      return apps;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ loading: false, error: msg });
      return [];
    }
  },
  reset: () => set({ apps: [], loading: false, error: "", hubOpen: false, openAppId: null }),
}));

export function refreshMicroAppsFromWS() {
  void useMicroAppsStore.getState().refresh().catch(() => {});
}
