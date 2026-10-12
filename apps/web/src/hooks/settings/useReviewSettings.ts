import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { listToolAllowlist, revokeToolAllowlistEntry } from "../../api";
import {
  listToolAllowEntries,
  revokeToolFamilyAlwaysAllow,
  toolFamilyLabel,
  type ToolAllowEntry,
  type ToolFamilyId,
} from "../../lib/toolAllowlist";

export function useReviewSettings(userId: string | undefined) {
  const [toolAllowEntries, setToolAllowEntries] = useState<ToolAllowEntry[]>([]);
  const [toolAllowServerOk, setToolAllowServerOk] = useState(false);
  const [toolAllowBusy, setToolAllowBusy] = useState(false);

  const refreshToolAllowlist = useCallback(async () => {
    const uid = userId || "";
    const local = listToolAllowEntries(uid);
    try {
      const remote = await listToolAllowlist();
      if (remote.length > 0 || toolAllowServerOk) {
        setToolAllowServerOk(true);
        const mapped: ToolAllowEntry[] = remote.map((e) => ({
          family: (e.tool_group || "other") as ToolFamilyId,
          tool: e.tool || e.tool_group,
          label: e.label || toolFamilyLabel((e.tool_group || "other") as ToolFamilyId),
          granted_at: e.granted_at || new Date().toISOString(),
        }));
        const remoteFamilies = new Set(mapped.map((m) => m.family));
        const merged = [...mapped, ...local.filter((l) => !remoteFamilies.has(l.family))];
        setToolAllowEntries(merged);
        return merged;
      }
    } catch {
      /* fall through to local */
    }
    setToolAllowEntries(local);
    return local;
  }, [userId, toolAllowServerOk]);

  useEffect(() => {
    if (!userId) {
      setToolAllowEntries([]);
      return;
    }
    setToolAllowEntries(listToolAllowEntries(userId));
    void refreshToolAllowlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const onRevokeEntry = useCallback(
    (entry: ToolAllowEntry) => {
      void (async () => {
        setToolAllowBusy(true);
        try {
          const serverOk = await revokeToolAllowlistEntry({
            tool_group: entry.family,
          });
          if (serverOk) setToolAllowServerOk(true);
          const uid = userId || "";
          setToolAllowEntries(revokeToolFamilyAlwaysAllow(uid, entry.family));
          toast.message("已撤销，下次将再次询问");
        } finally {
          setToolAllowBusy(false);
        }
      })();
    },
    [userId],
  );

  return {
    toolAllowEntries,
    setToolAllowEntries,
    toolAllowServerOk,
    toolAllowBusy,
    refreshToolAllowlist,
    onRevokeEntry,
  };
}
