import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import { ConnectAppDetail, type IntegrationsSettingsTabProps } from "../settings/IntegrationsSettingsTab";
import { useConfirm, useConfirmIsOpen } from "../ConfirmProvider";
import { OPENBOT_SYSTEM_BACK_EVENT } from "../../lib/mobileSystemBack";
import {
  CONNECT_APP_PILLS,
  connectAppById,
  connectedAppIds,
  filterConnectApps,
  shouldShowRecommendedRail,
  sliceConnectedIcons,
  type ConnectAppId,
  type ConnectAppPill,
} from "../../lib/connectApps/catalog";
import { ConnectAppMark } from "./ConnectAppMark";

const CONNECTED_ICON_CAP = 8;

export type ConnectAppsMarketProps = IntegrationsSettingsTabProps & {
  sheetForm: boolean;
  focus: ConnectAppId | null;
  onFocusConsumed: () => void;
  onClose: () => void;
  onRevealAdvanced: () => void;
  advanced: ReactNode;
};

type MarketView = "catalog" | "detail" | "advanced";

function providerLoadError(id: ConnectAppId, props: IntegrationsSettingsTabProps): string {
  if (id === "gmail") return props.loadError || "";
  if (id === "slack") return props.slackLoadError || "";
  if (id === "telegram") return props.telegramLoadError || "";
  if (id === "feishu") return props.feishuLoadError || "";
  return props.githubLoadError || "";
}

function isFailure(msg: string): boolean {
  return msg.includes("失败") || msg.includes("不足") || msg.includes("未成功");
}

/**
 * 连接应用的唯一内容树：搜索、分类、已连接计数、真实应用行。
 * 点「连接 / 管理」才进入既有 OAuth / 凭据详情。没有 recommended 时不渲染推荐轨。
 */
export function ConnectAppsMarket({
  sheetForm,
  focus,
  onFocusConsumed,
  onClose,
  onRevealAdvanced,
  advanced,
  ...props
}: ConnectAppsMarketProps) {
  const confirm = useConfirm();
  const confirmIsOpen = useConfirmIsOpen();
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<ConnectAppPill>("全部");
  const [view, setView] = useState<MarketView>("catalog");
  const [detailId, setDetailId] = useState<ConnectAppId | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const connectedIds = useMemo(
    () =>
      connectedAppIds({
        gmail: props.gmail,
        slack: props.slack,
        telegram: props.telegram,
        feishu: props.feishu,
        github: props.github,
      }),
    [props.gmail, props.slack, props.telegram, props.feishu, props.github],
  );
  const connected = useMemo(() => new Set(connectedIds), [connectedIds]);
  const filtered = useMemo(
    () => filterConnectApps({ query, pill, connected }),
    [query, pill, connected],
  );
  const showRecommended = shouldShowRecommendedRail(filtered.length > 0);
  const icons = sliceConnectedIcons(connectedIds, CONNECTED_ICON_CAP);
  const detail = detailId ? connectAppById(detailId) : null;

  useEffect(() => {
    if (!focus) return;
    setDetailId(focus);
    setView("detail");
    onFocusConsumed();
  }, [focus, onFocusConsumed]);

  function openDetail(id: ConnectAppId) {
    setDetailId(id);
    setView("detail");
  }

  function backToCatalog() {
    setView("catalog");
    setDetailId(null);
  }

  useEffect(() => {
    const onBack = (ev: Event) => {
      if (confirmIsOpen()) return;
      ev.preventDefault();
      if (view !== "catalog") {
        backToCatalog();
        return;
      }
      onClose();
    };
    document.addEventListener(OPENBOT_SYSTEM_BACK_EVENT, onBack);
    return () => document.removeEventListener(OPENBOT_SYSTEM_BACK_EVENT, onBack);
  }, [view, onClose, confirmIsOpen]);

  async function confirmDisconnect(name: string, run: () => void | Promise<void>) {
    const ok = await confirm({
      title: `断开 ${name}？`,
      description:
        name === "Gmail"
          ? "断开后 Bot 不能再用这个邮箱发信或阅读邮件，需要重新授权才能恢复。"
          : "将清除本服务保存的凭据。若这次连接自动创建了入站 Hook，只会删除那一条，不会删除手工创建的 Hook。",
      confirmLabel: "断开连接",
      cancelLabel: "取消",
      danger: true,
    });
    if (!ok) return;
    await run();
  }

  const detailProps: IntegrationsSettingsTabProps = {
    ...props,
    onDisconnectGmail: () => confirmDisconnect("Gmail", props.onDisconnectGmail),
    onDisconnectSlack: () => confirmDisconnect("Slack", props.onDisconnectSlack),
    onDisconnectGitHub: () => confirmDisconnect("GitHub", props.onDisconnectGitHub),
    onDisconnectTelegram: () => confirmDisconnect("Telegram", props.onDisconnectTelegram),
    onDisconnectFeishu: () => confirmDisconnect("飞书", props.onDisconnectFeishu),
  };

  const title = view === "detail" && detail ? detail.name : view === "advanced" ? "高级" : "连接应用";
  const showBack = view !== "catalog";

  return (
    <div
      className={cn("connect-apps", sheetForm ? "settings-hub connect-apps--narrow" : "connect-apps--desktop")}
      data-testid="connect-apps-market"
    >
      {sheetForm ? (
        showBack ? (
          <header className="settings-shell-subhead">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="settings-shell-back"
              aria-label="返回"
              onClick={backToCatalog}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <h2>{title}</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="settings-hub-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </header>
        ) : (
          <header className="settings-hub-top">
            <h2 className="connect-apps-narrow-title">连接应用</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="settings-hub-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </header>
        )
      ) : (
        <header className="connect-apps-desktop-head">
          <div className="connect-apps-desktop-titleline">
            {showBack ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="返回" onClick={backToCatalog}>
                <ChevronLeft aria-hidden />
              </Button>
            ) : null}
            <h2 className="connect-apps-desktop-title">{title}</h2>
            {view === "catalog" ? (
              <button type="button" className="connect-apps-count" onClick={() => setPill("已连接")}>
                已连接 {connectedIds.length}
              </button>
            ) : null}
            {view === "catalog" && connectedIds.length > 0 ? (
              <span className="connect-apps-iconstrip" aria-label="已连接的应用">
                {icons.visible.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="connect-apps-iconbtn"
                    aria-label={`管理 ${connectAppById(id).name}`}
                    onClick={() => openDetail(id)}
                  >
                    <ConnectAppMark id={id} size="sm" />
                  </button>
                ))}
                {icons.overflow > 0 ? <span className="connect-apps-iconmore">+{icons.overflow}</span> : null}
              </span>
            ) : null}
          </div>
          {view === "catalog" ? (
            <SearchField
              aria-label="搜索应用"
              value={query}
              onChange={setQuery}
              placeholder="搜索应用"
              className="connect-apps-search"
            />
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" className="settings-close" aria-label="关闭" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </header>
      )}

      <div className={cn(sheetForm ? "settings-hub-scroll" : "connect-apps-scroll")}>
        {props.msg ? (
          <p className={cn("connect-apps-msg", isFailure(props.msg) && "connect-apps-msg--fail")} role="status">
            {props.msg}
          </p>
        ) : null}

        {view === "advanced" ? (
          advanced
        ) : view === "detail" && detailId ? (
          <ConnectAppDetail id={detailId} {...detailProps} />
        ) : (
          <>
            {sheetForm ? (
              <div className="connect-apps-narrow-meta">
                <button type="button" className="connect-apps-count" onClick={() => setPill("已连接")}>
                  已连接 {connectedIds.length}
                </button>
                {connectedIds.length > 0 ? (
                  <span className="connect-apps-iconstrip" aria-label="已连接的应用">
                    {icons.visible.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="connect-apps-iconbtn"
                        aria-label={`管理 ${connectAppById(id).name}`}
                        onClick={() => openDetail(id)}
                      >
                        <ConnectAppMark id={id} size="sm" />
                      </button>
                    ))}
                    {icons.overflow > 0 ? <span className="connect-apps-iconmore">+{icons.overflow}</span> : null}
                  </span>
                ) : null}
              </div>
            ) : null}

            {sheetForm ? (
              <SearchField
                aria-label="搜索应用"
                value={query}
                onChange={setQuery}
                placeholder="搜索应用"
                className="connect-apps-search connect-apps-search--touch"
              />
            ) : null}

            <div className="connect-apps-pills" role="tablist" aria-label="应用分类">
              {CONNECT_APP_PILLS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={pill === item}
                  className={cn("connect-apps-pill", pill === item && "is-active")}
                  onClick={() => setPill(item)}
                >
                  {item}
                  {item === "已连接" ? <span className="connect-apps-pill-count">{connectedIds.length}</span> : null}
                </button>
              ))}
            </div>

            {showRecommended ? (
              <section className="connect-apps-recommended" aria-label="推荐" data-testid="connect-apps-recommended">
                <h3>推荐</h3>
              </section>
            ) : null}

            {filtered.length === 0 ? (
              <div className="connect-apps-empty">
                <p>没有匹配的应用</p>
                <Button
                  type="button"
                  variant="outline"
                  size={sheetForm ? "default" : "sm"}
                  onClick={() => {
                    setQuery("");
                    setPill("全部");
                  }}
                >
                  清除筛选
                </Button>
              </div>
            ) : (
              <ul className={cn("connect-apps-list", sheetForm && "settings-hub-card")}>
                {filtered.map((app) => {
                  const linked = connected.has(app.id);
                  const err = providerLoadError(app.id, props);
                  return (
                    <li key={app.id} className="connect-apps-row" data-app={app.id}>
                      <button type="button" className="connect-apps-row-main" onClick={() => openDetail(app.id)}>
                        <ConnectAppMark id={app.id} />
                        <span className="connect-apps-row-copy">
                          <span className="connect-apps-row-name">{app.name}</span>
                          <span className="connect-apps-row-blurb">{app.blurb}</span>
                          {err ? <span className="connect-apps-row-error">{err}</span> : null}
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant={linked ? "outline" : "primary"}
                        size="sm"
                        className={cn("connect-apps-row-action", sheetForm && "connect-apps-row-action--touch")}
                        disabled={props.busy}
                        aria-busy={props.busy || undefined}
                        onClick={() => openDetail(app.id)}
                      >
                        {linked ? "管理" : "连接"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            {sheetForm ? (
              <button
                type="button"
                className="connect-apps-advanced-row settings-hub-card"
                onClick={() => {
                  onRevealAdvanced();
                  setView("advanced");
                }}
              >
                高级：手动添加 MCP
              </button>
            ) : (
              <section className="connect-apps-advanced">
                <button
                  type="button"
                  className="connect-apps-advanced-toggle"
                  aria-expanded={advancedOpen}
                  onClick={() => {
                    setAdvancedOpen((open) => {
                      const next = !open;
                      if (next) onRevealAdvanced();
                      return next;
                    });
                  }}
                >
                  高级：手动添加 MCP
                </button>
                {advancedOpen ? <div className="connect-apps-advanced-body">{advanced}</div> : null}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
