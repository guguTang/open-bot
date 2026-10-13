import { ChevronRight, Cpu, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LLMConnection } from "../api";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  username: string;
  llm?: LLMConnection;
  onOpenSettings: () => void;
  onChangeModel: () => void;
  onLogout: () => void;
};

const rowIcon = { size: 18, strokeWidth: 1.8, "aria-hidden": true as const };
const chevron = { size: 14, strokeWidth: 2, "aria-hidden": true as const };

export function AccountMenu({ username, llm, onOpenSettings, onChangeModel, onLogout }: AccountMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [flyout, setFlyout] = useState(false);
  const [pos, setPos] = useState({ left: 16, bottom: 16 });

  const modelLabel = llm?.model || llm?.name || "";
  const flyoutDetail = llm
    ? [llm.name, llm.model].filter(Boolean).join(" · ")
    : "尚未配置，对话会缺少模型";

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        left: Math.max(12, r.left),
        bottom: Math.max(12, window.innerHeight - r.top + 8),
      });
    };
    place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setFlyout(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
      setFlyout(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const closeMenu = (fn: () => void) => {
    setOpen(false);
    setFlyout(false);
    fn();
  };

  const accountRowClass =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-3 py-2.5 text-left text-sm text-[var(--text)] hover:bg-[#f3f4f6]";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "inline-flex max-w-full cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border-0 px-3.5 py-2 text-sm font-[560] text-[var(--text)]",
          llm ? "bg-[var(--bg-soft)]" : "bg-[#fef3c7]",
          "hover:bg-[var(--bg-hover)]",
          open && "bg-[var(--bg-hover)]",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setFlyout(false);
        }}
      >
        <span className="truncate">{username}</span>
        {llm ? null : (
          <span className="size-[7px] shrink-0 rounded-full bg-[#d97706]" title="未配置模型" />
        )}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="fixed z-[45] w-[min(280px,calc(100vw-24px))] rounded-2xl bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.14),0_0_0_1px_rgba(15,23,42,0.05)]"
          style={{ left: pos.left, bottom: pos.bottom }}
          role="menu"
          aria-label="账户菜单"
        >
          <div
            className="relative"
            onMouseEnter={() => setFlyout(true)}
            onMouseLeave={() => setFlyout(false)}
          >
            <button
              type="button"
              className={accountRowClass}
              role="menuitem"
              aria-expanded={flyout}
              onClick={() => setFlyout((v) => !v)}
            >
              <span className="grid size-5 shrink-0 place-items-center text-[#6b7280]">
                <Cpu {...rowIcon} />
              </span>
              <span className="min-w-0 flex-1">当前模型</span>
              <span
                className={cn(
                  "ml-auto inline-flex min-w-0 max-w-[46%] shrink items-center gap-0.5 text-[13px] text-[#9ca3af]",
                  !llm && "text-[#b45309]",
                )}
              >
                <span className="truncate">{modelLabel || "未配置"}</span>
                <ChevronRight {...chevron} />
              </span>
            </button>
            {flyout ? (
              <div className="absolute left-full top-0 pl-2" role="group" aria-label="当前模型">
                <div className="w-[196px] rounded-[14px] bg-white px-1.5 pb-1.5 pt-3 shadow-[0_16px_40px_rgba(15,23,42,0.14),0_0_0_1px_rgba(15,23,42,0.05)]">
                  <div className="px-3 text-sm font-[650]">当前模型</div>
                  <div className="px-3 pb-2 pt-0.5 text-[13px] text-[#9ca3af]">{flyoutDetail}</div>
                  <button type="button" className={accountRowClass} role="menuitem" onClick={() => closeMenu(onChangeModel)}>
                    <span className="min-w-0 flex-1">更改模型</span>
                    <span className="ml-auto inline-flex items-center gap-0.5 text-[#9ca3af]">
                      <ChevronRight {...chevron} />
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <button type="button" className={accountRowClass} role="menuitem" onClick={() => closeMenu(onOpenSettings)}>
            <span className="grid size-5 shrink-0 place-items-center text-[#6b7280]">
              <Settings {...rowIcon} />
            </span>
            <span className="min-w-0 flex-1">设置</span>
          </button>

          <div className="mx-2.5 my-1.5 h-px bg-[#eceef1]" />

          <button
            type="button"
            className={accountRowClass}
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <span className="grid size-5 shrink-0 place-items-center text-[#6b7280]">
              <LogOut {...rowIcon} />
            </span>
            <span className="min-w-0 flex-1">退出登录</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
