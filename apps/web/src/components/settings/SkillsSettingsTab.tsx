import type { FormEvent, RefObject } from "react";
import type { Skill } from "../../api";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsHint,
  SettingsPage,
  SettingsSection,
} from "../SettingsLayout";

export type SkillsSettingsTabProps = {
  skillName: string;
  setSkillName: (v: string) => void;
  skillDesc: string;
  setSkillDesc: (v: string) => void;
  skillBody: string;
  skillZip: File | null;
  skillFolder: File[];
  skillFolderInputRef: RefObject<HTMLInputElement | null>;
  skillZipInputRef: RefObject<HTMLInputElement | null>;
  skillsBusy: boolean;
  skillsMsg: string;
  skills: Skill[];
  onUploadSkill: (e: FormEvent) => void | Promise<void>;
  onToggleSkill: (name: string, enabled: boolean) => void | Promise<void>;
  onDeleteSkill: (name: string) => void | Promise<void>;
  onSkillBodyChange: (value: string) => void;
  onSkillFolderChange: (files: File[]) => void;
  onSkillZipChange: (file: File | null) => void;
};

export function SkillsSettingsTab({
  skillName,
  setSkillName,
  skillDesc,
  setSkillDesc,
  skillBody,
  skillZip,
  skillFolder,
  skillFolderInputRef,
  skillZipInputRef,
  skillsBusy,
  skillsMsg,
  skills,
  onUploadSkill,
  onToggleSkill,
  onDeleteSkill,
  onSkillBodyChange,
  onSkillFolderChange,
  onSkillZipChange,
}: SkillsSettingsTabProps) {
  const bodyDisabled = Boolean(skillZip) || skillFolder.length > 0;

  return (
    <SettingsPage>
      <SettingsHint>
        关闭后该技能不会注入系统提示，也无法被 load_skill 加载。默认全部启用。自定义技能是目录包（必有
        SKILL.md，可含 references/、scripts/ 等）。可粘贴正文、选文件夹，或上传 .zip；服务端会校验路径与体积。
      </SettingsHint>
      <SettingsSection title="上传自定义 Skill">
        <SettingsCard padded>
          <form onSubmit={(e) => void onUploadSkill(e)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="skill-name">
                  名称（可选，若 SKILL.md frontmatter 已有可省略）
                </FieldLabel>
                <Input
                  id="skill-name"
                  placeholder="如 my-helper"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-desc">
                  描述（可选，若 frontmatter 已有可省略）
                </FieldLabel>
                <Input
                  id="skill-desc"
                  placeholder="简要说明适用场景"
                  value={skillDesc}
                  onChange={(e) => setSkillDesc(e.target.value)}
                />
              </Field>
              <Field data-disabled={bodyDisabled || undefined}>
                <FieldLabel htmlFor="skill-body">
                  正文（单文件 Markdown；与文件夹/zip 三选一）
                </FieldLabel>
                <Textarea
                  id="skill-body"
                  placeholder="可省略 frontmatter，会自动补全"
                  value={skillBody}
                  onChange={(e) => onSkillBodyChange(e.target.value)}
                  rows={6}
                  disabled={bodyDisabled}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-folder">上传文件夹</FieldLabel>
                <Input
                  id="skill-folder"
                  ref={skillFolderInputRef}
                  type="file"
                  multiple
                  {...({
                    webkitdirectory: "",
                    directory: "",
                  } as Record<string, string>)}
                  onChange={(e) => onSkillFolderChange(Array.from(e.target.files || []))}
                />
                {skillFolder.length > 0 ? (
                  <FieldDescription>已选 {skillFolder.length} 个文件</FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-zip">上传 .zip 压缩包</FieldLabel>
                <Input
                  id="skill-zip"
                  ref={skillZipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => onSkillZipChange(e.target.files?.[0] || null)}
                />
                {skillZip ? <FieldDescription>{skillZip.name}</FieldDescription> : null}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={skillsBusy}>
                  {skillsBusy ? "上传中…" : "上传并启用"}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="已安装">
        <SettingsCard>
          <div className="llm-list">
            {skills.length === 0 ? (
              <SettingsEmpty>暂无技能。</SettingsEmpty>
            ) : (
              skills.map((s) => (
                <div key={s.name} className="llm-item">
                  <div>
                    <div className="agent-name">
                      {s.name}
                      {s.custom ? <span className="pill">自定义</span> : null}
                      {s.custom && s.file_count ? (
                        <span className="pill">{s.file_count} 文件</span>
                      ) : null}
                    </div>
                    <div className="agent-desc">{s.description}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Field orientation="horizontal" className="w-auto gap-2">
                      <Switch
                        id={`skill-enabled-${s.name}`}
                        checked={s.enabled}
                        disabled={skillsBusy}
                        onCheckedChange={(checked) => void onToggleSkill(s.name, checked)}
                      />
                      <FieldLabel htmlFor={`skill-enabled-${s.name}`} className="font-normal">
                        {s.enabled ? "已启用" : "已关闭"}
                      </FieldLabel>
                    </Field>
                    {s.custom ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={skillsBusy}
                        onClick={() => void onDeleteSkill(s.name)}
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {skillsMsg ? <p className="settings-status m-0">{skillsMsg}</p> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
