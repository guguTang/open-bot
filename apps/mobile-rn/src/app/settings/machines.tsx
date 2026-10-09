import { Button, Chip, ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import {
  clearStoredMachineId,
  defaultMachineLabel,
  detectClientContext,
  getOrCreateMachineKey,
  getStoredMachineId,
  setStoredMachineId,
  shouldRegisterAsHost,
} from "@/api/client";
import type { Machine } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatRelativeTime } from "@/lib/format";

/**
 * 已登记的电脑。对齐 Web 端 `settingsTab === "machines"`：
 * 列表 + 登记本机 + 心跳 + 删除。
 *
 * RN 与 Web 的差别只在「本机登记」这一块：Web 端在登录后自动登记并定时心跳，
 * RN 端由 App 侧在同一台设备上操作，所以这里给出手动触发入口，
 * 语义与 Web 的自动流程完全一致（machine_key 取自 SecureStore，重复登记幂等）。
 */

const client = detectClientContext();
/** 只有原生 App 才登记为「电脑」；Expo Web 本质是浏览器，不该占一个设备名额。 */
const AUTO_REGISTER = shouldRegisterAsHost(client);

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function MachinesScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [machines, setMachines] = useState<Machine[]>([]);
  /** 本机在服务端记录里的 id，删除它时要把本地缓存一起清掉 */
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setMachines(await api.listMachines());
      setSelfId(await getStoredMachineId());
    } catch (err) {
      setError(errText(err, "加载电脑列表失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  async function registerSelf(): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      const m = await api.registerMachine({
        machine_key: await getOrCreateMachineKey(),
        label: defaultMachineLabel(client),
        platform: client.platform,
        os: client.os,
        arch: client.arch,
        app: client.app,
        app_version: client.app_version,
      });
      await setStoredMachineId(m.id);
      setMsg(`已登记本机：${m.label}`);
      await load();
    } catch (err) {
      setMsg(errText(err, "登记本机失败"));
    } finally {
      setBusy(false);
    }
  }

  async function heartbeat(machine: Machine): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      const updated = await api.heartbeatMachine(machine.id);
      setMsg(`已上报心跳：${updated.label}`);
      await load();
    } catch (err) {
      setMsg(errText(err, "心跳上报失败"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(machine: Machine): Promise<void> {
    const ok = await confirm({
      title: "移除这台电脑？",
      message: `「${machine.label}」将从已登记列表中移除，之后助手无法再把它当作可用的电脑。`,
      confirmLabel: "移除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    setMsg("");
    try {
      await api.deleteMachine(machine.id);
      // 删掉的正是本机时清掉本地缓存，否则下次打开还会以为自己已登记
      if (selfId === machine.id) await clearStoredMachineId();
      setMsg(`已移除 ${machine.label}`);
      await load();
    } catch (err) {
      setMsg(errText(err, "移除失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenScaffold
      title="电脑"
      subtitle="已登记的本机设备"
      loading={loading}
      error={error}
      empty={
        machines.length === 0 ? (
          <EmptyState
            icon="laptop-outline"
            title="还没有已登记的电脑"
            hint="用桌面端或手机 App 登录后会自动登记，也可以点右上角「登记本机」手动添加"
          />
        ) : undefined
      }
      onRetry={refresh}
      headerRight={
        <View className="flex-row gap-2">
          {AUTO_REGISTER ? (
            <Button size="sm" isDisabled={busy} onPress={() => void registerSelf()}>
              <Button.Label>登记本机</Button.Label>
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onPress={refresh}>
            <Button.Label>刷新</Button.Label>
          </Button>
        </View>
      }
    >
      <Typography.Paragraph color="muted">
        已登记的主机电脑（桌面 / 移动客户端登录后会自动登记并心跳）。
        网页浏览器通常不会登记为「电脑」。 当前客户端：{client.platform} / {client.app}
        {AUTO_REGISTER ? "（可登记为本机）" : "（浏览器，不登记）"}。
        本机文件读写尚未接通，这里只能查看和管理登记关系。
      </Typography.Paragraph>

      <ListGroup>
        {machines.map((m) => (
          <ListGroup.Item key={m.id}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>
                <View className="flex-row items-center gap-2">
                  <Typography.Paragraph weight="medium" className="flex-1">
                    {m.label}
                    {selfId === m.id ? "（本机）" : ""}
                  </Typography.Paragraph>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={m.status === "online" ? "success" : "default"}
                  >
                    <Chip.Label>{m.status === "online" ? "在线" : "离线"}</Chip.Label>
                  </Chip>
                </View>
              </ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {[m.platform, m.os, m.arch, m.app, m.app_version].filter(Boolean).join(" · ")}
                {m.last_seen ? ` · 最近 ${formatRelativeTime(m.last_seen)}` : ""}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              <View className="flex-row gap-2">
                {/* 心跳：手动上报一次可立即把设备刷成「在线」 */}
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={busy}
                  onPress={() => void heartbeat(m)}
                >
                  <Button.Label>心跳</Button.Label>
                </Button>
                <Button
                  size="sm"
                  variant="danger-soft"
                  isDisabled={busy}
                  onPress={() => void remove(m)}
                >
                  <Button.Label>移除</Button.Label>
                </Button>
              </View>
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        ))}
      </ListGroup>

      {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}
    </ScreenScaffold>
  );
}
