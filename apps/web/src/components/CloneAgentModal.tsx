import { FormEvent, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Agent, CloneAgentResult } from "../api";
import { cloneAgent } from "../api";
import { OPENBOT_SYSTEM_BACK_EVENT } from "../lib/mobileSystemBack";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type Props = {
  agent: Agent | null;
  onClose: () => void;
  onCloned: (result: CloneAgentResult) => void;
};

type FormProps = {
  agent: Agent;
  onClose: () => void;
  onCloned: (result: CloneAgentResult) => void;
};

function CloneAgentModalForm({ agent, onClose, onCloned }: FormProps) {
  const [name, setName] = useState(() => `${agent.name} 副本`);
  const [copyMemory, setCopyMemory] = useState(true);
  const [copyRoutines, setCopyRoutines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onSystemBack = (event: Event) => {
      event.preventDefault();
      if (!busy) onClose();
    };
    document.addEventListener(OPENBOT_SYSTEM_BACK_EVENT, onSystemBack);
    return () => document.removeEventListener(OPENBOT_SYSTEM_BACK_EVENT, onSystemBack);
  }, [busy, onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(85dvh,720px)] flex-col gap-4 overflow-hidden sm:max-w-md"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <DialogHeader className="min-w-0 gap-1.5 text-left">
            <DialogTitle className="text-balance">复制助手「{agent.name}」</DialogTitle>
            <DialogDescription>
              人设与 Skills 会一起复制。专属记忆默认带上，例行任务可选。
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="关闭"
              disabled={busy}
            >
              <X aria-hidden />
            </Button>
          </DialogClose>
        </div>

        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <FieldGroup className="gap-4">
            <Field data-disabled={busy ? true : undefined}>
              <FieldLabel htmlFor="clone-agent-name">新助手名称</FieldLabel>
              <Input
                id="clone-agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                maxLength={80}
              />
            </Field>

            <FieldSet className="gap-3 border-0 p-0">
              <FieldLegend variant="label">会复制</FieldLegend>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                <li>岗位描述、人设（系统提示）、电脑模式</li>
                <li>本助手的 Skills 开关</li>
              </ul>
              <Field orientation="horizontal" data-disabled={busy ? true : undefined}>
                <Checkbox
                  id="clone-memory"
                  checked={copyMemory}
                  disabled={busy}
                  onCheckedChange={(checked) => setCopyMemory(checked === true)}
                />
                <FieldLabel htmlFor="clone-memory" className="font-normal">
                  同时复制本助手的专属记忆
                </FieldLabel>
              </Field>
              <Field orientation="horizontal" data-disabled={busy ? true : undefined}>
                <Checkbox
                  id="clone-routines"
                  checked={copyRoutines}
                  disabled={busy}
                  onCheckedChange={(checked) => setCopyRoutines(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="clone-routines" className="font-normal">
                    同时复制例行任务
                  </FieldLabel>
                  <FieldDescription>复制后为暂停，需手动开启。</FieldDescription>
                </FieldContent>
              </Field>
            </FieldSet>
          </FieldGroup>

          <Separator />

          <div className="flex flex-col gap-4">
            <FieldSet className="gap-2 border-0 p-0">
              <FieldLegend variant="label">与原助手共享（账号级）</FieldLegend>
              <FieldDescription className="text-pretty">
                你的个人记忆、技能库、模型连接、MCP、已登记的电脑。
              </FieldDescription>
            </FieldSet>
            <FieldSet className="gap-2 border-0 p-0">
              <FieldLegend variant="label">不会复制</FieldLegend>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                <li>聊天记录与线程、群聊成员身份</li>
                <li>助手密钥（需重新授权）、private 模式下的私有文件</li>
              </ul>
            </FieldSet>
          </div>

          {err ? <FieldError>{err}</FieldError> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : null}
              {busy ? "复制中…" : "复制"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 「复制助手」：人设与 Skills 总是复制；Bot 记忆默认勾选，例行任务可选。 */
export function CloneAgentModal({ agent, onClose, onCloned }: Props) {
  if (!agent) return null;

  return <CloneAgentModalForm key={agent.id} agent={agent} onClose={onClose} onCloned={onCloned} />;
}
