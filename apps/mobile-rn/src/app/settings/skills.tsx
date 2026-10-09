import { Button, Card, Chip, Typography } from "heroui-native";
import * as DocumentPicker from "expo-document-picker";
import type { JSX } from "react";
import { useState } from "react";
import { View } from "react-native";

import type { Skill } from "@/api/types";
import { useConfirm } from "@/components/ConfirmDialog";
import { FormField, SectionTitle, SwitchRow } from "@/components/FormField";
import { ScreenScaffold } from "@/components/ScreenScaffold";
import { useBusy, useSkillMutations, useSkills } from "@/queries";

/**
 * Skills 管理。行为对齐 `apps/web/src/App.tsx` 的 `settingsTab === "skills"` 分区。
 *
 * 关键业务规则：`custom` 为 false 的技能来自仓库 `skills/` 目录，是随代码分发的，
 * 只能开关不能删；只有上传到 `skills/users/{user_id}/` 的自定义技能才允许删除。
 * 这个判断放在渲染层（不渲染删除按钮）和点击层（再挡一次）两处，避免以后有人
 * 复用这份列表时绕过限制。
 *
 * 上传方式对齐 Web 的「正文 / 文件夹 / zip 三选一」，但 RN 只保留其中两种：
 * 系统选择器能拿到单个文件，拿不到整个文件夹（`expo-document-picker` 没有目录选择），
 * 所以这里是**正文 Markdown 或 zip 包**二选一。两者互斥：选了 zip 就锁住正文输入，
 * 避免「填了一半正文又选了包」导致服务端拿到互相矛盾的输入。
 */

type UploadErrors = {
  name?: string;
  description?: string;
};

/** 已选中的 zip（本地 uri + 元信息，与 uploadSkillPackage 的入参一致）。 */
type PickedZip = { uri: string; name: string; mime: string };

export default function SkillsSettingsScreen(): JSX.Element {
  const { confirm } = useConfirm();

  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [zip, setZip] = useState<PickedZip | null>(null);
  const [errors, setErrors] = useState<UploadErrors>({});
  const [msg, setMsg] = useState("");

  // 列表与三个写操作都在查询层；这里只留上传表单这类本地状态。
  const skillsQuery = useSkills();
  // 改名 uploadSkill：下面那个 `upload()` 是页面的表单提交函数，别和 mutation 撞名。
  const { setEnabled, upload: uploadSkill, remove } = useSkillMutations();
  const busy = useBusy(setEnabled, uploadSkill, remove);
  const skills = skillsQuery.data ?? [];

  async function toggle(s: Skill, enabled: boolean): Promise<void> {
    setMsg("");
    try {
      await setEnabled.mutateAsync({ name: s.name, enabled });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeSkill(s: Skill): Promise<void> {
    if (!s.custom) return;
    const ok = await confirm({
      title: `删除自定义技能「${s.name}」？`,
      message: "该技能的文件会一并删除，且无法恢复。",
      confirmLabel: "删除",
      cancelLabel: "取消",
      destructive: true,
    });
    if (!ok) return;
    setMsg("");
    try {
      await remove.mutateAsync(s.name);
      setMsg("已删除");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  /** 选 zip：与正文互斥，选中时清掉已填正文。 */
  async function pickZip(): Promise<void> {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["application/zip", "application/x-zip-compressed", "public.zip-archive"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset) return;
      setZip({
        uri: asset.uri,
        name: asset.name ?? "skill.zip",
        mime: asset.mimeType ?? "application/zip",
      });
      setSkillBody("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function upload(): Promise<void> {
    const name = skillName.trim();
    const description = skillDesc.trim();

    // 选了 zip 时 name / description 可以留空 —— 服务端会从包内 SKILL.md 的
    // frontmatter 补全（与 Web 端一致，那里这两个字段也是选填）。
    const nextErrors: UploadErrors = {};
    if (!zip) {
      if (!name) nextErrors.name = "名称必填";
      if (!description) nextErrors.description = "描述必填";
    }
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.description) return;

    setMsg("");
    try {
      const result = zip
        ? await uploadSkill.mutateAsync({ zip })
        : await uploadSkill.mutateAsync({ name, description, body_markdown: skillBody });
      // 上传成功后清空表单：正文可能很长，留着下次容易被误提交两次。
      setSkillName("");
      setSkillDesc("");
      setSkillBody("");
      setZip(null);
      const n = result.file_count ?? result.files?.length ?? 1;
      setMsg(`技能「${result.name}」已上传并默认启用（${n} 个文件）`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <ScreenScaffold
      title="Skills"
      subtitle="技能启用与上传"
      loading={skillsQuery.isLoading}
      error={skillsQuery.error?.message || "加载失败"}
      onRetry={() => void skillsQuery.refetch()}
    >
      <Typography.Paragraph color="muted">
        关闭后该技能不会注入 runtime 系统提示，也无法被 load_skill 加载。默认全部启用。
        自定义技能是目录包（必有 SKILL.md，可含 references/、scripts/ 等）， 上传时**正文 Markdown
        或 zip 包**二选一；落盘到 skills/users/&#123;user_id&#125;/。
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
            // 选了 zip 就交给包内 SKILL.md 的 frontmatter
            required={!zip}
          />
          <FormField
            label="description"
            value={skillDesc}
            onChangeText={setSkillDesc}
            placeholder="description（何时使用）"
            error={errors.description}
            required={!zip}
          />
          <FormField
            label="正文 Markdown"
            value={skillBody}
            onChangeText={setSkillBody}
            placeholder="正文 Markdown（可省略 frontmatter，会自动补全）"
            multiline
            // 与 zip 互斥：选了包就把正文锁住，避免两边同时提交互相矛盾
            editable={!zip}
            hint={zip ? "已选择 zip 包，正文上传不可用" : undefined}
          />

          <View className="gap-2">
            <SectionTitle>上传 zip 技能包</SectionTitle>
            <View className="flex-row items-center gap-3">
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy}
                onPress={() => void pickZip()}
              >
                <Button.Label>{zip ? "重新选择" : "选择 zip"}</Button.Label>
              </Button>
              {zip ? (
                <>
                  <Typography.Paragraph color="muted" className="flex-1 text-sm" numberOfLines={1}>
                    {zip.name}
                  </Typography.Paragraph>
                  <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setZip(null)}>
                    <Button.Label>移除</Button.Label>
                  </Button>
                </>
              ) : null}
            </View>
          </View>

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
                      onPress={() => void removeSkill(s)}
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
