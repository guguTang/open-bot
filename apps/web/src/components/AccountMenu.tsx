import { ChevronRight, Cpu, LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LLMConnection } from "../api";

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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`account-trigger${open ? " open" : ""}${llm ? "" : " warn"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setFlyout(false);
        }}
      >
        <span className="account-trigger-name">{username}</span>
        {llm ? null : <span className="account-warn-dot" title="未配置模型" />}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="account-menu"
          style={{ left: pos.left, bottom: pos.bottom }}
          role="menu"
          aria-label="账户菜单"
        >
          <div
            className="account-row-wrap"
            onMouseEnter={() => setFlyout(true)}
            onMouseLeave={() => setFlyout(false)}
          >
            <button
              type="button"
              className="account-row"
              role="menuitem"
              aria-expanded={flyout}
              onClick={() => setFlyout((v) => !v)}
            >
              <span className="account-row-icon">
                <Cpu {...rowIcon} />
              </span>
              <span className="account-row-label">当前模型</span>
              <span className={`account-row-meta${llm ? "" : " warn"}`}>
                <span className="account-row-value">{modelLabel || "未配置"}</span>
                <ChevronRight {...chevron} />
              </span>
            </button>
            {flyout ? (
              <div className="account-flyout" role="group" aria-label="当前模型">
                <div className="account-flyout-card">
                  <div className="account-flyout-title">当前模型</div>
                  <div className="account-flyout-sub">{flyoutDetail}</div>
                  <button type="button" className="account-row" role="menuitem" onClick={() => closeMenu(onChangeModel)}>
                    <span className="account-row-label">更改模型</span>
                    <span className="account-row-meta">
                      <ChevronRight {...chevron} />
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <button type="button" className="account-row" role="menuitem" onClick={() => closeMenu(onOpenSettings)}>
            <span className="account-row-icon">
              <Settings {...rowIcon} />
            </span>
            <span className="account-row-label">设置</span>
          </button>

          <div className="account-divider" />

          <button
            type="button"
            className="account-row"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <span className="account-row-icon">
              <LogOut {...rowIcon} />
            </span>
            <span className="account-row-label">退出登录</span>
          </button>
        </div>
      ) : null}
    </>
  );
}
