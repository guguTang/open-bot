import type { FormEvent, RefObject } from "react";
import type { Skill } from "../../api";
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
  return (
    <SettingsPage>
      <SettingsHint>
        关闭后该技能不会注入系统提示，也无法被 load_skill 加载。默认全部启用。自定义技能是目录包（必有
        SKILL.md，可含 references/、scripts/ 等）。可粘贴正文、选文件夹，或上传 .zip；服务端会校验路径与体积。
      </SettingsHint>
      <SettingsSection title="上传自定义 Skill">
        <SettingsCard padded>
          <form className="llm-form" onSubmit={(e) => void onUploadSkill(e)}>
            <label>
              名称（可选，若 SKILL.md frontmatter 已有可省略）
              <input
                placeholder="如 my-helper"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
              />
            </label>
            <label>
              描述（可选，若 frontmatter 已有可省略）
              <input
                placeholder="简要说明适用场景"
                value={skillDesc}
                onChange={(e) => setSkillDesc(e.target.value)}
              />
            </label>
            <label>
              正文（单文件 Markdown；与文件夹/zip 三选一）
              <textarea
                placeholder="可省略 frontmatter，会自动补全"
                value={skillBody}
                onChange={(e) => onSkillBodyChange(e.target.value)}
                rows={6}
                disabled={Boolean(skillZip) || skillFolder.length > 0}
              />
            </label>
            <label>
              上传文件夹
              <input
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
                <span className="agent-desc">已选 {skillFolder.length} 个文件</span>
              ) : null}
            </label>
            <label>
              上传 .zip 压缩包
              <input
                ref={skillZipInputRef}
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => onSkillZipChange(e.target.files?.[0] || null)}
              />
              {skillZip ? <span className="agent-desc">{skillZip.name}</span> : null}
            </label>
            <div className="llm-actions">
              <button type="submit" className="primary" disabled={skillsBusy}>
                {skillsBusy ? "上传中…" : "上传并启用"}
              </button>
            </div>
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
                  <div className="llm-actions">
                    <label className="check skill-toggle">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        disabled={skillsBusy}
                        onChange={(e) => void onToggleSkill(s.name, e.target.checked)}
                      />
                      {s.enabled ? "已启用" : "已关闭"}
                    </label>
                    {s.custom ? (
                      <button
                        type="button"
                        className="ghost danger"
                        disabled={skillsBusy}
                        onClick={() => void onDeleteSkill(s.name)}
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </SettingsCard>
        {skillsMsg ? <div className="settings-status">{skillsMsg}</div> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
