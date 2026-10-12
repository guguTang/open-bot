import { FormEvent, useCallback, useRef, useState } from "react";
import {
  deleteSkill,
  listSkills,
  setSkillEnabled,
  Skill,
  uploadSkill,
  uploadSkillPackage,
} from "../../api";

type ConfirmFn = (opts: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}) => Promise<boolean>;

export function useSkillsSettings(confirm: ConfirmFn) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsMsg, setSkillsMsg] = useState("");
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillDesc, setSkillDesc] = useState("");
  const [skillBody, setSkillBody] = useState("");
  const [skillZip, setSkillZip] = useState<File | null>(null);
  const [skillFolder, setSkillFolder] = useState<File[]>([]);
  const skillFolderInputRef = useRef<HTMLInputElement>(null);
  const skillZipInputRef = useRef<HTMLInputElement>(null);

  const refreshSkills = useCallback(async () => {
    const list = await listSkills();
    setSkills(list);
  }, []);

  const onUploadSkill = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setSkillsBusy(true);
      setSkillsMsg("");
      try {
        let result;
        if (skillZip) {
          result = await uploadSkillPackage({
            name: skillName.trim() || undefined,
            description: skillDesc.trim() || undefined,
            archive: skillZip,
          });
        } else if (skillFolder.length > 0) {
          result = await uploadSkillPackage({
            name: skillName.trim() || undefined,
            description: skillDesc.trim() || undefined,
            folderFiles: skillFolder,
          });
        } else {
          result = await uploadSkill({
            name: skillName.trim(),
            description: skillDesc.trim(),
            body_markdown: skillBody,
          });
        }
        setSkillName("");
        setSkillDesc("");
        setSkillBody("");
        setSkillZip(null);
        setSkillFolder([]);
        if (skillFolderInputRef.current) skillFolderInputRef.current.value = "";
        if (skillZipInputRef.current) skillZipInputRef.current.value = "";
        await refreshSkills();
        const n = result.file_count ?? result.files?.length ?? 1;
        setSkillsMsg(`技能「${result.name}」已上传并启用（${n} 个文件）`);
      } catch (err) {
        setSkillsMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setSkillsBusy(false);
      }
    },
    [skillZip, skillFolder, skillName, skillDesc, skillBody, refreshSkills],
  );

  const onDeleteSkill = useCallback(
    async (name: string) => {
      const ok = await confirm({
        title: `删除自定义技能「${name}」？`,
        confirmLabel: "删除",
        cancelLabel: "取消",
        danger: true,
      });
      if (!ok) return;
      setSkillsBusy(true);
      setSkillsMsg("");
      try {
        await deleteSkill(name);
        await refreshSkills();
        setSkillsMsg("已删除");
      } catch (err) {
        setSkillsMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setSkillsBusy(false);
      }
    },
    [confirm, refreshSkills],
  );

  const toggleSkill = useCallback(
    async (name: string, enabled: boolean) => {
      setSkillsBusy(true);
      setSkillsMsg("");
      try {
        await setSkillEnabled(name, enabled);
        await refreshSkills();
      } catch (err) {
        setSkillsMsg(err instanceof Error ? err.message : String(err));
      } finally {
        setSkillsBusy(false);
      }
    },
    [refreshSkills],
  );

  const onSkillBodyChange = useCallback((value: string) => {
    setSkillBody(value);
    setSkillZip(null);
    setSkillFolder([]);
    if (skillFolderInputRef.current) skillFolderInputRef.current.value = "";
    if (skillZipInputRef.current) skillZipInputRef.current.value = "";
  }, []);

  const onSkillFolderChange = useCallback((files: File[]) => {
    setSkillFolder(files);
    setSkillZip(null);
    setSkillBody("");
    if (skillZipInputRef.current) skillZipInputRef.current.value = "";
  }, []);

  const onSkillZipChange = useCallback((file: File | null) => {
    setSkillZip(file);
    setSkillFolder([]);
    setSkillBody("");
    if (skillFolderInputRef.current) skillFolderInputRef.current.value = "";
  }, []);

  return {
    skills,
    skillsMsg,
    setSkillsMsg,
    skillsBusy,
    skillName,
    setSkillName,
    skillDesc,
    setSkillDesc,
    skillBody,
    skillZip,
    skillFolder,
    skillFolderInputRef,
    skillZipInputRef,
    refreshSkills,
    onUploadSkill,
    onDeleteSkill,
    toggleSkill,
    onSkillBodyChange,
    onSkillFolderChange,
    onSkillZipChange,
  };
}
