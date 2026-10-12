import { ChevronRight, X } from "lucide-react";
import type { Agent } from "../api";
import { AgentAvatar } from "./AgentAvatar";

export type SettingsHubNav =
  | "account"
  | "server"
  | "mcp"
  | "bot"
  | "machines"
  | "llm"
  | "skills"
  | "sandbox"
  | "compact"
  | "routines"
  | "secrets"
  | "general"
  | "review";

type Props = {
  username: string;
  email?: string;
  accountInitials: string;
  focusBot?: Agent | null;
  preferredMachineLabel?: string;
  /** Current API base for hub row value (truncated). */
  apiBaseLabel?: string;
  onClose: () => void;
  onNavigate: (tab: SettingsHubNav) => void;
  /** Open BotAvatarSettings (形象 + 优先电脑); keep separate from「当前 Bot」人设. */
  onOpenBotAvatar?: () => void;
  onLogout: () => void;
};

function Chevron() {
  return <ChevronRight className="settings-hub-chevron" size={16} strokeWidth={2} aria-hidden />;
}

/**
 * Grok-style grouped settings hub for touch-ui / layout-narrow (C-2 → #7 v2).
 * Fullscreen gray+white cards; drill-downs use existing settings tabs / sheets.
 * P1-4 keeps 「服务器」; approval-tri-state adds 「审核」.
 * bot-persona-entry: primary「当前 Bot」→ BotSettingsPanel (人设); 「形象与优先电脑」separate.
 */
export function MobileSettingsHub({
  username,
  email,
  accountInitials,
  focusBot,
  preferredMachineLabel,
  apiBaseLabel,
  onClose,
  onNavigate,
  onOpenBotAvatar,
  onLogout,
}: Props) {
  return (
    <div className="settings-hub settings-hub-v2">
      <div className="settings-hub-top">
        <h2 className="settings-hub-title">设置</h2>
        <button type="button" className="settings-hub-close" aria-label="关闭" onClick={onClose}>
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>

      <div className="settings-hub-scroll">
        <section className="settings-hub-card">
          <button type="button" className="settings-hub-row settings-hub-row-account" onClick={() => onNavigate("account")}>
            <span className="settings-hub-avatar" aria-hidden>
              {accountInitials}
            </span>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">{username || "账户"}</span>
              {email ? <span className="settings-hub-row-sub">{email}</span> : null}
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("server")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">服务器</span>
              <span className="settings-hub-row-sub">API 地址 · 局域网 / 隧道配对</span>
            </span>
            <span className="settings-hub-row-value">{apiBaseLabel || "默认"}</span>
            <Chevron />
          </button>
        </section>

        <section className="settings-hub-card">
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("mcp")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">插件</span>
              <span className="settings-hub-row-sub">扩展能力与连接</span>
            </span>
            <Chevron />
          </button>
        </section>

        <div className="settings-hub-section-label">Bot</div>
        <section className="settings-hub-card">
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("bot")}>
            {focusBot ? (
              <AgentAvatar
                id={focusBot.id}
                name={focusBot.name}
                size={36}
                shape={focusBot.avatar_shape}
                color={focusBot.avatar_color}
                online={focusBot.online === true}
              />
            ) : (
              <span className="settings-hub-avatar settings-hub-avatar-sm" aria-hidden>
                ?
              </span>
            )}
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">当前 Bot</span>
              <span className="settings-hub-row-sub">
                {focusBot ? `人设 · 岗位 · 能力 · ${focusBot.name}` : "人设 · 岗位 · 能力"}
              </span>
            </span>
            <Chevron />
          </button>
          <button
            type="button"
            className="settings-hub-row"
            onClick={() => {
              if (onOpenBotAvatar && focusBot) onOpenBotAvatar();
              else onNavigate("bot");
            }}
          >
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">形象与优先电脑</span>
              <span className="settings-hub-row-sub">头像、形状与本 Bot 优先电脑</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("machines")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">优先电脑</span>
            </span>
            <span className="settings-hub-row-value">{preferredMachineLabel || "未指定"}</span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("review")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">审核</span>
              <span className="settings-hub-row-sub">始终允许的操作</span>
            </span>
            <Chevron />
          </button>
        </section>

        <div className="settings-hub-section-label">通用</div>
        <section className="settings-hub-card">
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("llm")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">模型</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("skills")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">扩展能力包</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("sandbox")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">运行环境</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("routines")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">例行任务</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("compact")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">数据与压缩</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("secrets")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">密钥</span>
            </span>
            <Chevron />
          </button>
          <button type="button" className="settings-hub-row" onClick={() => onNavigate("general")}>
            <span className="settings-hub-row-main">
              <span className="settings-hub-row-title">时区与自动审核</span>
              <span className="settings-hub-row-sub">自动审核规则与报告时区</span>
            </span>
            <Chevron />
          </button>
        </section>

        <section className="settings-hub-card">
          <button type="button" className="settings-hub-row settings-hub-row-logout" onClick={onLogout}>
            退出登录
          </button>
        </section>
      </div>
    </div>
  );
}
