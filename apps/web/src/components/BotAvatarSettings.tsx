import { X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { Agent, Machine } from "../api";
import { listMachines } from "../api";
import { isLoginOnlyMachine, machinePresenceLabel, preferHostMachines } from "../lib/clientEnv";
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
import { useSheetFormUi } from "./useIsTouchUi";
import { useDialogOpen } from "./useDialogOpen";

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

function machineHint(m: Machine): string {
  return machinePresenceLabel(m);
}

/**
 * Bot 形象 + 优先电脑.
 * On sheetForm (touch OR ≤860): fullscreen shell chrome matching settings subpages
 * (circle ← / left title / circle ×, gray bg, white cards, sticky 保存).
 */
export function BotAvatarSettings({ agent, open, onClose, onSave }: Props) {
  const sheetForm = useSheetFormUi();
  const [shape, setShape] = useState<AvatarShape>("rectangle");
  const [color, setColor] = useState("#457b9d");
  const [machineId, setMachineId] = useState("");
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machinesLoaded, setMachinesLoaded] = useState(false);
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
    setMachinesLoaded(false);
    let cancelled = false;
    void (async () => {
      try {
        const list = await listMachines();
        if (!cancelled) {
          const hosts = preferHostMachines(list);
          setMachines(hosts);
          setMachinesLoaded(true);
          setMachineId((prev) => {
            if (!prev) return prev;
            const bound = list.find((m) => m.id === prev);
            if (bound && isLoginOnlyMachine(bound)) return "";
            return prev;
          });
        }
      } catch (ex) {
        if (!cancelled) {
          setMachines([]);
          setMachinesLoaded(true);
          setErr(ex instanceof Error ? ex.message : String(ex));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, open]);

  useEffect(() => {
    if (!open || !sheetForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, sheetForm]);

  const dialogRef = useDialogOpen(open, onClose, { blockDismiss: busy });

  if (!open || !agent) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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

  const closeIcon = <X size={16} strokeWidth={2} aria-hidden />;

  return (
    <dialog
      ref={dialogRef}
      className={`modal-backdrop${sheetForm ? " bot-avatar-backdrop-sheet bot-avatar-backdrop-shell settings-backdrop-shell" : ""}`}
      aria-label={`Bot 形象 ${agent.name}`}
    >
      <button
        type="button"
        className="modal-backdrop-mask"
        aria-label="关闭"
        disabled={busy}
        onClick={onClose}
      />
      <div className={`modal bot-avatar-modal${sheetForm ? " bot-avatar-modal-sheet bot-avatar-modal-shell" : ""}`}>
        {sheetForm ? (
          <div className="settings-shell-subhead">
            <button
              type="button"
              className="settings-shell-back"
              aria-label="返回"
              onClick={onClose}
            >
              ←
            </button>
            <h2>Bot 形象 · {agent.name}</h2>
            <button type="button" className="settings-close" aria-label="关闭" onClick={onClose}>
              {closeIcon}
            </button>
          </div>
        ) : (
          <div className="modal-head">
            <h3>Bot 形象 · {agent.name}</h3>
            <button type="button" className="ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        )}

        <form className="bot-avatar-form" onSubmit={(e) => void submit(e)}>
          <div className="bot-avatar-form-scroll">
            <div className={sheetForm ? "bot-avatar-shell-card" : undefined}>
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
                <div className="bot-avatar-status-toggles" role="group" aria-label="预览表情">
                  {PREVIEW_STATUSES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`bot-avatar-status-opt${previewMode === s.id ? " active" : ""}`}
                      onClick={() => setPreviewMode(s.id)}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`bot-avatar-status-opt${previewMode === SEARCHING_PREVIEW_ID ? " active" : ""}`}
                    onClick={() => setPreviewMode(SEARCHING_PREVIEW_ID)}
                    title="产品态仍为执行(working)，仅头动画切 searching"
                  >
                    检索动画
                  </button>
                </div>
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
            </div>

            <div className={sheetForm ? "bot-avatar-shell-card" : undefined}>
              <label className="bot-avatar-label" htmlFor="bot-machine-select">
                优先电脑
              </label>
              <select
                id="bot-machine-select"
                className="bot-machine-select"
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                disabled={busy}
              >
                <option value="">不指定（跟发消息的电脑）</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {(m.label || m.id) + " · " + machineHint(m)}
                  </option>
                ))}
              </select>
              {machinesLoaded && machines.length === 0 ? (
                <div className="muted small whitespace-normal leading-[1.45] wrap-anywhere">
                  还没有已连接的电脑。手机不能当作优先电脑。
                </div>
              ) : (
                <div className="muted small whitespace-normal leading-[1.45] wrap-anywhere">
                  本地能力跟「你在哪台电脑上发这条消息」走，不会锁死创建时选的那台。优先电脑仅在路由需要兜底时使用。
                </div>
              )}
              {err ? <div className="text-[13px] text-(--danger)">{err}</div> : null}
            </div>
          </div>

          <div className="llm-actions bot-avatar-form-footer">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "保存中…" : "保存"}
            </button>
            <button type="button" onClick={onClose} disabled={busy}>
              取消
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
