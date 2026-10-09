import { Button, Chip, ListGroup, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { View } from "react-native";

import {
  defaultMachineLabel,
  detectClientContext,
  getOrCreateMachineKey,
  shouldRegisterAsHost,
} from "@/api/client";
import type { Machine } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { EmptyState } from "@/components/states";
import { formatRelativeTime } from "@/lib/format";
import { useBusy, useMachines, useMachineMutations, useStoredMachineId } from "@/queries";

/**
 * 已登记的电脑。对齐 Web 端 `settingsTab === "machines"`：
 * 当前设备（名称 + 执行策略）+ 已注册列表（重命名 / 心跳 / 移除）。
 *
 * RN 与 Web 的差别只在「本机登记」这一块：Web 端在登录后自动登记并定时心跳，
 * RN 端由 App 侧在同一台设备上操作，所以这里给出手动触发入口，
 * 语义与 Web 的自动流程完全一致（machine_key 取自 SecureStore，重复登记幂等）。
 *
 * 另一处结构差异是刻意的：Web 的「当前电脑」卡只在自己就是电脑（桌面壳）时才渲染
 * 策略控件，手机 / 浏览器会整块替换成一句「不能作为执行通道」。
 * RN 端这台设备**永远**是手机（`shouldRegisterAsHost` 只对 ios/android 为真，
 * 而 Expo web 走浏览器分支不登记），所以直接照抄 Web 会得到一个永远空着的卡。
 * 这里改成：始终展示本机信息，但**策略只在 host 设备上给可切换控件**，
 * 仅登录设备如实显示已存策略并说明它不生效 —— 不给一个拨了也没用的开关。
 */

const client = detectClientContext();
/** 只有原生 App 才登记为「电脑」；Expo Web 本质是浏览器，不该占一个设备名额。 */
const AUTO_REGISTER = shouldRegisterAsHost(client);

/** 与 Web 端 `MACHINE_EXEC_POLICY_OPTIONS` 保持一致。 */
const EXEC_POLICIES = [
  { value: "allow", label: "始终允许" },
  { value: "ask", label: "每次询问" },
  { value: "deny", label: "不允许" },
] as const;

/**
 * 是否「仅登录」设备。口径与 Web 端 `isLoginOnlyMachine` 一致：
 * 优先看服务端下发的 device_type，字段缺失时按 platform/app 兜底推断。
 */
function isLoginOnly(m: Machine): boolean {
  const dt = (m.device_type || "").toLowerCase();
  if (dt === "mobile") return true;
  if (dt === "desktop" || dt === "browser") return false;
  const plat = (m.platform || "").toLowerCase();
  if (plat === "ios" || plat === "android") return true;
  return (m.app || "").toLowerCase() === "capacitor";
}

function normalizePolicy(v?: string | null): "allow" | "ask" | "deny" {
  const s = (v || "").trim().toLowerCase();
  if (s === "ask") return "ask";
  if (s === "deny") return "deny";
  return "allow";
}

function policyLabel(v?: string | null): string {
  const p = normalizePolicy(v);
  return EXEC_POLICIES.find((o) => o.value === p)?.label ?? "始终允许";
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function MachinesScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [msg, setMsg] = useState("");
  /** 本机名称草稿（`null` = 不在编辑态） */
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  /** 列表里正在重命名的机器 id */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // 列表是服务端状态；本机 id 存在本机（SecureStore）而不是服务端，
  // 但同样走查询层：登记 / 移除之后可以直接改缓存，不必等一次重取。
  const machinesQuery = useMachines();
  const selfIdQuery = useStoredMachineId();
  const { register, heartbeat, update, remove } = useMachineMutations();
  const busy = useBusy(register, heartbeat, update, remove);
  const machines = machinesQuery.data ?? [];
  const selfId = selfIdQuery.data ?? null;
  const loadError = machinesQuery.error ?? selfIdQuery.error;

  const refresh = () => {
    void machinesQuery.refetch();
  };

  async function registerSelf(): Promise<void> {
    setMsg("");
    try {
      const m = await register.mutateAsync({
        machine_key: await getOrCreateMachineKey(),
        label: defaultMachineLabel(client),
        platform: client.platform,
        os: client.os,
        arch: client.arch,
        app: client.app,
        app_version: client.app_version,
      });
      setMsg(`已登记本机：${m.label}`);
    } catch (err) {
      setMsg(errText(err, "登记本机失败"));
    }
  }

  async function sendHeartbeat(machine: Machine): Promise<void> {
    setMsg("");
    try {
      const updated = await heartbeat.mutateAsync(machine.id);
      setMsg(`已上报心跳：${updated.label}`);
    } catch (err) {
      setMsg(errText(err, "心跳上报失败"));
    }
  }

  async function removeMachine(machine: Machine): Promise<void> {
    const ok = await confirm({
      title: "移除这台电脑？",
      message: `「${machine.label}」将从已登记列表中移除，之后助手无法再把它当作可用的电脑。`,
      confirmLabel: "移除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;

    setMsg("");
    try {
      // 删掉的正是本机时清本机缓存的逻辑放在 mutation 的 onSuccess 里（见 useMachineMutations）
      await remove.mutateAsync(machine.id);
      setMsg(`已移除 ${machine.label}`);
    } catch (err) {
      setMsg(errText(err, "移除失败"));
    }
  }

  /** 改名。列表行和「当前设备」卡共用同一个 API，只是保存后落点不同。 */
  async function rename(machine: Machine, raw: string): Promise<void> {
    const label = raw.trim();
    if (!label || label === machine.label) return;

    setMsg("");
    try {
      const updated = await update.mutateAsync({ id: machine.id, body: { label } });
      setMsg(`已重命名为 ${updated.label}`);
      setRenamingId(null);
      setLabelDraft(null);
    } catch (err) {
      setMsg(errText(err, "重命名失败"));
    }
  }

  async function setPolicy(machine: Machine, policy: string): Promise<void> {
    if (normalizePolicy(machine.exec_policy) === policy) return;

    setMsg("");
    try {
      await update.mutateAsync({ id: machine.id, body: { exec_policy: policy } });
      setMsg(
        policy === "allow"
          ? "已设为始终允许（不弹确认卡；硬拒绝仍失败）"
          : policy === "ask"
            ? "已设为每次询问"
            : "已设为不允许在这台设备执行"
      );
    } catch (err) {
      setMsg(errText(err, "更新执行策略失败"));
    }
  }

  const self = machines.find((m) => m.id === selfId) ?? null;

  return (
    <ScreenScaffold
      title="电脑"
      subtitle="已登记的本机设备"
      loading={machinesQuery.isLoading}
      error={loadError ? errText(loadError, "加载电脑列表失败") : null}
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
      {/* 这条说明必须常驻：RN 端最容易误解的就是「手机上也能让 Bot 执行命令」 */}
      <Typography.Paragraph color="muted">
        浏览器与手机都不能作为执行通道 —— 本地文件和命令只会在已连接的**电脑**上跑。 当前客户端：
        {client.platform} / {client.app}
        {AUTO_REGISTER ? "（手机，可登记为仅登录设备）" : "（浏览器，不登记）"}。
      </Typography.Paragraph>

      {self ? (
        <ListGroup>
          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>
                <View className="flex-row items-center gap-2">
                  <Typography.Paragraph weight="medium" className="flex-1">
                    {self.label}（本机）
                  </Typography.Paragraph>
                  {isLoginOnly(self) ? (
                    <Chip size="sm" variant="soft" color="warning">
                      <Chip.Label>仅登录</Chip.Label>
                    </Chip>
                  ) : null}
                  <Chip
                    size="sm"
                    variant="soft"
                    color={self.status === "online" ? "success" : "default"}
                  >
                    <Chip.Label>{self.status === "online" ? "在线" : "离线"}</Chip.Label>
                  </Chip>
                </View>
              </ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {[self.platform, self.os, self.arch, self.app, self.app_version]
                  .filter(Boolean)
                  .join(" · ")}
                {self.last_seen ? ` · 最近 ${formatRelativeTime(self.last_seen)}` : ""}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
          </ListGroup.Item>

          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>
                <View className="flex-row items-center gap-2">
                  <Typography.Paragraph weight="medium" className="flex-1">
                    本机名称
                  </Typography.Paragraph>
                  {labelDraft === null ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={busy}
                      onPress={() => setLabelDraft(self.label)}
                      accessibilityLabel="重命名本机"
                    >
                      <Button.Label>重命名</Button.Label>
                    </Button>
                  ) : null}
                </View>
              </ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                显示给 Bot 的设备名。保存后同步到下方已注册列表。
              </ListGroup.ItemDescription>
              {labelDraft !== null ? (
                <View className="gap-2 px-1 pb-1">
                  <FormField
                    label="设备名称"
                    value={labelDraft}
                    onChangeText={setLabelDraft}
                    placeholder="设备名称"
                    editable={!busy}
                  />
                  <View className="flex-row gap-2">
                    <Button
                      size="sm"
                      isDisabled={busy || !labelDraft.trim() || labelDraft.trim() === self.label}
                      onPress={() => void rename(self, labelDraft)}
                    >
                      <Button.Label>保存</Button.Label>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      onPress={() => setLabelDraft(null)}
                    >
                      <Button.Label>取消</Button.Label>
                    </Button>
                  </View>
                </View>
              ) : null}
            </ListGroup.ItemContent>
          </ListGroup.Item>

          <ListGroup.Item>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>在这台设备上执行</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {isLoginOnly(self)
                  ? `本机是仅登录设备，当前策略「${policyLabel(self.exec_policy)}」不会对助手生效 —— 助手不会在这台手机上执行任何命令。请到下方列表里给已连接的电脑设置策略。`
                  : "始终允许：除硬拒绝（curl|sh、rm -rf /、mkfs）外直接执行，不弹确认卡；用户规则「先询问」命中时仍会确认。"}
              </ListGroup.ItemDescription>
              {isLoginOnly(self) ? null : (
                <View className="mt-2 flex-row flex-wrap gap-2 px-1 pb-1">
                  {EXEC_POLICIES.map((opt) => (
                    <Chip
                      key={opt.value}
                      size="sm"
                      variant={
                        normalizePolicy(self.exec_policy) === opt.value ? "soft" : "secondary"
                      }
                      color={normalizePolicy(self.exec_policy) === opt.value ? "accent" : "default"}
                      disabled={busy}
                      onPress={() => void setPolicy(self, opt.value)}
                      accessibilityRole="button"
                      accessibilityLabel={opt.label}
                    >
                      <Chip.Label>{opt.label}</Chip.Label>
                    </Chip>
                  ))}
                </View>
              )}
            </ListGroup.ItemContent>
          </ListGroup.Item>
        </ListGroup>
      ) : null}

      <ListGroup>
        {machines.map((m) => {
          const loginOnly = isLoginOnly(m);
          const isRenaming = renamingId === m.id;
          return (
            <ListGroup.Item key={m.id}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>
                  {isRenaming ? (
                    <View className="flex-row items-center gap-2">
                      <Typography.Paragraph weight="medium" className="flex-1">
                        重命名
                      </Typography.Paragraph>
                      <Button
                        size="sm"
                        isDisabled={busy || !renameDraft.trim()}
                        onPress={() => void rename(m, renameDraft)}
                      >
                        <Button.Label>保存</Button.Label>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busy}
                        onPress={() => setRenamingId(null)}
                      >
                        <Button.Label>取消</Button.Label>
                      </Button>
                    </View>
                  ) : (
                    <View className="flex-row items-center gap-2">
                      <Typography.Paragraph weight="medium" className="flex-1">
                        {m.label}
                        {selfId === m.id ? "（本机）" : ""}
                      </Typography.Paragraph>
                      {loginOnly ? (
                        <Chip size="sm" variant="soft" color="warning">
                          <Chip.Label>仅登录</Chip.Label>
                        </Chip>
                      ) : (
                        <Chip size="sm" variant="soft" color="success">
                          <Chip.Label>可执行</Chip.Label>
                        </Chip>
                      )}
                      <Chip
                        size="sm"
                        variant="soft"
                        color={m.status === "online" ? "success" : "default"}
                      >
                        <Chip.Label>{m.status === "online" ? "在线" : "离线"}</Chip.Label>
                      </Chip>
                    </View>
                  )}
                </ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {isRenaming ? (
                    <View className="mt-1">
                      <FormField
                        label="新名称"
                        value={renameDraft}
                        onChangeText={setRenameDraft}
                        placeholder="设备名称"
                        editable={!busy}
                      />
                    </View>
                  ) : (
                    <>
                      {[m.platform, m.os, m.arch, m.app, m.app_version].filter(Boolean).join(" · ")}
                      {m.device_type ? ` · ${m.device_type}` : ""}
                      {` · 策略 ${policyLabel(m.exec_policy)}`}
                      {m.last_seen ? ` · 最近 ${formatRelativeTime(m.last_seen)}` : ""}
                    </>
                  )}
                </ListGroup.ItemDescription>

                {!isRenaming && !loginOnly ? (
                  <View className="mt-2 flex-row flex-wrap gap-2 px-1">
                    {EXEC_POLICIES.map((opt) => (
                      <Chip
                        key={opt.value}
                        size="sm"
                        variant={
                          normalizePolicy(m.exec_policy) === opt.value ? "soft" : "secondary"
                        }
                        color={normalizePolicy(m.exec_policy) === opt.value ? "accent" : "default"}
                        disabled={busy}
                        onPress={() => void setPolicy(m, opt.value)}
                        accessibilityRole="button"
                        accessibilityLabel={`${m.label} 执行策略 ${opt.label}`}
                      >
                        <Chip.Label>{opt.label}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                ) : null}
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <View className="gap-2">
                  <View className="flex-row gap-2">
                    {/* 心跳：手动上报一次可立即把设备刷成「在线」 */}
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      onPress={() => void sendHeartbeat(m)}
                    >
                      <Button.Label>心跳</Button.Label>
                    </Button>
                    {isRenaming ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busy}
                        onPress={() => {
                          setRenamingId(m.id);
                          setRenameDraft(m.label);
                        }}
                      >
                        <Button.Label>重命名</Button.Label>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="danger-soft"
                      isDisabled={busy}
                      onPress={() => void removeMachine(m)}
                    >
                      <Button.Label>移除</Button.Label>
                    </Button>
                  </View>
                </View>
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          );
        })}
      </ListGroup>

      {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}
    </ScreenScaffold>
  );
}
