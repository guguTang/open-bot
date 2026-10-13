/**
 * 群设置 · 成员。对齐 Web `GroupMembersSettings`：列表 / 添加 / 移除。
 */

import { Button, Chip, ListGroup, Separator, Typography } from "heroui-native";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import * as api from "@/api";
import type { Agent, Channel } from "@/api/types";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useConfirm } from "@/components/ConfirmDialog";
import { errText } from "@/lib/errors";

type Props = {
  visible: boolean;
  channel: Channel | null;
  agents: Agent[];
  onClose: () => void;
  onChanged: (channel: Channel) => void;
};

export function GroupMembersSheet({
  visible,
  channel,
  agents,
  onClose,
  onChanged,
}: Props): JSX.Element | null {
  const { confirm } = useConfirm();
  const [view, setView] = useState<"list" | "add">("list");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const memberIds = channel?.members ?? [];
  const memberRows = useMemo(
    () =>
      memberIds.map((id) => {
        const a = agents.find((x) => x.id === id);
        return { id, name: a?.name ?? id, agent: a };
      }),
    [memberIds, agents]
  );
  const candidates = useMemo(
    () => agents.filter((a) => !memberIds.includes(a.id)),
    [agents, memberIds]
  );

  if (!channel) return null;

  async function add(agentId: string): Promise<void> {
    if (!channel) return;
    setBusy(true);
    setMsg("");
    try {
      const updated = await api.addChannelMember(channel.id, agentId);
      onChanged(updated);
      setView("list");
      setMsg("已添加成员");
    } catch (err) {
      setMsg(errText(err, "添加失败"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(agentId: string, name: string): Promise<void> {
    if (!channel) return;
    const ok = await confirm({
      title: "移除成员？",
      message: `确定将「${name}」移出群聊？`,
      confirmLabel: "移除",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      const updated = await api.removeChannelMember(channel.id, agentId);
      onChanged(
        updated.members ? updated : { ...channel, members: memberIds.filter((id) => id !== agentId) }
      );
      setMsg("已移除");
    } catch (err) {
      setMsg(errText(err, "移除失败（接口可能尚未就绪）"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onShow={() => {
        setView("list");
        setMsg("");
      }}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" onPress={busy ? undefined : onClose} />
        <View className="max-h-[80%] rounded-t-3xl bg-background pb-safe-offset-8">
          <View className="flex-row items-center justify-between border-b border-border px-5 py-4">
            <Typography.Heading type="h4">
              {view === "add" ? "添加成员" : `群设置 · ${channel.name}`}
            </Typography.Heading>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={busy}
              onPress={() => (view === "add" ? setView("list") : onClose())}
            >
              <Button.Label>{view === "add" ? "返回" : "关闭"}</Button.Label>
            </Button>
          </View>

          <ScrollView contentContainerClassName="gap-3 px-5 py-4">
            {view === "list" ? (
              <>
                <View className="flex-row items-center justify-between">
                  <Typography.Paragraph color="muted" className="text-sm">
                    成员（{memberRows.length}）
                  </Typography.Paragraph>
                  <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setView("add")}>
                    <Button.Label>添加成员</Button.Label>
                  </Button>
                </View>
                {memberRows.length === 0 ? (
                  <Typography.Paragraph color="muted">暂无成员</Typography.Paragraph>
                ) : (
                  <ListGroup>
                    {memberRows.map((row, index) => (
                      <View key={row.id}>
                        {index > 0 ? <Separator className="mx-4" /> : null}
                        <ListGroup.Item>
                          <ListGroup.ItemPrefix>
                            <AgentAvatar
                              id={row.id}
                              name={row.name}
                              shape={row.agent?.avatar_shape}
                              color={row.agent?.avatar_color}
                            />
                          </ListGroup.ItemPrefix>
                          <ListGroup.ItemContent>
                            <ListGroup.ItemTitle>{row.name}</ListGroup.ItemTitle>
                          </ListGroup.ItemContent>
                          <ListGroup.ItemSuffix>
                            <Button
                              size="sm"
                              variant="danger"
                              isDisabled={busy || memberRows.length <= 1}
                              onPress={() => void remove(row.id, row.name)}
                            >
                              <Button.Label>移除</Button.Label>
                            </Button>
                          </ListGroup.ItemSuffix>
                        </ListGroup.Item>
                      </View>
                    ))}
                  </ListGroup>
                )}
              </>
            ) : (
              <>
                {candidates.length === 0 ? (
                  <Typography.Paragraph color="muted">没有可添加的助手</Typography.Paragraph>
                ) : (
                  <View className="flex-row flex-wrap gap-2">
                    {candidates.map((a) => (
                      <Chip
                        key={a.id}
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onPress={() => void add(a.id)}
                      >
                        <Chip.Label>{a.name}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                )}
              </>
            )}
            {msg ? (
              <Typography.Paragraph color="muted" className="text-xs">
                {msg}
              </Typography.Paragraph>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
