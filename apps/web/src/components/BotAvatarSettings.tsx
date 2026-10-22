import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Agent } from "../api";
import { usePreferHostMachines } from "../hooks/usePreferHostMachines";
import {
  AVATAR_COLOR_PALETTE,
  AVATAR_SHAPE_LABELS,
  AVATAR_SHAPES,
  resolveAvatarColor,
  resolveAvatarShape,
  type AvatarShape,
  type BotPresenceStatus,
} from "./avatarColor";
import { AgentAvatar } from "./AgentAvatar";
import { HostMachineSelect } from "./HostMachineSelect";
import { useSheetFormUi } from "./useIsTouchUi";
import { useDialogChrome } from "./useDialogOpen";
import { X } from "lucide-react";

type Props = {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
  onSave: (
    agentId: string,
    patch: { avatar_shape: string; avatar_color: string; machine_id?: string },
  ) => Promise<void>;
};

const PREVIEW_STATUSES: { id: BotPresenceStatus; label: string }[] = [
  { id: "idle", label: "空闲" },
  { id: "thinking", label: "思考" },
  { id: "working", label: "执行" },
  { id: "awaiting_approval", label: "待审批" },
  { id: "error", label: "出错" },
];

/** Local-only §8 preview: forces searching animation while product status stays working. */
const SEARCHING_PREVIEW_ID = "searching_anim" as const;
type PreviewMode = BotPresenceStatus | typeof SEARCHING_PREVIEW_ID;

/**
 * Bot 形象 + 优先电脑.
 * Desktop: Dialog (close button, primary Save, ghost Cancel, shadcn Select).
 * sheetForm (touch OR ≤860): fullscreen shell chrome matching settings subpages.
 */
export function BotAvatarSettings({ agent, open, onClose, onSave }: Props) {
  const sheetForm = useSheetFormUi();
  const [shape, setShape] = useState<AvatarShape>("rectangle");
  const [color, setColor] = useState("#457b9d");
  const [machineId, setMachineId] = useState("");
  const { machines, loaded: machinesLoaded, error: machinesError } = usePreferHostMachines(
    Boolean(agent && open),
  );
  const [previewMode, setPreviewMode] = useState<PreviewMode>("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!agent || !open) return;
    const seed = agent.id || agent.name;
    setShape(resolveAvatarShape(seed, agent.avatar_shape));
    setColor(resolveAvatarColor(seed, agent.avatar_color));
    setMachineId(agent.machine_id || "");
    setPreviewMode("idle");
    setErr("");
  }, [agent, open]);

  useEffect(() => {
    if (!machinesLoaded) return;
    if (machinesError) setErr(machinesError);
    setMachineId((prev) => {
      if (!prev) return prev;
      if (!machines.some((m) => m.id === prev)) return "";
      return prev;
    });
  }, [machinesLoaded, machines, machinesError]);

  const { ref: dialogRef, maskProps } = useDialogChrome(open && sheetForm, onClose, {
    blockDismiss: busy,
    lockScroll: sheetForm,
  });

  if (!open || !agent) return null;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await onSave(agent.id, {
        avatar_shape: shape,
        avatar_color: color,
        machine_id: machineId,
      });
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const formBody = (
    <>
      <div className="bot-avatar-preview">
        <AgentAvatar
          id={agent.id}
          name={agent.name}
          size={64}
          shape={shape}
          color={color}
          status={previewMode === SEARCHING_PREVIEW_ID ? "working" : previewMode}
          searchingHint={previewMode === SEARCHING_PREVIEW_ID}
        />
        <ToggleGroup
          type="single"
          aria-label="预览表情"
          value={previewMode}
          onValueChange={(id) => {
            if (id) setPreviewMode(id as PreviewMode);
          }}
          size="sm"
          className="bot-avatar-status-toggles flex flex-wrap gap-1"
        >
          {PREVIEW_STATUSES.map((s) => (
            <ToggleGroupItem key={s.id} value={s.id}>
              {s.label}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value={SEARCHING_PREVIEW_ID} aria-label="检索动画预览">
            检索动画
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="muted small">预览五态 + 检索动画变体（仅本地试看，不改真实 presence）</div>
      </div>

      <span className="bot-avatar-label">形状</span>
      <div className="bot-avatar-shape-grid">
        {AVATAR_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            className={`bot-avatar-shape-opt${shape === s ? " active" : ""}`}
            onClick={() => setShape(s)}
            title={AVATAR_SHAPE_LABELS[s]}
            aria-label={AVATAR_SHAPE_LABELS[s]}
          >
            <AgentAvatar id={agent.id} name={agent.name} size={36} shape={s} color={color} />
            <span className="bot-avatar-shape-label">{AVATAR_SHAPE_LABELS[s]}</span>
          </button>
        ))}
      </div>

      <span className="bot-avatar-label">主色</span>
      <div className="bot-avatar-color-grid">
        {AVATAR_COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`bot-avatar-color-opt${color.toLowerCase() === c.toLowerCase() ? " active" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            title={c}
            aria-label={c}
          />
        ))}
      </div>

      <HostMachineSelect
        id="bot-machine-select"
        value={machineId}
        onChange={setMachineId}
        machines={machines}
        disabled={busy}
        sheetForm={sheetForm}
        emptyHint="还没有已连接的电脑。手机不能当作优先电脑。"
        helpHint="本地能力跟「你在哪台电脑上发这条消息」走，不会锁死创建时选的那台。优先电脑仅在路由需要兜底时使用。"
      />
      {err ? <div className="text-[13px] text-danger">{err}</div> : null}
    </>
  );

  if (sheetForm) {
    return (
      <dialog
        ref={dialogRef}
        className="modal-backdrop bot-avatar-backdrop-sheet bot-avatar-backdrop-shell settings-backdrop-shell"
        aria-label={`Bot 形象 ${agent.name}`}
      >
        <button {...maskProps} />
        <div className="modal bot-avatar-modal bot-avatar-modal-sheet bot-avatar-modal-shell">
          <div className="settings-shell-subhead">
            <button type="button" className="settings-shell-back" aria-label="返回" onClick={onClose}>
              ←
            </button>
            <h2>Bot 形象 · {agent.name}</h2>
            <button type="button" className="settings-close" aria-label="关闭" onClick={onClose}>
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <form className="bot-avatar-form" onSubmit={(e) => void submit(e)}>
            <div className="bot-avatar-form-scroll">
              <div className="bot-avatar-shell-card">{formBody}</div>
            </div>
            <div className="llm-actions bot-avatar-form-footer flex gap-2">
              <Button type="submit" variant="primary" isDisabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Button>
              <Button type="button" variant="ghost" isDisabled={busy} onPress={onClose}>
                取消
              </Button>
            </div>
          </form>
        </div>
      </dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[min(85dvh,720px)] w-[min(440px,calc(100vw-24px))] max-w-[calc(100vw-24px)] flex-col gap-3 overflow-hidden sm:max-w-[440px]"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Bot 形象 · {agent.name}</DialogTitle>
        </DialogHeader>
        <form id="bot-avatar-form" className="bot-avatar-form flex min-h-0 flex-col gap-3 overflow-y-auto" onSubmit={(e) => void submit(e)}>
          {formBody}
        </form>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="submit" form="bot-avatar-form" variant="primary" isDisabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
          <Button type="button" variant="ghost" isDisabled={busy} onClick={onClose}>
            取消
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
