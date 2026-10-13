import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { Machine } from "../api";
import { fetchUserSettings, heartbeatMachine, registerMachine } from "../api";
import {
  detectClientContext,
  getStoredMachineId,
  resolveClientDeviceType,
  resolveDefaultMachineLabel,
  resolveMachineKey,
  setStoredMachineId,
  shouldRegisterAsHost,
} from "../lib/clientEnv";
import {
  hostWritesEnabled,
  setHostExecUserSettings,
  startHostExecSession,
  type HostExecRequest,
} from "../lib/hostExec";
import { readCachedUserSettings, type MachineExecPolicy } from "../lib/userSettings";
import { patchShell } from "../stores/shell";

export type HostMachinesSyncRef = MutableRefObject<{
  machines: Machine[];
  setMachines: React.Dispatch<React.SetStateAction<Machine[]>>;
  deviceDisplayName: string;
  setCurrentMachineDraft: (name: string) => void;
}>;

export function useHostMachineState() {
  const [hostMachineId, setHostMachineId] = useState<string | null>(() => getStoredMachineId());
  const [hostWritesOn, setHostWritesOn] = useState(() => hostWritesEnabled());
  const [hostExecPolicy, setHostExecPolicy] = useState<MachineExecPolicy>("allow");
  const clientEnv = useMemo(() => detectClientContext(), []);

  return {
    clientEnv,
    hostMachineId,
    setHostMachineId,
    hostWritesOn,
    setHostWritesOn,
    hostExecPolicy,
    setHostExecPolicy,
    setHostActivity: (label: string) => patchShell({ hostActivity: label }),
  };
}

export type UseHostRegistrationParams = {
  authed: boolean;
  token: string | null;
  clientEnv: ReturnType<typeof detectClientContext>;
  machines: Machine[];
  machinesSyncRef: HostMachinesSyncRef;
  hostMachineId: string | null;
  setHostMachineId: (id: string | null) => void;
  askHostConfirmRef: MutableRefObject<(req: HostExecRequest) => Promise<boolean>>;
  hostConfirmResolvers: MutableRefObject<Map<string, (ok: boolean) => void>>;
};

/** Host registration, heartbeat, exec-policy sync, and Tauri host-exec session. */
export function useHostRegistration(params: UseHostRegistrationParams) {
  const {
    authed,
    token,
    clientEnv,
    machines,
    machinesSyncRef,
    hostMachineId,
    setHostMachineId,
    askHostConfirmRef,
    hostConfirmResolvers,
  } = params;

  useEffect(() => {
    if (!authed) return;
    const cached = readCachedUserSettings();
    setHostExecUserSettings(cached);
    void fetchUserSettings()
      .then((s) => setHostExecUserSettings(s))
      .catch(() => {});
  }, [authed]);

  useEffect(() => {
    const mid = hostMachineId;
    if (!mid) return;
    const m = machines.find((x) => x.id === mid);
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- sync settings draft when host machine record loads
    if (m?.label) machinesSyncRef.current.setCurrentMachineDraft(m.label);
  }, [hostMachineId, machines, machinesSyncRef]);

  useEffect(() => {
    if (!authed) return;
    if (!shouldRegisterAsHost(clientEnv)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      try {
        const { deviceDisplayName, setMachines } = machinesSyncRef.current;
        const label =
          deviceDisplayName.trim() || (await resolveDefaultMachineLabel(clientEnv));
        const m = await registerMachine({
          machine_key: await resolveMachineKey(clientEnv),
          label,
          platform: clientEnv.platform,
          os: clientEnv.os,
          arch: clientEnv.arch,
          app: clientEnv.app,
          app_version: clientEnv.app_version,
          device_type: resolveClientDeviceType(clientEnv),
        });
        if (cancelled) return;
        setStoredMachineId(m.id);
        setHostMachineId(m.id);
        setMachines((prev) => {
          const others = prev.filter((x) => x.id !== m.id);
          return [m, ...others];
        });
        timer = setInterval(() => {
          const id = getStoredMachineId();
          if (!id) return;
          void heartbeatMachine(id).catch(() => {
            /* ignore transient */
          });
        }, 30_000);
      } catch (err) {
        if (!cancelled) {
          console.warn("machine register failed", err);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [authed, clientEnv, machinesSyncRef, setHostMachineId]);

  useEffect(() => {
    if (!authed || !token || clientEnv.app !== "tauri" || !hostMachineId) return;
    const stop = startHostExecSession({
      token,
      machineId: hostMachineId,
      confirm: (req) => askHostConfirmRef.current(req),
    });
    const resolvers = hostConfirmResolvers.current;
    return () => {
      stop();
      for (const resolve of resolvers.values()) resolve(false);
      resolvers.clear();
    };
  }, [authed, token, clientEnv.app, hostMachineId, askHostConfirmRef, hostConfirmResolvers]);
}
