import { Button, Card, Chip, Typography } from "heroui-native";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import * as api from "@/api";
import type { Skill } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";

/**
 * Skills 管理。行为对齐 `apps/web/src/App.tsx` 的 `settingsTab === "skills"` 分区。
 *
 * 关键业务规则：`custom` 为 false 的技能来自仓库 `skills/` 目录，是随代码分发的，
 * 只能开关不能删；只有上传到 `skills/users/{user_id}/` 的自定义技能才允许删除。
 * 这个判断放在渲染层（不渲染删除按钮）和点击层（再挡一次）两处，避免以后有人
 * 复用这份列表时绕过限制。
 */

type UploadErrors = {
  name?: string;
  description?: string;
};

export default function SkillsSettingsScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [errors, setErrors] = useState<UploadErrors>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      setSkills(await api.listSkills());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggle(s: Skill, enabled: boolean): Promise<void> {
    setBusy(true);
    setMsg("");
    try {
      await api.setSkillEnabled(s.name, enabled);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Skill): Promise<void> {
    if (!s.custom) return;
    const ok = await confirm({
      title: `删除自定义技能「${s.name}」？`,
      message: "该技能的文件会一并删除，且无法恢复。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setMsg("");
    try {
      await api.deleteSkill(s.name);
      await load();
      setMsg("已删除");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function upload(): Promise<void> {
    const name = skillName.trim();
    const description = skillDesc.trim();
    const nextErrors: UploadErrors = {};
    if (!name) nextErrors.name = "名称必填";
    if (!description) nextErrors.description = "描述必填";
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.description) return;

    setBusy(true);
    setMsg("");
    try {
      await api.uploadSkill({ name, description, body_markdown: skillBody });
      // 上传成功后清空表单：正文可能很长，留着下次容易被误提交两次。
      setSkillName("");
      setSkillDesc("");
      setSkillBody("");
      await load();
      setMsg("技能已上传并默认启用");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenScaffold
      title="Skills"
      subtitle="技能启用与上传"
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      <Typography.Paragraph color="muted">
        关闭后该技能不会注入 runtime 系统提示，也无法被 load_skill
        加载。默认全部启用。可上传自定义技能 （Agent Skills：小写+数字+连字符），落盘到
        skills/users/&#123;user_id&#125;/。
      </Typography.Paragraph>

      <Card>
        <Card.Body className="gap-4">
          <SectionTitle>上传自定义 Skill</SectionTitle>

          <FormField
            label="name"
            value={skillName}
            onChangeText={setSkillName}
            placeholder="name（如 my-helper）"
            error={errors.name}
            required
          />
          <FormField
            label="description"
            value={skillDesc}
            onChangeText={setSkillDesc}
            placeholder="description（何时使用）"
            error={errors.description}
            required
          />
          <FormField
            label="正文 Markdown"
            value={skillBody}
            onChangeText={setSkillBody}
            placeholder="正文 Markdown（可省略 frontmatter，会自动补全）"
            multiline
          />

          <Button isDisabled={busy} onPress={() => void upload()}>
            <Button.Label>{busy ? "上传中…" : "上传并启用"}</Button.Label>
          </Button>
        </Card.Body>
      </Card>

      {msg ? <Typography.Paragraph color="muted">{msg}</Typography.Paragraph> : null}

      {skills.length === 0 ? (
        <Typography.Paragraph color="muted">暂无技能（检查仓库 skills/ 目录）</Typography.Paragraph>
      ) : (
        skills.map((s) => (
          <Card key={s.name}>
            <Card.Body className="gap-2">
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Typography.Heading type="h4" numberOfLines={1}>
                    {s.name}
                  </Typography.Heading>
                </View>
                {s.custom ? (
                  <Chip size="sm" variant="soft" color="accent">
                    自定义
                  </Chip>
                ) : null}
              </View>

              {s.description ? (
                <Typography.Paragraph color="muted">{s.description}</Typography.Paragraph>
              ) : null}

              <SwitchRow
                label={s.enabled ? "已启用" : "已关闭"}
                value={s.enabled}
                onValueChange={(next) => void toggle(s, next)}
                disabled={busy}
                right={
                  // 只有 custom 技能才给删除入口，仓库技能不给。
                  s.custom ? (
                    <Button
                      size="sm"
                      variant="danger"
                      isDisabled={busy}
                      onPress={() => void remove(s)}
                    >
                      <Button.Label>删除</Button.Label>
                    </Button>
                  ) : null
                }
              />
            </Card.Body>
          </Card>
        ))
      )}
    </ScreenScaffold>
  );
}
