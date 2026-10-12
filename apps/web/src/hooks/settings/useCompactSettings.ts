import { useCallback, useState } from "react";
import { CompactConfig, fetchCompactConfig } from "../../api";

export function useCompactSettings() {
  const [compactCfg, setCompactCfg] = useState<CompactConfig | null>(null);

  const refreshCompact = useCallback(async () => {
    const cfg = await fetchCompactConfig();
    setCompactCfg(cfg);
  }, []);

  return {
    compactCfg,
    refreshCompact,
  };
}
