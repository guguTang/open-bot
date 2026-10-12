import { Plus, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Agent, Machine } from "../api";
import { listMachines } from "../api";
import { machinePresenceLabel, preferHostMachines } from "../lib/clientEnv";
import { AgentAvatar } from "./AgentAvatar";
import {
  AVATAR_COLOR_PALETTE,
  AVATAR_SHAPE_LABELS,
  AVATAR_SHAPES,
  pickDefaultAvatar,
  type AvatarShape,
} from "./avatarColor";
import { useSheetFormUi } from "./useIsTouchUi";

export type CreateBotInput = {
  name: string;
  description: string;
  system_prompt: string;
  avatar_shape: string;
  avatar_color: string;
  machine_id?: string;
};

export type NewChatMode = "list" | "group" | "bot";

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
  anchorRef,
  onClose,
  onSelectAgent,
  onCreateBot,
  onCreateGroup,
  initialMode = "list",
}: NewChatPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sheetForm = useSheetFormUi();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<NewChatMode>(initialMode);
  const [groupName, setGroupName] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [botName, setBotName] = useState("");
  const [botDesc, setBotDesc] = useState("");
  const [botPrompt, setBotPrompt] = useState("");
  const [botShape, setBotShape] = useState<AvatarShape>("rectangle");
  const [botColor, setBotColor] = useState("#457b9d");
  const [botMachineId, setBotMachineId] = useState("");
  const [machines, setMachines] = useState<Machine[]>([]);
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
    let cancelled = false;
    void listMachines()
      .then((list) => {
        if (!cancelled) setMachines(preferHostMachines(list));
      })
      .catch(() => {
        if (!cancelled) setMachines([]);
      });
    const place = () => {
      if (sheetForm) return;
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = Math.min(r.right + 12, window.innerWidth - 380);
      const top = Math.max(12, Math.min(r.top - 4, window.innerHeight - 520));
      setPos({ top, left: Math.max(12, left) });
    };
    place();
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    window.addEventListener("resize", place);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, agents, sheetForm, initialMode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mode === "group" || mode === "bot") {
          setMode("list");
          setError("");
        } else {
          onClose();
        }
      }
    };
    // pointerdown covers mouse + touch; avoid mousedown-only close on touch devices.
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onClose, mode, anchorRef]);

  useEffect(() => {
    if (!open || !sheetForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, sheetForm]);

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

  return (
    <div
      className={`new-chat-layer${sheetForm ? " new-chat-layer-sheet" : ""}`}
      role="presentation"
    >
      {sheetForm ? (
        <button
          type="button"
          className="new-chat-sheet-mask"
          aria-label="关闭"
          onClick={onClose}
        />
      ) : null}
      <div
        ref={panelRef}
        className={`new-chat-popover${sheetForm ? " new-chat-popover-sheet" : ""}`}
        style={panelStyle}
        role="dialog"
        aria-label="选择助手"
        aria-modal={sheetForm ? true : undefined}
      >
        {sheetForm ? (
          <div className="new-chat-sheet-top">
            <span className="new-chat-sheet-top-title">
              {mode === "bot" ? "创建新 Bot" : mode === "group" ? "创建群聊" : "新对话"}
            </span>
            <button
              type="button"
              className="new-chat-sheet-close"
              aria-label="关闭"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        ) : null}

        {mode === "list" ? (
          <>
            <label className="new-chat-search">
              <span className="new-chat-search-prefix">收件人：</span>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索或创建 Bot"
                aria-label="搜索或创建 Bot"
              />
            </label>

            <div className="new-chat-actions">
              <button
                type="button"
                className="new-chat-action"
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
                <span className="new-chat-action-icon" aria-hidden>
                  <Plus size={18} strokeWidth={2} aria-hidden />
                </span>
                <span>创建新 Bot</span>
              </button>
              <button
                type="button"
                className="new-chat-action"
                onClick={() => {
                  setMode("group");
                  setError("");
                  setGroupName(query.trim());
                }}
              >
                <span className="new-chat-action-icon" aria-hidden>
                  <Users size={18} strokeWidth={2} aria-hidden />
                </span>
                <span>创建群聊</span>
              </button>
            </div>

            <div className="new-chat-list" role="listbox" aria-label="助手列表">
              {filtered.length === 0 ? (
                <div className="new-chat-empty muted">无匹配助手</div>
              ) : (
                filtered.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="new-chat-row"
                    role="option"
                    onClick={() => void onSelectAgent(a)}
                  >
                    <AgentAvatar id={a.id} name={a.name} size={36} shape={a.avatar_shape} color={a.avatar_color} online={a.online === true} />
                    <div className="new-chat-row-main">
                      <div className="new-chat-row-name">{a.name}</div>
                      {a.description ? (
                        <div className="new-chat-row-desc">{a.description}</div>
                      ) : null}
                    </div>
                    <span className="new-chat-row-cta">打开对话</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : mode === "bot" ? (
          <div className="new-chat-group">
            <div className="new-chat-group-scroll">
              {!sheetForm ? (
                <div className="new-chat-group-head">
                  <button type="button" className="ghost new-chat-back" onClick={backToList}>
                    ← 返回
                  </button>
                  <h4>创建新 Bot</h4>
                </div>
              ) : (
                <div className="new-chat-group-head">
                  <button type="button" className="ghost new-chat-back" onClick={backToList}>
                    ← 返回
                  </button>
                </div>
              )}
              <label className="new-chat-field">
                名称
                <input
                  autoFocus
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder="Bot 名称（必填）"
                />
              </label>
              <label className="new-chat-field">
                描述（可选）
                <input
                  value={botDesc}
                  onChange={(e) => setBotDesc(e.target.value)}
                  placeholder="简短介绍"
                />
              </label>
              <label className="new-chat-field">
                人设 / System Prompt（可选）
                <textarea
                  className="new-chat-textarea"
                  rows={4}
                  value={botPrompt}
                  onChange={(e) => setBotPrompt(e.target.value)}
                  placeholder="你是……"
                />
              </label>
              <div className="new-chat-avatar-block">
                <div className="bot-avatar-preview">
                  <AgentAvatar
                    id={botName || "new-bot"}
                    name={botName || "Bot"}
                    size={48}
                    shape={botShape}
                    color={botColor}
                  />
                  <div className="muted small">形象预览（可改；不改则用自动分配）</div>
                </div>
                <div className="bot-avatar-label">形状</div>
                <div className="bot-avatar-shape-grid new-chat-shape-grid">
                  {AVATAR_SHAPES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`bot-avatar-shape-opt${botShape === s ? " active" : ""}`}
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
                      <span className="bot-avatar-shape-label">{AVATAR_SHAPE_LABELS[s]}</span>
                    </button>
                  ))}
                </div>
                <div className="bot-avatar-label">主色</div>
                <div className="bot-avatar-color-grid">
                  {AVATAR_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`bot-avatar-color-opt${botColor.toLowerCase() === c.toLowerCase() ? " active" : ""}`}
                      style={{ background: c }}
                      onClick={() => setBotColor(c)}
                      title={c}
                      aria-label={c}
                    />
                  ))}
                </div>
                <label className="new-chat-field">
                  优先电脑
                  <select
                    className="bot-machine-select"
                    value={botMachineId}
                    onChange={(e) => setBotMachineId(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">不指定（在你发消息的那台电脑上运行）</option>
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {(m.label || m.id) + " · " + machinePresenceLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                {machines.length === 0 ? (
                  <div className="muted small">还没有已连接的电脑。手机不能当作优先电脑。</div>
                ) : (
                  <div className="muted small new-chat-help-wrap">读文件、跑命令会在你当前发消息的电脑上执行。这里只是可选的默认优先机。</div>
                )}
              </div>
              {error ? <div className="new-chat-error">{error}</div> : null}
            </div>
            <div className="new-chat-group-footer">
              <button
                type="button"
                className="primary new-chat-group-submit"
                disabled={busy}
                onClick={() => void submitBot()}
              >
                {busy ? "创建中…" : "创建并开始聊天"}
              </button>
            </div>
          </div>
        ) : (
          <div className="new-chat-group">
            <div className="new-chat-group-scroll">
              {!sheetForm ? (
                <div className="new-chat-group-head">
                  <button type="button" className="ghost new-chat-back" onClick={backToList}>
                    ← 返回
                  </button>
                  <h4>创建群聊</h4>
                </div>
              ) : (
                <div className="new-chat-group-head">
                  <button type="button" className="ghost new-chat-back" onClick={backToList}>
                    ← 返回
                  </button>
                </div>
              )}
              <label className="new-chat-field">
                名称
                <input
                  autoFocus
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="群聊名称"
                />
              </label>
              <div className="new-chat-members-label">选择成员（助手）</div>
              <div className="new-chat-members">
                {agents.map((a) => {
                  const checked = memberIds.includes(a.id);
                  return (
                    <label key={a.id} className={`new-chat-member ${checked ? "on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(a.id)}
                      />
                      <AgentAvatar id={a.id} name={a.name} size={28} shape={a.avatar_shape} color={a.avatar_color} online={a.online === true} />
                      <span>{a.name}</span>
                    </label>
                  );
                })}
              </div>
              {error ? <div className="new-chat-error">{error}</div> : null}
            </div>
            <div className="new-chat-group-footer">
              <button
                type="button"
                className="primary new-chat-group-submit"
                disabled={busy}
                onClick={() => void submitGroup()}
              >
                {busy ? "创建中…" : "创建群聊"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
