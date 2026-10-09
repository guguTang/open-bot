import { Button, Dialog, Spinner, Typography } from "heroui-native";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import * as api from "@/api";
import type { Agent, AgentInput, Machine } from "@/api/types";
import { FormField, SectionTitle } from "@/components/FormField";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AVATAR_COLOR_PALETTE, AVATAR_SHAPES, type AvatarShape } from "@/lib/avatar";

const DEFAULT_PROMPT = "你是一个乐于助人的 AI 助手，默认使用中文回答。";

type Props = {
  /** 传入表示编辑，不传表示新建 */
  agent?: Agent | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

/**
 * 新建 / 编辑助手。Web 端把这两件事塞在同一套表单状态里，
 * 这里用 `agent` 是否存在来区分。
 *
 * 表单状态放在内层 `AgentForm`，外层用 `key` 强制重挂载 ——
 * 比在 effect 里逐个 setState 重置更干净，也避免了「打开瞬间闪现旧值」。
 */
export function AgentEditor({ agent, open, onClose, onSaved }: Props): JSX.Element {
  return (
    <Dialog isOpen={open} onOpenChange={(next: boolean) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay isCloseOnPress>
          <Dialog.Content>
            <Dialog.Title>{agent ? "编辑助手" : "新建助手"}</Dialog.Title>

            {open ? (
              <AgentForm
                key={agent?.id ?? "new"}
                agent={agent}
                onClose={onClose}
                onSaved={onSaved}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}

function AgentForm({
  agent,
  onClose,
  onSaved,
}: {
  agent?: Agent | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}): JSX.Element {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.system_prompt ?? "");
  const [shape, setShape] = useState<AvatarShape | null>(
    agent?.avatar_shape && agent.avatar_shape.trim() ? (agent.avatar_shape as AvatarShape) : null
  );
  const [color, setColor] = useState<string | null>(agent?.avatar_color ?? null);
  const [machineId, setMachineId] = useState(agent?.machine_id ?? "");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 优先电脑的可选项来自本账号已登记的机器；拉不到就退化成「不指定」，不该挡住保存。
  useEffect(() => {
    let cancelled = false;
    void api
      .listMachines()
      .then((list) => {
        if (!cancelled) setMachines(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写名称");
      return;
    }
    setBusy(true);
    setError(null);
    const body: AgentInput = {
      name: trimmedName,
      description: description.trim(),
      system_prompt: systemPrompt.trim() || DEFAULT_PROMPT,
      ...(shape ? { avatar_shape: shape } : {}),
      ...(color ? { avatar_color: color } : {}),
      // 传空串表示解除绑定，后端按 PATCH 语义处理
      machine_id: machineId,
    };
    try {
      if (agent) {
        await api.updateAgent(agent.id, body);
      } else {
        await api.createAgent(body);
      }
      onClose();
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : agent ? "保存失败" : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  const previewName = name.trim() || "新助手";

  return (
    <>
      <ScrollView className="mt-3 max-h-96" keyboardShouldPersistTaps="handled">
        <View className="gap-4">
          <FormField
            label="名称"
            value={name}
            onChangeText={setName}
            placeholder="写作助手"
            error={error}
            required
          />
          <FormField
            label="简介"
            value={description}
            onChangeText={setDescription}
            placeholder="擅长润色与结构化"
          />
          <FormField
            label="系统提示词"
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            placeholder={DEFAULT_PROMPT}
            multiline
            hint="留空则使用默认人设"
          />

          <View className="gap-2.5">
            <SectionTitle>形象</SectionTitle>
            <View className="flex-row items-center gap-3">
              <AgentAvatar
                id={agent?.id}
                name={previewName}
                size={48}
                shape={shape}
                color={color}
              />
              <Typography.Paragraph color="muted" className="flex-1 text-xs">
                选一个剪影和主色，桌面和手机上会显示成同一个样子。
              </Typography.Paragraph>
            </View>

            <View className="flex-row flex-wrap gap-2">
              {AVATAR_SHAPES.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => setShape((prev) => (prev === s ? null : s))}
                  accessibilityRole="button"
                  accessibilityLabel={`形状 ${s}`}
                  accessibilityState={{ selected: shape === s }}
                  className={
                    shape === s
                      ? "rounded-2xl border-2 border-accent bg-accent/10 p-1.5"
                      : "rounded-2xl border border-border bg-surface p-1.5"
                  }
                >
                  <AgentAvatar name={previewName} size={28} shape={s} color={color} />
                </Pressable>
              ))}
            </View>

            <View className="flex-row flex-wrap gap-2">
              {AVATAR_COLOR_PALETTE.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor((prev) => (prev === c ? null : c))}
                  accessibilityRole="button"
                  accessibilityLabel={`主色 ${c}`}
                  accessibilityState={{ selected: color === c }}
                  className={
                    color === c
                      ? "h-8 w-8 rounded-full border-2 border-accent"
                      : "h-8 w-8 rounded-full border border-border"
                  }
                  style={{ backgroundColor: c }}
                />
              ))}
            </View>
          </View>

          <View className="gap-2.5">
            <SectionTitle>优先电脑</SectionTitle>
            {machines.length === 0 ? (
              <Typography.Paragraph color="muted" className="text-xs">
                还没有登记过电脑。可在「设置 → 电脑」登记后再来选。
              </Typography.Paragraph>
            ) : (
              <View className="gap-2">
                <MachineOption
                  label="不指定（用会话所在设备）"
                  selected={machineId === ""}
                  onPress={() => setMachineId("")}
                />
                {machines.map((m) => (
                  <MachineOption
                    key={m.id}
                    label={`${m.label} · ${m.platform} · ${m.status === "online" ? "在线" : "离线"}`}
                    selected={machineId === m.id}
                    onPress={() => setMachineId(m.id)}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <View className="mt-4 flex-row justify-end gap-3">
        <Button size="sm" variant="secondary" onPress={onClose}>
          <Button.Label>取消</Button.Label>
        </Button>
        <Button size="sm" isDisabled={busy} onPress={() => void submit()}>
          {busy ? <Spinner size="sm" /> : null}
          <Button.Label>{agent ? "保存" : "创建"}</Button.Label>
        </Button>
      </View>
    </>
  );
}

function MachineOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      className={
        selected
          ? "flex-row items-center gap-2 rounded-2xl border-2 border-accent bg-accent/10 px-3 py-2.5"
          : "flex-row items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2.5"
      }
    >
      <Typography.Paragraph className="flex-1 text-sm">{label}</Typography.Paragraph>
      {selected ? <Typography.Paragraph className="text-sm">✓</Typography.Paragraph> : null}
    </Pressable>
  );
}
