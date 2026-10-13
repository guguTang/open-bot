import { useCallback, useState } from "react";
import { CompactConfig, fetchCompactConfig } from "../../api";

export function useCompactSettings() {
  const [compactCfg, setCompactCfg] = useState<CompactConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const refreshCompact = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const cfg = await fetchCompactConfig();
      setCompactCfg(cfg);
    } catch (e) {
      setCompactCfg(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    compactCfg,
    loading,
    loadError,
    refreshCompact,
  };
}
