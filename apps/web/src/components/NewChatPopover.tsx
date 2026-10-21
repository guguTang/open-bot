import { Plus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Button, Input, Label, Modal, SearchField, TextField } from "@heroui/react";
import { ListView, Sheet } from "@heroui-pro/react";
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
            className="shrink-0"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input ref={searchRef as never} placeholder="搜索或创建 Bot" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <div className="flex shrink-0 flex-col gap-0.5">
            <Button
              variant="ghost"
              className={cn("justify-start gap-3", touchMin)}
              onPress={() => {
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
              onPress={() => {
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

          <ListView
            aria-label="助手列表"
            variant="secondary"
            selectionMode="none"
            className="min-h-0 flex-1 border-0 bg-transparent shadow-none"
            items={filtered}
            renderEmptyState={() => (
              <div className="px-3 py-4 text-sm text-muted">无匹配助手</div>
            )}
          >
            {(a) => (
              <ListView.Item id={a.id} textValue={a.name} className={cn(touchMin)}>
                <ListView.ItemContent>
                  <AgentAvatar
                    id={a.id}
                    name={a.name}
                    size={36}
                    shape={a.avatar_shape}
                    color={a.avatar_color}
                    online={a.online === true}
                  />
                  <div className="min-w-0 flex-1">
                    <ListView.Title>{a.name}</ListView.Title>
                    {a.description ? <ListView.Description>{a.description}</ListView.Description> : null}
                  </div>
                </ListView.ItemContent>
                <ListView.ItemAction>
                  <Button variant="ghost" onPress={() => void onSelectAgent(a)}>
                    打开
                  </Button>
                </ListView.ItemAction>
              </ListView.Item>
            )}
          </ListView>
        </>
      ) : mode === "bot" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1">
            <Button variant="ghost" className={cn("w-fit", touchMin)} onPress={() => { setMode("list"); setError(""); }}>
              ← 返回
            </Button>
            <TextField value={botName} onChange={setBotName} isRequired>
              <Label>名称</Label>
              <Input autoFocus placeholder="Bot 名称（必填）" />
            </TextField>
            <TextField value={botDesc} onChange={setBotDesc}>
              <Label>描述（可选）</Label>
              <Input placeholder="简短介绍" />
            </TextField>
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
                    onPress={() => setBotShape(shape)}
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
            <Button fullWidth isPending={busy} onPress={() => void submitBot()}>
              {busy ? "创建中…" : "创建并开始聊天"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-0.5 py-1">
            <Button variant="ghost" className={cn("w-fit", touchMin)} onPress={() => { setMode("list"); setError(""); }}>
              ← 返回
            </Button>
            <TextField value={groupName} onChange={setGroupName} isRequired>
              <Label>名称</Label>
              <Input autoFocus placeholder="群聊名称" />
            </TextField>
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
            <Button fullWidth isPending={busy} onPress={() => void submitGroup()}>
              {busy ? "创建中…" : "创建群聊"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  if (sheetForm) {
    return (
      <Sheet isOpen={open} onOpenChange={onOpenChange} placement="bottom" isDismissable>
        <Sheet.Backdrop>
          <Sheet.Content className="mx-auto max-h-[95vh] w-full max-w-lg">
            <Sheet.Dialog>
              <Sheet.Handle />
              <Sheet.CloseTrigger />
              <Sheet.Header>
                <Sheet.Heading>{title}</Sheet.Heading>
              </Sheet.Header>
              <Sheet.Body className="min-h-0 overflow-hidden p-3 pt-0">{body}</Sheet.Body>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    );
  }

  return (
    <Modal>
      <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange} isDismissable>
        <Modal.Container size="sm" placement="center" className="w-[min(380px,calc(100vw-24px))]">
          <Modal.Dialog className="gap-3 overflow-hidden p-3">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="min-h-0 overflow-hidden p-0">{body}</Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
