import { FormEvent, useCallback, useState } from "react";
import {
  createInboundHook,
  createRoutine,
  deleteInboundHook,
  deleteRoutine,
  listInboundHooks,
  listRoutines,
  runRoutine,
  Routine,
  RoutineInput,
  updateRoutine,
  type InboundHook,
} from "../../api";

type ConfirmFn = (opts: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}) => Promise<boolean>;

type UseRoutinesSettingsOptions = {
  agentId: string;
  conversationId: string | undefined;
  confirm: ConfirmFn;
};

export function useRoutinesSettings({ agentId, conversationId, confirm }: UseRoutinesSettingsOptions) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [routinesMsg, setRoutinesMsg] = useState("");
  const [routinesBusy, setRoutinesBusy] = useState(false);
  const [inboundHooks, setInboundHooks] = useState<InboundHook[]>([]);
  const [hooksMsg, setHooksMsg] = useState("");
  const [routineForm, setRoutineForm] = useState<RoutineInput>({
    name: "",
    prompt: "",
    schedule_cron: "0 9 * * *",
    enabled: true,
    agent_id: "",
    timezone: "Asia/Shanghai",
    triggers_json: "[]",
    max_retries: 2,
    quiet_unchanged: false,
  });

  const refreshRoutines = useCallback(async () => {
    const list = await listRoutines();
    setRoutines(list);
    try {
      const hooks = await listInboundHooks();
      setInboundHooks(hooks);
    } catch {
      /* hooks optional */
    }
  }, []);

  const saveRoutine = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setRoutinesBusy(true);
      setRoutinesMsg("");
      try {
        await createRoutine({
          name: routineForm.name.trim(),
          prompt: routineForm.prompt.trim(),
          schedule_cron: routineForm.schedule_cron.trim(),
          enabled: routineForm.enabled !== false,
          agent_id: routineForm.agent_id || agentId || undefined,
          timezone: routineForm.timezone || "Asia/Shanghai",
          triggers_json: routineForm.triggers_json || "[]",
          max_retries: routineForm.max_retries ?? 2,
          quiet_unchanged: !!routineForm.quiet_unchanged,
          conversation_id: conversationId || undefined,
        });
        setRoutineForm({
          name: "",
          prompt: "",
          schedule_cron: "0 9 * * *",
          enabled: true,
          agent_id: agentId || "",
          timezone: "Asia/Shanghai",
          triggers_json: "[]",
          max_retries: 2,
          quiet_unchanged: false,
        });
        await refreshRoutines();
        setRoutinesMsg("已创建");
      } catch (err) {
        setRoutinesMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setRoutinesBusy(false);
      }
    },
    [routineForm, agentId, conversationId, refreshRoutines],
  );

  const toggleRoutine = useCallback(
    async (r: Routine, enabled: boolean) => {
      setRoutinesBusy(true);
      setRoutinesMsg("");
      try {
        await updateRoutine(r.id, { enabled });
        await refreshRoutines();
      } catch (err) {
        setRoutinesMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setRoutinesBusy(false);
      }
    },
    [refreshRoutines],
  );

  const removeRoutine = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "删除该例行任务？",
        confirmLabel: "删除",
        cancelLabel: "取消",
        danger: true,
      });
      if (!ok) return;
      setRoutinesBusy(true);
      setRoutinesMsg("");
      try {
        await deleteRoutine(id);
        await refreshRoutines();
      } catch (err) {
        setRoutinesMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setRoutinesBusy(false);
      }
    },
    [confirm, refreshRoutines],
  );

  const runRoutineNow = useCallback(
    async (id: string) => {
      setRoutinesBusy(true);
      setRoutinesMsg("运行中…");
      try {
        const res = await runRoutine(id);
        await refreshRoutines();
        setRoutinesMsg(`运行完成：${res.run.status}`);
      } catch (err) {
        setRoutinesMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setRoutinesBusy(false);
      }
    },
    [refreshRoutines],
  );

  const deleteInboundHookEntry = useCallback(
    async (id: string) => {
      await deleteInboundHook(id);
      await refreshRoutines();
    },
    [refreshRoutines],
  );

  const createInboundHookEntry = useCallback(async () => {
    setHooksMsg("");
    await createInboundHook({ provider: "any", label: "默认入站" });
    await refreshRoutines();
    setHooksMsg("已创建 Hook");
  }, [refreshRoutines]);

  return {
    routines,
    routinesMsg,
    setRoutinesMsg,
    routinesBusy,
    inboundHooks,
    hooksMsg,
    setHooksMsg,
    routineForm,
    setRoutineForm,
    refreshRoutines,
    saveRoutine,
    toggleRoutine,
    removeRoutine,
    runRoutineNow,
    deleteInboundHookEntry,
    createInboundHookEntry,
  };
}
