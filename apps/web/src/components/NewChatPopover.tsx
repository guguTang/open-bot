import { Plus, Users, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
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

/** Desktop side panel: hugs content, matches the pre-shadcn popover next to 「+」. */
const panelClass =
  "flex w-[min(360px,calc(100vw-24px))] max-w-[calc(100vw-24px)] flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-(--bg-elevated) p-2.5 text-foreground shadow-(--shadow-lg) sm:max-w-[360px]";

const rowBtnClass =
  "flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-sm text-foreground hover:bg-(--bg-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const fieldLabelClass = "text-[13px] font-normal text-muted";

const fieldControlClass =
  "h-10 border-border bg-(--bg-soft) shadow-none focus-visible:border-(--border-strong) focus-visible:ring-ring/30";

function outsideNode(event: { target: EventTarget | null }): Node | null {
  return event.target instanceof Node ? event.target : null;
}

function shouldKeepPopoverOpen(node: Node | null, anchor: HTMLElement | null) {
  if (!node) return false;
  if (anchor?.contains(node)) return true;
  const el = node instanceof Element ? node : node.parentElement;
  return Boolean(el?.closest("[data-slot='select-content'], [data-slot='select-item']"));
}

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
  const virtualRef = useRef<HTMLElement | null>(null);
  const sheetForm = useSheetFormUi();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [placed, setPlaced] = useState(false);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const hay = `${a.name} ${a.description || ""} ${a.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [agents, query]);

  useLayoutEffect(() => {
    if (!open || sheetForm) {
      setAnchorEl(null);
      setPlaced(false);
      return;
    }
    const el = anchorRef.current;
    virtualRef.current = el;
    setAnchorEl(el);
    setPlaced(true);
  }, [open, sheetForm, anchorRef]);

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
    const t = window.setTimeout(() => {
      if ((initialMode || "list") === "list") searchRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [open, agents, initialMode]);

  /** Sheet / unanchored dialog: step back to the list before dismissing. */
  const dismissToListOrClose = (next: boolean) => {
    if (!next) {
      if (mode === "group" || mode === "bot") {
        setMode("list");
        setError("");
        return;
      }
      onClose();
    }
  };

  const backToList = () => {
    setMode("list");
    setError("");
  };

  if (!open) return null;
  if (!sheetForm && !placed) return null;

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

  const touchMin = sheetForm ? "min-h-11" : "";
  const title = mode === "bot" ? "创建新 Bot" : mode === "group" ? "创建群聊" : "新对话";

  const startBot = () => {
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
  };

  const body = (
    <div className={cn("flex min-h-0 flex-col gap-2 overflow-hidden", sheetForm ? "min-h-0 flex-1" : "")}>
      {mode === "list" ? (
        <>
          <label className="flex shrink-0 items-center gap-0.5 rounded-md border border-transparent bg-(--bg-soft) px-3 py-1 focus-within:border-(--border-strong) focus-within:bg-(--surface)">
            <span className="shrink-0 whitespace-nowrap text-[13px] text-muted">收件人：</span>
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索或创建 Bot"
              aria-label="搜索或创建 Bot"
              autoComplete="off"
              className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
            />
          </label>

          <div className="flex shrink-0 flex-col gap-0.5">
            <button type="button" className={cn(rowBtnClass, touchMin)} onClick={startBot}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--bg-soft) text-muted" aria-hidden>
                <Plus size={18} strokeWidth={2} aria-hidden />
              </span>
              创建新 Bot
            </button>
            <button
              type="button"
              className={cn(rowBtnClass, touchMin)}
              onClick={() => {
                setMode("group");
                setError("");
                setGroupName(query.trim());
              }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--bg-soft) text-muted" aria-hidden>
                <Users size={18} strokeWidth={2} aria-hidden />
              </span>
              创建群聊
            </button>
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pb-1",
              sheetForm ? "max-h-[min(52dvh,420px)]" : "max-h-[min(360px,46vh)]",
            )}
            role="listbox"
            aria-label="助手列表"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-[13px] text-muted">无匹配助手</div>
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
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    {a.description ? <div className="truncate text-xs text-muted">{a.description}</div> : null}
                  </div>
                  <span className="shrink-0 text-xs font-medium text-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                    打开对话
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : mode === "bot" ? (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div
            className={cn(
              "flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1",
              sheetForm ? "max-h-[min(62dvh,560px)]" : "max-h-[min(520px,68vh)]",
            )}
          >
            <div className="flex items-center gap-2">
              <Button variant="ghost" className={cn("h-auto px-2 py-1 text-muted hover:bg-(--bg-hover)", touchMin)} onClick={backToList}>
                ← 返回
              </Button>
              {!sheetForm ? <h2 className="m-0 text-[15px] font-semibold">创建新 Bot</h2> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-bot-name" className={fieldLabelClass}>名称</Label>
              <Input
                id="new-bot-name"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                autoFocus
                required
                placeholder="Bot 名称（必填）"
                className={cn(fieldControlClass, sheetForm && "min-h-11 text-base")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-bot-desc" className={fieldLabelClass}>描述（可选）</Label>
              <Input
                id="new-bot-desc"
                value={botDesc}
                onChange={(e) => setBotDesc(e.target.value)}
                placeholder="简短介绍"
                className={cn(fieldControlClass, sheetForm && "min-h-11 text-base")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-bot-prompt" className={fieldLabelClass}>人设 / System Prompt（可选）</Label>
              <Textarea
                id="new-bot-prompt"
                rows={4}
                value={botPrompt}
                onChange={(e) => setBotPrompt(e.target.value)}
                placeholder="你是……"
                className="min-h-[72px] resize-y border-border bg-(--bg-soft) shadow-none focus-visible:border-(--border-strong) focus-visible:ring-ring/30"
              />
            </div>
            <div className="flex flex-col gap-2 rounded-[10px] bg-(--bg-soft) px-3 py-2.5">
              <div className="flex flex-col items-center gap-2 px-0 pt-2 pb-1">
                <AgentAvatar id={botName || "new-bot"} name={botName || "Bot"} size={48} shape={botShape} color={botColor} />
                <div className="text-xs text-muted">形象预览（可改；不改则用自动分配）</div>
              </div>
              <div className="text-xs text-muted">形状</div>
              <div className="grid grid-cols-4 gap-2">
                {AVATAR_SHAPES.map((shape) => (
                  <button
                    key={shape}
                    type="button"
                    className={cn(
                      "flex cursor-pointer flex-col items-center justify-center rounded-[10px] border border-border bg-(--surface) px-1 py-2",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      botShape === shape && "border-foreground shadow-[0_0_0_1px_var(--foreground)]",
                      sheetForm && "min-h-11",
                    )}
                    onClick={() => setBotShape(shape)}
                    aria-label={AVATAR_SHAPE_LABELS[shape]}
                    aria-pressed={botShape === shape}
                  >
                    <AgentAvatar id={botName || "new-bot"} name={botName || "Bot"} size={28} shape={shape} color={botColor} />
                    <span className={cn("mt-1 text-center text-[11px] leading-tight text-muted", botShape === shape && "text-foreground")}>
                      {AVATAR_SHAPE_LABELS[shape]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="text-xs text-muted">主色</div>
              <div className={cn("grid gap-2", sheetForm ? "grid-cols-4" : "grid-cols-6")}>
                {AVATAR_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      "aspect-square w-full cursor-pointer rounded-full border-2 border-transparent p-0",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      botColor.toLowerCase() === c.toLowerCase() && "border-(--bg-elevated) shadow-[0_0_0_2px_var(--accent)]",
                    )}
                    style={{ background: c }}
                    onClick={() => setBotColor(c)}
                    title={c}
                    aria-label={c}
                    aria-pressed={botColor.toLowerCase() === c.toLowerCase()}
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
            {error ? <p className="text-[13px] text-danger" role="alert">{error}</p> : null}
          </div>
          <div className="shrink-0 border-t border-border bg-(--bg-elevated) py-2 pb-[calc(4px+var(--safe-bottom,0px))]">
            <Button fullWidth className="h-10 font-semibold" isPending={busy} onClick={() => void submitBot()}>
              {busy ? "创建中…" : "创建并开始聊天"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div
            className={cn(
              "flex min-h-0 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1",
              sheetForm ? "max-h-[min(62dvh,560px)]" : "max-h-[min(520px,68vh)]",
            )}
          >
            <div className="flex items-center gap-2">
              <Button variant="ghost" className={cn("h-auto px-2 py-1 text-muted hover:bg-(--bg-hover)", touchMin)} onClick={backToList}>
                ← 返回
              </Button>
              {!sheetForm ? <h2 className="m-0 text-[15px] font-semibold">创建群聊</h2> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-group-name" className={fieldLabelClass}>名称</Label>
              <Input
                id="new-group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
                required
                placeholder="群聊名称"
                className={cn(fieldControlClass, sheetForm && "min-h-11 text-base")}
              />
            </div>
            <div className="text-xs text-muted">选择成员（助手）</div>
            <div className="flex max-h-70 min-h-30 flex-col gap-0.5 overflow-y-auto">
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
                      className="size-4 accent-(--accent)"
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
            {error ? <p className="text-[13px] text-danger" role="alert">{error}</p> : null}
          </div>
          <div className="shrink-0 border-t border-border bg-(--bg-elevated) py-2 pb-[calc(4px+var(--safe-bottom,0px))]">
            <Button fullWidth className="h-10 font-semibold" isPending={busy} onClick={() => void submitGroup()}>
              {busy ? "创建中…" : "创建群聊"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (sheetForm) {
    return (
      <Sheet open={open} onOpenChange={dismissToListOrClose}>
        <SheetContent
          side="bottom"
          showHandle
          showCloseButton={false}
          className="mx-auto max-h-[min(90dvh,90vh)] w-full max-w-lg gap-0 rounded-t-2xl border-border bg-(--bg-elevated) p-0 shadow-(--shadow-lg)"
        >
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 px-3 pt-1">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetClose
              aria-label="关闭"
              className="grid size-11 place-items-center rounded-[10px] text-muted hover:bg-(--bg-hover) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onClose}
            >
              <X size={20} aria-hidden />
            </SheetClose>
          </div>
          <div className="min-h-0 overflow-hidden px-3 pb-[calc(10px+var(--safe-bottom,0px))]">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  if (anchorEl) {
    return (
      <Popover open={open} onOpenChange={(next) => { if (!next) onClose(); }} modal={false}>
        <PopoverAnchor virtualRef={virtualRef} />
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          alignOffset={-4}
          // Stay beside the 「+」 button. Desktop is wider than the sheet breakpoint,
          // so the 360px panel fits on the right; flipping would cover the sidebar.
          avoidCollisions={false}
          aria-label={title}
          className={panelClass}
          onEscapeKeyDown={(event) => {
            if (mode === "bot" || mode === "group") {
              event.preventDefault();
              backToList();
            }
          }}
          onInteractOutside={(event) => {
            if (shouldKeepPopoverOpen(outsideNode(event), anchorEl)) event.preventDefault();
          }}
          onOpenAutoFocus={(event) => {
            if (mode === "list") {
              event.preventDefault();
              searchRef.current?.focus();
            }
          }}
        >
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Dialog open={open} onOpenChange={dismissToListOrClose}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/20"
        className={cn(panelClass, "top-[12vh] translate-y-0")}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>选择已有助手，或创建新的 Bot / 群聊</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
