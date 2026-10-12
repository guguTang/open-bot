import { useCallback, useEffect, useState } from "react";
import {
  deleteMachine,
  listMachines,
  registerMachine,
  updateMachine,
  type Machine,
} from "../../api";
import {
  detectClientContext,
  getStoredMachineId,
  isLoginOnlyMachine,
  resolveClientDeviceType,
  resolveDefaultMachineLabel,
  resolveMachineKey,
  setStoredMachineId,
  clearStoredMachineId,
} from "../../lib/clientEnv";
import { setHostWritesEnabled } from "../../lib/hostExec";
import type { MachineExecPolicy } from "../../lib/userSettings";

type ClientEnv = ReturnType<typeof detectClientContext>;

type UseMachinesSettingsHost = {
  clientEnv: ClientEnv;
  hostMachineId: string | null;
  setHostMachineId: (id: string | null) => void;
  setHostExecPolicy: (policy: MachineExecPolicy) => void;
  setHostExecMachinePolicy: (policy: MachineExecPolicy) => void;
  setHostWritesOn: (on: boolean) => void;
};

export function useMachinesSettings(host: UseMachinesSettingsHost) {
  const { clientEnv, hostMachineId, setHostMachineId, setHostExecPolicy, setHostExecMachinePolicy, setHostWritesOn } =
    host;

  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesMsg, setMachinesMsg] = useState("");
  const [machinesBusy, setMachinesBusy] = useState(false);
  const [deviceDisplayName, setDeviceDisplayName] = useState("");
  const [renamingMachineId, setRenamingMachineId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [currentMachineDraft, setCurrentMachineDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    void resolveDefaultMachineLabel(clientEnv).then((name) => {
      if (!cancelled) setDeviceDisplayName(name);
    });
    return () => {
      cancelled = true;
    };
  }, [clientEnv]);

  const refreshMachines = useCallback(async () => {
    const list = await listMachines();
    setMachines(list);
  }, []);

  const onRefreshMachines = useCallback(() => {
    void refreshMachines()
      .then(() => setMachinesMsg("已刷新"))
      .catch((err) => setMachinesMsg(err instanceof Error ? err.message : String(err)));
  }, [refreshMachines]);

  const onReregisterHost = useCallback(() => {
    setMachinesBusy(true);
    void (async () => {
      const label =
        currentMachineDraft.trim() ||
        deviceDisplayName.trim() ||
        (await resolveDefaultMachineLabel(clientEnv));
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
      setStoredMachineId(m.id);
      setHostMachineId(m.id);
      setCurrentMachineDraft(m.label);
      setMachinesMsg(`已注册：${m.label}`);
      await refreshMachines();
    })()
      .catch((err) => setMachinesMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setMachinesBusy(false));
  }, [clientEnv, currentMachineDraft, deviceDisplayName, refreshMachines, setHostMachineId]);

  const onSaveCurrentMachineName = useCallback(() => {
    const current = hostMachineId ? machines.find((x) => x.id === hostMachineId) : null;
    if (!current) return;
    const name = currentMachineDraft.trim();
    if (!name) return;
    setMachinesBusy(true);
    void updateMachine(current.id, { label: name })
      .then((updated) => {
        setMachinesMsg(`已保存为 ${updated.label}`);
        setDeviceDisplayName(updated.label);
        setCurrentMachineDraft(updated.label);
        return refreshMachines();
      })
      .catch((err) => setMachinesMsg(err instanceof Error ? err.message : String(err)))
      .finally(() => setMachinesBusy(false));
  }, [hostMachineId, machines, currentMachineDraft, refreshMachines]);

  const onHostExecPolicyChange = useCallback(
    (policy: MachineExecPolicy) => {
      const current = hostMachineId ? machines.find((x) => x.id === hostMachineId) : null;
      if (!current) return;
      setHostExecPolicy(policy);
      setHostExecMachinePolicy(policy);
      setHostWritesEnabled(policy !== "deny");
      setHostWritesOn(policy !== "deny");
      setMachinesBusy(true);
      void updateMachine(current.id, { exec_policy: policy })
        .then(() => {
          setMachinesMsg(
            policy === "allow"
              ? "已设为始终允许（不弹确认卡；硬拒绝仍失败）"
              : policy === "ask"
                ? "已设为每次询问"
                : "已设为不允许在这台电脑执行",
          );
          return refreshMachines();
        })
        .catch((err) => setMachinesMsg(err instanceof Error ? err.message : String(err)))
        .finally(() => setMachinesBusy(false));
    },
    [hostMachineId, machines, refreshMachines, setHostExecMachinePolicy, setHostExecPolicy, setHostWritesOn],
  );

  const onStartRename = useCallback((machineId: string, currentLabel: string) => {
    setRenamingMachineId(machineId);
    setRenameDraft(currentLabel);
  }, []);

  const onCancelRename = useCallback(() => setRenamingMachineId(null), []);

  const onSaveRename = useCallback(
    (machineId: string) => {
      const name = renameDraft.trim();
      if (!name) return;
      setMachinesBusy(true);
      void updateMachine(machineId, { label: name })
        .then((updated) => {
          setMachinesMsg(`已重命名为 ${updated.label}`);
          setRenamingMachineId(null);
          if (getStoredMachineId() === machineId) {
            setDeviceDisplayName(updated.label);
            setCurrentMachineDraft(updated.label);
          }
          return refreshMachines();
        })
        .catch((err) => setMachinesMsg(err instanceof Error ? err.message : String(err)))
        .finally(() => setMachinesBusy(false));
    },
    [renameDraft, refreshMachines],
  );

  const onDeleteMachine = useCallback(
    (m: Machine) => {
      setMachinesBusy(true);
      void deleteMachine(m.id)
        .then(() => {
          if (getStoredMachineId() === m.id) clearStoredMachineId();
          if (renamingMachineId === m.id) setRenamingMachineId(null);
          setMachinesMsg(
            isLoginOnlyMachine(m) ? `已移除 ${m.label}` : `已删除 ${m.label}`,
          );
          return refreshMachines();
        })
        .catch((err) => setMachinesMsg(err instanceof Error ? err.message : String(err)))
        .finally(() => setMachinesBusy(false));
    },
    [refreshMachines, renamingMachineId],
  );

  return {
    machines,
    setMachines,
    machinesMsg,
    setMachinesMsg,
    machinesBusy,
    deviceDisplayName,
    setDeviceDisplayName,
    renamingMachineId,
    renameDraft,
    setRenameDraft,
    currentMachineDraft,
    setCurrentMachineDraft,
    refreshMachines,
    onRefreshMachines,
    onReregisterHost,
    onSaveCurrentMachineName,
    onHostExecPolicyChange,
    onStartRename,
    onCancelRename,
    onSaveRename,
    onDeleteMachine,
  };
}
