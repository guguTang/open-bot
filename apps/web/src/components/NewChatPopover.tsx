import { Plus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { SearchField } from "@/components/ui/search-field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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


export function NewChatPopover({
  open,
  agents,
  anchorRef: _anchorRef,
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
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, agents, initialMode]);

  const onOpenChange = (next: boolean) => {
    if (!next) {
      if (mode === "group" || mode === "bot") {
        setMode("list");
        setError("");
        return;
      }
      onClose();
    }
  };

  void _anchorRef;
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

  const touchMin = sheetForm ? "min-h-11" : "";
  const title =
    mode === "bot" ? "创建新 Bot" : mode === "group" ? "创建群聊" : "新对话";

  const body = (
    <div className={cn("flex min-h-0 flex-col gap-2 overflow-hidden", sheetForm ? "flex-1" : "max-h-[min(640px,80vh)]")}>
      {mode === "list" ? (
        <>
          <SearchField
            aria-label="搜索或创建 Bot"
            value={query}
            onChange={setQuery}
            placeholder="搜索或创建 Bot"
            inputRef={searchRef}
            className="shrink-0"
          />

          <div className="flex shrink-0 flex-col gap-0.5">
            <Button
              variant="ghost"
              className={cn("justify-start gap-3", touchMin)}
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
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-default text-muted" aria-hidden>
                <Plus size={18} strokeWidth={2} aria-hidden />
              </span>
              创建新 Bot
            </Button>
            <Button
              variant="ghost"
              className={cn("justify-start gap-3", touchMin)}
              onClick={() => {
                setMode("group");
                setError("");
                setGroupName(query.trim());
              }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-default text-muted" aria-hidden>
                <Users size={18} strokeWidth={2} aria-hidden />
              </span>
              创建群聊
            </Button>
          </div>

          <ul className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0" aria-label="助手列表">
            {filtered.length === 0 ? (
              <li className="list-none px-3 py-4 text-sm text-muted">无匹配助手</li>
            ) : (
              filtered.map((a) => (
                <Item key={a.id} className={cn(touchMin)}>
                  <ItemContent>
                    <AgentAvatar
                      id={a.id}
                      name={a.name}
                      size={36}
                      shape={a.avatar_shape}
                      color={a.avatar_color}
                      online={a.online === true}
                    />
                    <div className="min-w-0 flex-1">
                      <ItemTitle>{a.name}</ItemTitle>
                      {a.description ? <ItemDescription>{a.description}</ItemDescription> : null}
                    </div>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="ghost" onClick={() => void onSelectAgent(a)}>
                      打开
                    </Button>
                  </ItemActions>
                </Item>
              ))
            )}
          </ul>
        </>
      ) : mode === "bot" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1">
            <Button variant="ghost" className={cn("w-fit", touchMin)} onClick={() => { setMode("list"); setError(""); }}>
              ← 返回
            </Button>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-bot-name">名称</Label>
              <Input
                id="new-bot-name"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                autoFocus
                required
                placeholder="Bot 名称（必填）"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-bot-desc">描述（可选）</Label>
              <Input
                id="new-bot-desc"
                value={botDesc}
                onChange={(e) => setBotDesc(e.target.value)}
                placeholder="简短介绍"
              />
            </div>
            <label className="flex flex-col gap-1.5 text-sm text-muted">
              人设 / System Prompt（可选）
              <textarea
                className="mt-0.5 min-h-[72px] w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-foreground outline-none focus:border-focus"
                rows={4}
                value={botPrompt}
                onChange={(e) => setBotPrompt(e.target.value)}
                placeholder="你是……"
              />
            </label>
            <div className="flex flex-col gap-2 rounded-lg bg-default/60 px-3 py-2.5">
              <div className="flex flex-col items-center gap-2 px-0 pt-2 pb-1">
                <AgentAvatar id={botName || "new-bot"} name={botName || "Bot"} size={48} shape={botShape} color={botColor} />
                <div className="text-xs text-muted">形象预览（可改；不改则用自动分配）</div>
              </div>
              <div className="text-xs text-muted">形状</div>
              <div className="grid grid-cols-4 gap-2">
                {AVATAR_SHAPES.map((shape) => (
                  <Button
                    key={shape}
                    variant={botShape === shape ? "secondary" : "ghost"}
                    className={cn("flex h-auto flex-col items-center gap-1 py-2", sheetForm && "min-h-11")}
                    onClick={() => setBotShape(shape)}
                    aria-label={AVATAR_SHAPE_LABELS[shape]}
                  >
                    <AgentAvatar id={botName || "new-bot"} name={botName || "Bot"} size={28} shape={shape} color={botColor} />
                    <span className="text-[10px]">{AVATAR_SHAPE_LABELS[shape]}</span>
                  </Button>
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
                      botColor.toLowerCase() === c.toLowerCase() && "border-background shadow-[0_0_0_2px_var(--accent)]",
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
            {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          </div>
          <div className="shrink-0 border-t border-separator py-2">
            <Button fullWidth isPending={busy} onClick={() => void submitBot()}>
              {busy ? "创建中…" : "创建并开始聊天"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1">
            <Button variant="ghost" className={cn("w-fit", touchMin)} onClick={() => { setMode("list"); setError(""); }}>
              ← 返回
            </Button>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-group-name">名称</Label>
              <Input
                id="new-group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
                required
                placeholder="群聊名称"
              />
            </div>
            <div className="text-xs text-muted">选择成员（助手）</div>
            <div className="flex max-h-70 min-h-30 flex-1 flex-col gap-0.5 overflow-y-auto">
              {agents.map((a) => {
                const checked = memberIdSet.has(a.id);
                return (
                  <label
                    key={a.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-default",
                      checked && "bg-default",
                      touchMin,
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
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
            {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          </div>
          <div className="shrink-0 border-t border-separator py-2">
            <Button fullWidth isPending={busy} onClick={() => void submitGroup()}>
              {busy ? "创建中…" : "创建群聊"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (sheetForm) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" showHandle className="mx-auto max-h-[95vh] w-full max-w-lg gap-2 p-0">
          <SheetHeader className="pb-0">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden p-3 pt-0">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[min(380px,calc(100vw-24px))] max-w-[calc(100vw-24px)] flex-col gap-3 overflow-hidden p-3 sm:max-w-[380px]"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">选择已有助手，或创建新的 Bot / 群聊</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-hidden p-0">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
