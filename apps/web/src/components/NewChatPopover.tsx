import { Plus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Agent } from "../api";
import { cn } from "@/lib/utils";
import { usePreferHostMachines } from "../hooks/usePreferHostMachines";
import { AgentAvatar } from "./AgentAvatar";
import {
  AVATAR_COLOR_PALETTE,
  AVATAR_SHAPE_LABELS,
  AVATAR_SHAPES,
  pickDefaultAvatar,
  type AvatarShape,
} from "./avatarColor";
import { HostMachineSelect } from "./HostMachineSelect";
import { useSheetFormUi } from "./useIsTouchUi";
import { useDialogChrome } from "./useDialogOpen";
import type { CreateBotInput, NewChatMode } from "./newChatTypes";

export type { CreateBotInput, NewChatMode } from "./newChatTypes";

export type NewChatPopoverProps = {
  open: boolean;
  agents: Agent[];
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectAgent: (agent: Agent) => void | Promise<void>;
  onCreateBot: (input: CreateBotInput) => void | Promise<void>;
  onCreateGroup: (name: string, memberIds: string[]) => void | Promise<void>;
  /** When opening from + Action Sheet, jump straight into create form. */
  initialMode?: NewChatMode;
};

const fieldClass =
  "flex flex-col gap-1.5 text-[13px] text-(--muted) [&_input]:rounded-md [&_input]:border [&_input]:border-border [&_input]:bg-(--bg-soft) [&_input]:px-3 [&_input]:py-2.5 [&_input]:text-(--text) [&_input]:outline-none focus-within:[&_input]:border-(--border-strong) focus-within:[&_input]:bg-white";

const textareaClass =
  "mt-1.5 w-full min-h-[72px] resize-y rounded-[10px] border border-border bg-(--bg-elevated,#f7f8fa) px-2.5 py-2 font-inherit outline-none focus:border-(--border-strong) focus:bg-white";

const rowBtnClass =
  "flex w-full cursor-pointer items-center gap-3 rounded-md border-none bg-transparent px-3 py-2.5 text-left text-(--text) hover:bg-(--bg-hover)";

const submitClass =
  "w-full cursor-pointer rounded-md border-none bg-(--accent) px-3.5 py-2.5 font-[560] text-white disabled:cursor-not-allowed disabled:opacity-55";

const backClass =
  "m-0 cursor-pointer rounded-lg border-none bg-transparent px-2 py-1 text-(--muted) hover:bg-(--bg-hover) hover:text-(--text)";

export function NewChatPopover({
  open,
  agents,
  anchorRef,
  onClose,
  onSelectAgent,
  onCreateBot,
  onCreateGroup,
  initialMode = "list",
}: NewChatPopoverProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const sheetForm = useSheetFormUi();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<NewChatMode>(initialMode);
  const [groupName, setGroupName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const [botName, setBotName] = useState("");
  const [botDesc, setBotDesc] = useState("");
  const [botPrompt, setBotPrompt] = useState("");
  const [botShape, setBotShape] = useState<AvatarShape>("rectangle");
  const [botColor, setBotColor] = useState("#457b9d");
  const [botMachineId, setBotMachineId] = useState("");
  const { machines } = usePreferHostMachines(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 24, left: 300 });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const hay = `${a.name} ${a.description || ""} ${a.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [agents, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMode(initialMode || "list");
    setGroupName("");
    setMemberIds([]);
    setBotName("");
    setBotDesc("");
    setBotPrompt("");
    setBotMachineId("");
    {
      const used = agents
        .filter((a) => a.avatar_shape && a.avatar_color)
        .map((a) => `${a.avatar_shape}|${a.avatar_color}`);
      const d = pickDefaultAvatar("new-bot", used);
      setBotShape(d.shape);
      setBotColor(d.color);
    }
    setBusy(false);
    setError("");
    const place = () => {
      if (sheetForm) return;
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const safeTop =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--safe-top"),
        ) || 0;
      const panelH = Math.min(520, window.innerHeight - 24 - safeTop);
      const left = Math.min(r.right + 12, window.innerWidth - 380);
      const top = Math.max(12 + safeTop, Math.min(r.top - 4, window.innerHeight - panelH));
      setPos({ top, left: Math.max(12, left) });
    };
    place();
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, agents, sheetForm, initialMode]);

  const { ref: panelRef, maskProps } = useDialogChrome(open, onClose, {
    modal: sheetForm,
    lockScroll: sheetForm,
    maskClassName:
      "absolute inset-0 cursor-pointer border-none bg-slate-900/45 pointer-events-auto",
    onDismiss: () => {
      if (mode === "group" || mode === "bot") {
        setMode("list");
        setError("");
        return false;
      }
    },
  });

  useEffect(() => {
    if (!open || sheetForm) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, onClose, sheetForm, anchorRef, panelRef]);

  if (!open) return null;

  const toggleMember = (id: string) => {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submitGroup = async () => {
    const name = groupName.trim();
    if (!name) {
      setError("请输入群聊名称");
      return;
    }
    if (memberIds.length === 0) {
      setError("请至少选择一名助手");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreateGroup(name, memberIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const submitBot = async () => {
    const name = botName.trim();
    if (!name) {
      setError("请输入 Bot 名称");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreateBot({
        name,
        description: botDesc.trim(),
        system_prompt: botPrompt.trim(),
        avatar_shape: botShape,
        avatar_color: botColor,
        machine_id: botMachineId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const backToList = () => {
    setMode("list");
    setError("");
  };

  const panelStyle = sheetForm ? undefined : { top: pos.top, left: pos.left };
  const touchMin = sheetForm ? "min-h-11" : "";

  return (
    <dialog
      ref={panelRef}
      className={cn(
        "border-none p-0 text-inherit",
        sheetForm
          ? // Full-bleed root (CSS): fixed inset-0 h-full. Do not add relative/max-h on
            // <dialog> — UA height:fit-content + flex-1 min-h-0 collapses the sheet.
            "action-sheet-root"
          : // Explicit h overrides native <dialog> UA height:fit-content so flex-1
            // min-h-0 children get a definite height (same trap as diagram FS lightbox).
            // Reserve --safe-top for desktop/macOS titlebar / safe-area inset.
            "pointer-events-auto fixed z-40 m-0 flex h-[min(520px,calc(100vh-24px-var(--safe-top,0px)))] max-h-[min(640px,calc(100vh-24px-var(--safe-top,0px)))] w-[min(360px,calc(100vw-24px))] max-w-none flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-(--bg-elevated) p-2.5 shadow-(--shadow-lg)",
      )}
      style={panelStyle}
      aria-label="选择助手"
    >
      {sheetForm ? <button {...maskProps} /> : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          sheetForm &&
            // Sheet panel sits in action-sheet-root (justify-end); max-h keeps it usable
            // above safe-area / titlebar without collapsing the dialog root.
            "relative z-1 max-h-[min(90dvh,90vh)] w-full gap-0 rounded-t-2xl bg-(--bg-elevated) px-3 pb-[calc(10px+var(--safe-bottom,0px))] pt-0",
        )}
      >
        {sheetForm ? (
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-1 pt-3 pb-2">
            <span className="text-base font-semibold">
              {mode === "bot" ? "创建新 Bot" : mode === "group" ? "创建群聊" : "新对话"}
            </span>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-[10px] border-none bg-transparent text-2xl leading-none text-(--muted) hover:bg-(--bg-hover) hover:text-(--text) active:bg-(--bg-hover)"

              aria-label="关闭"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        ) : null}

        {mode === "list" ? (
          <>
            <label
              className={cn(
                "flex items-center gap-0.5 rounded-md border border-transparent bg-(--bg-soft) px-3 py-2.5 focus-within:border-(--border-strong) focus-within:bg-white",

                sheetForm && "shrink-0",
              )}
            >
              <span className="shrink-0 whitespace-nowrap text-[13px] text-(--muted)">收件人：</span>
              <input
                ref={searchRef}
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-(--text) outline-none placeholder:text-(--muted)"

                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索或创建 Bot"
                aria-label="搜索或创建 Bot"
              />
            </label>

            <div className={cn("flex shrink-0 flex-col gap-0.5", sheetForm && "shrink-0")}>
              <button
                type="button"
                className={cn(rowBtnClass, "text-sm", touchMin)}
                onClick={() => {
                  setMode("bot");
                  setError("");
                  const n = query.trim();
                  setBotName(n);
                  const used = agents
                    .filter((a) => a.avatar_shape && a.avatar_color)
                    .map((a) => `${a.avatar_shape}|${a.avatar_color}`);
                  const d = pickDefaultAvatar(n || `new-bot-${Date.now()}`, used);
                  setBotShape(d.shape);
                  setBotColor(d.color);
                }}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-(--bg-soft) text-(--muted)"
                  aria-hidden
                >
                  <Plus size={18} strokeWidth={2} aria-hidden />
                </span>
                <span>创建新 Bot</span>
              </button>
              <button
                type="button"
                className={cn(rowBtnClass, "text-sm", touchMin)}
                onClick={() => {
                  setMode("group");
                  setError("");
                  setGroupName(query.trim());
                }}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-(--bg-soft) text-(--muted)"

                  aria-hidden
                >
                  <Users size={18} strokeWidth={2} aria-hidden />
                </span>
                <span>创建群聊</span>
              </button>
            </div>

            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain pb-1",
                sheetForm && "min-h-0 flex-1 overflow-y-auto overscroll-contain",
              )}
              role="listbox"
              aria-label="助手列表"
            >
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-[13px] text-(--muted)">无匹配助手</div>

              ) : (
                filtered.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={cn(rowBtnClass, "group", touchMin)}
                    role="option"
                    aria-selected={false}
                    onClick={() => void onSelectAgent(a)}
                  >
                    <AgentAvatar
                      id={a.id}
                      name={a.name}
                      size={36}
                      shape={a.avatar_shape}
                      color={a.avatar_color}
                      online={a.online === true}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-[560]">{a.name}</div>
                      {a.description ? (
                        <div className="truncate text-xs text-(--muted)">{a.description}</div>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs font-medium text-(--accent) opacity-0 group-hover:opacity-100">

                      打开对话
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : mode === "bot" ? (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden",
              sheetForm && "gap-0",
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1 pb-3 [-webkit-overflow-scrolling:touch]">
              <div className="flex items-center gap-2">
                <button type="button" className={cn(backClass, touchMin)} onClick={backToList}>
                  ← 返回
                </button>
                {!sheetForm ? <h4 className="m-0 text-[15px] font-semibold">创建新 Bot</h4> : null}
              </div>
              <label className={cn(fieldClass, sheetForm && "[&_input]:min-h-11 [&_input]:text-base")}>
                名称
                <input
                  autoFocus
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="Bot 名称（必填）"
                />
              </label>
              <label className={cn(fieldClass, sheetForm && "[&_input]:min-h-11 [&_input]:text-base")}>
                描述（可选）
                <input
                  value={botDesc}
                  onChange={(e) => setBotDesc(e.target.value)}
                  placeholder="简短介绍"
                />
              </label>
              <label className={fieldClass}>
                人设 / System Prompt（可选）
                <textarea
                  className={textareaClass}
                  rows={4}
                  value={botPrompt}
                  onChange={(e) => setBotPrompt(e.target.value)}
                  placeholder="你是……"
                />
              </label>
              <div className="my-1 mb-2 flex flex-col gap-2 rounded-[10px] bg-black/4 px-3 py-2.5">
                <div className="flex flex-col items-center gap-2 px-0 pt-3 pb-1">
                  <AgentAvatar
                    id={botName || "new-bot"}
                    name={botName || "Bot"}
                    size={48}
                    shape={botShape}
                    color={botColor}
                  />
                  <div className="text-xs text-(--muted)">形象预览（可改；不改则用自动分配）</div>
                </div>
                <div className="mt-1 text-xs text-(--muted)">形状</div>
                <div className="grid grid-cols-4 gap-2">
                  {AVATAR_SHAPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={cn(
                        "flex cursor-pointer flex-col items-center justify-center overflow-visible rounded-[10px] border border-border bg-(--bg-soft) px-1 py-2",
                        botShape === s && "border-(--accent,#6ea8fe) shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent,#6ea8fe)_40%,transparent)]",
                        sheetForm && "min-h-11 min-w-11",
                      )}
                      onClick={() => setBotShape(s)}
                      title={AVATAR_SHAPE_LABELS[s]}
                      aria-label={AVATAR_SHAPE_LABELS[s]}
                    >
                      <AgentAvatar
                        id={botName || "new-bot"}
                        name={botName || "Bot"}
                        size={28}
                        shape={s}
                        color={botColor}
                      />
                      <span
                        className={cn(
                          "mt-1 block text-center text-[10px] leading-tight text-(--muted)",
                          botShape === s && "text-(--text)",
                        )}
                      >
                        {AVATAR_SHAPE_LABELS[s]}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-xs text-(--muted)">主色</div>

                <div className={cn("grid gap-2", sheetForm ? "grid-cols-4" : "grid-cols-6")}>
                  {AVATAR_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn(
                        "aspect-square w-full cursor-pointer rounded-full border-2 border-transparent p-0",
                        botColor.toLowerCase() === c.toLowerCase() &&
                          "border-white shadow-[0_0_0_2px_var(--accent,#6ea8fe)]",
                      )}
                      style={{ background: c }}
                      onClick={() => setBotColor(c)}
                      title={c}
                      aria-label={c}
                    />
                  ))}
                </div>
                <HostMachineSelect
                  value={botMachineId}
                  onChange={setBotMachineId}
                  machines={machines}
                  disabled={busy}
                  sheetForm={sheetForm}
                />
              </div>
              {error ? <div className="text-[13px] text-(--danger)">{error}</div> : null}
            </div>
            <div className="shrink-0 border-t border-border bg-(--bg-elevated) py-2 pb-[calc(4px+var(--safe-bottom,0px))]">
              <button
                type="button"
                className={cn(submitClass, touchMin)}
                disabled={busy}
                onClick={() => void submitBot()}
              >

                {busy ? "创建中…" : "创建并开始聊天"}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden",
              sheetForm && "gap-0",
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1 pb-3 [-webkit-overflow-scrolling:touch]">
              <div className="flex items-center gap-2">
                <button type="button" className={cn(backClass, touchMin)} onClick={backToList}>
                  ← 返回
                </button>
                {!sheetForm ? <h4 className="m-0 text-[15px] font-semibold">创建群聊</h4> : null}
              </div>
              <label className={cn(fieldClass, sheetForm && "[&_input]:min-h-11 [&_input]:text-base")}>
                名称
                <input
                  autoFocus
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="群聊名称"
                />
              </label>
              <div className="text-xs text-(--muted)">选择成员（助手）</div>
              <div className="flex max-h-70 min-h-30 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain">
                {agents.map((a) => {
                  const checked = memberIdSet.has(a.id);
                  return (
                    <label
                      key={a.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-(--bg-hover)",
                        checked && "bg-(--bg-hover)",
                        touchMin,
                      )}
                    >
                      <input
                        type="checkbox"
                        className="accent-(--accent)"
                        checked={checked}
                        onChange={() => toggleMember(a.id)}
                      />
                      <AgentAvatar
                        id={a.id}
                        name={a.name}
                        size={28}
                        shape={a.avatar_shape}
                        color={a.avatar_color}
                        online={a.online === true}
                      />
                      <span>{a.name}</span>
                    </label>
                  );
                })}
              </div>
              {error ? <div className="text-[13px] text-(--danger)">{error}</div> : null}
            </div>
            <div className="shrink-0 border-t border-border bg-(--bg-elevated) py-2 pb-[calc(4px+var(--safe-bottom,0px))]">
              <button
                type="button"
                className={cn(submitClass, touchMin)}
                disabled={busy}
                onClick={() => void submitGroup()}
              >

                {busy ? "创建中…" : "创建群聊"}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
