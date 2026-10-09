import { Button, Dialog, Spinner } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { Agent, AgentInput } from "@/api/types";
import { FormField } from "@/components/FormField";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <View className="mt-3 gap-4">
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
      </View>

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
