/**
 * 「复制助手」。对齐 Web `CloneAgentModal`：人设与 Skills 总是复制；
 * Bot 记忆默认勾选，例行任务可选。
 */

import { Button, Card, Input, Label, TextField, Typography } from "heroui-native";
import type { JSX } from "react";
import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { cloneAgent } from "@/api";
import type { Agent, CloneAgentResult } from "@/api/types";
import { SwitchRow } from "@/components/FormField";
import { errText } from "@/lib/errors";

type Props = {
  agent: Agent | null;
  visible: boolean;
  onClose: () => void;
  onCloned: (result: CloneAgentResult) => void;
};

export function CloneAgentSheet({ agent, visible, onClose, onCloned }: Props): JSX.Element | null {
  if (!agent) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <CloneForm key={agent.id} agent={agent} onClose={onClose} onCloned={onCloned} />
    </Modal>
  );
}

function CloneForm({
  agent,
  onClose,
  onCloned,
}: {
  agent: Agent;
  onClose: () => void;
  onCloned: (result: CloneAgentResult) => void;
}): JSX.Element {
  const [name, setName] = useState(`${agent.name} 副本`);
  const [copyMemory, setCopyMemory] = useState(true);
  const [copyRoutines, setCopyRoutines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(): Promise<void> {
    setBusy(true);
    setErr("");
    try {
      const res = await cloneAgent(agent.id, {
        name: name.trim() || undefined,
        copy_memory: copyMemory,
        copy_routines: copyRoutines,
      });
      onCloned(res);
      onClose();
    } catch (e) {
      setErr(errText(e, "复制失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 justify-end bg-black/40">
      <Pressable className="flex-1" onPress={busy ? undefined : onClose} accessibilityLabel="关闭" />
      <View className="max-h-[85%] rounded-t-3xl bg-background pb-safe-offset-8">
        <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
          <Typography.Heading type="h4">复制助手「{agent.name}」</Typography.Heading>
          <Button size="sm" variant="ghost" isDisabled={busy} onPress={onClose}>
            <Button.Label>关闭</Button.Label>
          </Button>
        </View>

        <ScrollView contentContainerClassName="gap-4 px-5 py-4" keyboardShouldPersistTaps="handled">
          <TextField>
            <Label>
              <Label.Text>新助手名称</Label.Text>
            </Label>
            <Input
              value={name}
              onChangeText={setName}
              editable={!busy}
              maxLength={80}
              autoCapitalize="none"
            />
          </TextField>

          <Card>
            <Card.Body className="gap-2">
              <Typography.Paragraph className="text-sm font-medium">会复制</Typography.Paragraph>
              <Typography.Paragraph color="muted" className="text-xs">
                岗位描述、人设（系统提示）、电脑模式、本助手的 Skills 开关
              </Typography.Paragraph>
              <SwitchRow
                label="同时复制本助手的专属记忆"
                value={copyMemory}
                onValueChange={setCopyMemory}
                disabled={busy}
              />
              <SwitchRow
                label="同时复制例行任务"
                description="复制后为暂停，需手动开启"
                value={copyRoutines}
                onValueChange={setCopyRoutines}
                disabled={busy}
              />
            </Card.Body>
          </Card>

          <Typography.Paragraph color="muted" className="text-xs">
            与原助手共享：个人记忆、技能库、模型连接、MCP、已登记的电脑。不会复制：聊天记录、群聊成员、助手密钥、private
            私有文件。
          </Typography.Paragraph>

          {err ? <Typography.Paragraph className="text-sm text-danger">{err}</Typography.Paragraph> : null}

          <View className="flex-row gap-2">
            <Button className="flex-1" variant="secondary" isDisabled={busy} onPress={onClose}>
              <Button.Label>取消</Button.Label>
            </Button>
            <Button className="flex-1" isDisabled={busy} onPress={() => void submit()}>
              <Button.Label>{busy ? "复制中…" : "复制"}</Button.Label>
            </Button>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
