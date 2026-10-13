import { useEffect, useState } from "react";
import type { Machine } from "../api";
import { listMachines } from "../api";
import { preferHostMachines } from "../lib/machineRoster";

export type PreferHostMachinesState = {
  machines: Machine[];
  /** True after the first load attempt settles (success or failure). */
  loaded: boolean;
  error: string | null;
};

/**
 * Loads machines and keeps only host-capable entries (shared by create-bot / avatar settings).
 */
export function usePreferHostMachines(enabled: boolean): PreferHostMachinesState {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoaded(false);
    setError(null);
    void listMachines()
      .then((list) => {
        if (cancelled) return;
        setMachines(preferHostMachines(list));
        setLoaded(true);
      })
      .catch((ex) => {
        if (cancelled) return;
        setMachines([]);
        setLoaded(true);
        setError(ex instanceof Error ? ex.message : String(ex));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { machines, loaded, error };
}
