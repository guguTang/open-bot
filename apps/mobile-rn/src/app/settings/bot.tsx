import { Button, Card, Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import type { Agent, AgentSkill } from "@/api/types";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { errText } from "@/lib/errors";
import { EmptyState } from "@/components/states";
import { useCurrentBot } from "@/stores/client";
import {
  useAgentMutations,
  useAgentSkillMutations,
  useAgentSkills,
  useAgents,
  useBusy,
} from "@/queries";

/**
 * Bot 设置。对齐 Web 端 `settingsTab === "bot"`（`components/BotSettingsPanel.tsx`）：
 * 岗位资料 + 电脑模式 + 本 Bot 启用的技能。
 *
 * 「当前 Bot」是跨页共享的（和 Web 一样：聊天页和设置页说的是同一个 Bot），
 * 所以选中态放在 `stores/client.ts` 的 Zustand store 里并持久化到 MMKV ——
 * 顶部一排 Chip 选 Bot，离开页面再回来仍是上次那个。
 */

const COMPUTER_MODES = [
  {
    value: "team" as const,
    label: "team",
    desc: "账户共用文件 · 同账户下多个 Bot 共享一份工作区",
  },
  {
    value: "private" as const,
    label: "private",
    desc: "本 Bot 私有文件 · 每个 Bot 各自一份目录",
  },
];

export default function BotSettingsScreen(): JSX.Element {
  // 当前 Bot 提升到全局 store：这个选择是跨页共享的（设置页选完，
  // 聊天页也该是同一个），之前做成页内状态，一进页面就重置。
  const currentBot = useCurrentBot((s) => s.bot);
  const setCurrentBot = useCurrentBot((s) => s.setBot);
  const selectedId = currentBot?.id ?? null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [computerMode, setComputerMode] = useState<"team" | "private">("team");
  const [msg, setMsg] = useState("");

  /** 把服务端返回的 Agent 灌进表单。纯 setState，不含副作用。 */
  const fillForm = useCallback((agent: Agent) => {
    setName(agent.name || "");
    setDescription(agent.description || "");
    setSystemPrompt(agent.system_prompt || "");
    setComputerMode(agent.computer_mode === "private" ? "private" : "team");
  }, []);

  const agentsQuery = useAgents();
  const agents = agentsQuery.data ?? [];
  const agent = agents.find((a) => a.id === selectedId) ?? null;

  // 技能跟着选中的 Bot 换：没选中时这把键停用，不会白打接口。
  const skillsQuery = useAgentSkills(selectedId ?? undefined);
  const skills = skillsQuery.data ?? [];

  const { update } = useAgentMutations();
  const skillMut = useAgentSkillMutations();
  const busy = useBusy(update, skillMut.setEnabled);
  const skillsLoading = skillsQuery.isLoading;
  const skillError = skillsQuery.error ? errText(skillsQuery.error, "加载技能失败") : null;

  /**
   * 选中态兜底：还没选过、或选中的那个已经不在列表里（别处删了 / 换了账号），
   * 就退回第一个并**写回 store** —— 聊天页读的也是这份选择，不写回去两边会各说各话。
   */
  useEffect(() => {
    const list = agentsQuery.data;
    if (!list || list.length === 0) return;
    if (selectedId && list.some((a) => a.id === selectedId)) return;
    const first = list[0];
    setCurrentBot({ id: first.id, name: first.name });
  }, [agentsQuery.data, selectedId, setCurrentBot]);

  /**
   * 选中的助手（或它本身的服务端数据）变了，就把表单重灌一遍。
   *
   * 这是这一页唯一保留的 setState-in-effect 豁免：表单是本地草稿，初值只能来自
   * 服务端数据，而「什么时候该重灌」正是这个 effect 的职责 ——
   * 换成 mutation 的 onSuccess 只能覆盖「保存之后」，首屏和切换 Bot 都会是空表单。
   * 依赖的是 agent 对象本身（数据没变时引用稳定），所以打字不会触发它。
   */
  useEffect(() => {
    if (!agent) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fillForm(agent);
  }, [agent, fillForm]);

  function selectAgent(next: Agent): void {
    setCurrentBot({ id: next.id, name: next.name });
    setMsg("");
  }

  async function save(): Promise<void> {
    if (!selectedId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMsg("名称必填");
      return;
    }
    setMsg("");
    try {
      await update.mutateAsync({
        id: selectedId,
        body: {
          name: trimmed,
          description: description.trim(),
          system_prompt: systemPrompt.trim(),
          computer_mode: computerMode,
        },
      });
      setMsg("已保存岗位与电脑模式");
    } catch (err) {
      setMsg(errText(err, "保存失败"));
    }
  }

  async function toggleSkill(sk: AgentSkill, enabled: boolean): Promise<void> {
    if (!selectedId) return;
    setMsg("");
    try {
      await skillMut.setEnabled.mutateAsync({ agentId: selectedId, name: sk.name, enabled });
    } catch (err) {
      setMsg(errText(err, "更新技能失败"));
    }
  }

  // 账号级已关闭的技能不给开关：那是「技能」页管的维度，
  // 在这里摆一个拨不动的开关只会让人以为是自己关的（与 Web 同口径）。
  const visibleSkills = skills.filter((s) => s.account_enabled !== false);
  const hiddenCount = skills.length - visibleSkills.length;

  return (
    <ScreenScaffold
      title="Bot 设置"
      subtitle="岗位描述、电脑模式与启用技能"
      loading={agentsQuery.isLoading}
      error={agentsQuery.error ? errText(agentsQuery.error, "加载助手失败") : null}
      emptyOnly={agents.length === 0}
      empty={
        <EmptyState
          icon="sparkles-outline"
          title="还没有助手"
          hint="先在聊天页新建一个助手，才能在这里配置它的岗位与技能"
        />
      }
      onRetry={() => void agentsQuery.refetch()}
    >
      {agents.length > 1 ? (
        <View className="gap-2.5">
          <SectionTitle>选择 Bot</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2 pr-2">
              {agents.map((a) => (
                <Chip
                  key={a.id}
                  size="sm"
                  variant={a.id === selectedId ? "soft" : "secondary"}
                  color={a.id === selectedId ? "accent" : "default"}
                  onPress={() => selectAgent(a)}
                  accessibilityRole="button"
                  accessibilityLabel={`编辑 ${a.name}`}
                >
                  <Chip.Label>{a.name}</Chip.Label>
                </Chip>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {!agent ? (
        <EmptyState
          icon="sparkles-outline"
          title="未选择 Bot"
          hint="选择一位助手后，可在此编辑岗位描述、电脑模式与本 Bot 启用的技能"
        />
      ) : (
        <>
          <Card>
            <Card.Body className="gap-4">
              <SectionTitle>Bot · {agent.name}</SectionTitle>

              <FormField
                label="名称"
                required
                value={name}
                onChangeText={setName}
                placeholder="写作助手"
                editable={!busy}
              />
              <FormField
                label="岗位描述"
                value={description}
                onChangeText={setDescription}
                placeholder="这位助手负责什么"
                editable={!busy}
                multiline
              />
              <FormField
                label="系统提示（人设）"
                value={systemPrompt}
                onChangeText={setSystemPrompt}
                placeholder="更细的行为约束"
                editable={!busy}
                multiline
                hint="留空则使用默认人设；技能正文请到「Skills」页编辑"
              />

              <View className="gap-2">
                <SectionTitle>电脑模式</SectionTitle>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2 pr-2">
                    {COMPUTER_MODES.map((opt) => (
                      <Chip
                        key={opt.value}
                        size="sm"
                        variant={computerMode === opt.value ? "soft" : "secondary"}
                        color={computerMode === opt.value ? "accent" : "default"}
                        disabled={busy}
                        onPress={() => setComputerMode(opt.value)}
                        accessibilityRole="button"
                        accessibilityLabel={opt.desc}
                      >
                        <Chip.Label>{opt.label}</Chip.Label>
                      </Chip>
                    ))}
                  </View>
                </ScrollView>
                <Typography.Paragraph color="muted" className="text-xs">
                  {COMPUTER_MODES.find((o) => o.value === computerMode)?.desc}
                </Typography.Paragraph>
              </View>

              <Button isDisabled={busy} onPress={() => void save()}>
                <Button.Label>{busy ? "保存中…" : "保存"}</Button.Label>
              </Button>
            </Card.Body>
          </Card>

          <View className="gap-3">
            <SectionTitle>本 Bot 启用的技能</SectionTitle>
            {skillsLoading ? (
              <Typography.Paragraph color="muted">正在加载技能…</Typography.Paragraph>
            ) : skillError ? (
              // 加载失败原来只写进页面底部的 msg，但那样「暂无可用技能」和
              // 真正的失败原因会长得一模一样。这里就地显示，不再冒充空态。
              <Typography.Paragraph color="muted">{skillError}</Typography.Paragraph>
            ) : visibleSkills.length === 0 ? (
              <Typography.Paragraph color="muted">
                暂无可用技能（或尚未加载）。请先在管理端启用平台技能，并在账号侧保持可用。
              </Typography.Paragraph>
            ) : (
              <Card>
                <Card.Body className="gap-1">
                  {visibleSkills.map((s) => (
                    <SwitchRow
                      key={s.name}
                      label={s.name}
                      description={s.description}
                      value={s.enabled}
                      disabled={busy}
                      onValueChange={(next) => void toggleSkill(s, next)}
                      right={
                        s.custom ? (
                          <Chip size="sm" variant="soft" color="accent">
                            <Chip.Label>自建</Chip.Label>
                          </Chip>
                        ) : null
                      }
                    />
                  ))}
                </Card.Body>
              </Card>
            )}

            {hiddenCount > 0 ? (
              <Typography.Paragraph color="muted" className="text-xs">
                另有 {hiddenCount} 个技能已在「Skills」页账号级关闭，不可勾选。
              </Typography.Paragraph>
            ) : null}
          </View>

          {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}
        </>
      )}
    </ScreenScaffold>
  );
}
