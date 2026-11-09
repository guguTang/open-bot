import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailIntegrationStatus, InstallIntegrationStatus } from "../../api";
import { ConfirmProvider } from "../ConfirmProvider";
import { ConnectAppsMarket, type ConnectAppsMarketProps } from "./ConnectAppsMarket";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function setInputValue(el: HTMLInputElement, value: string) {
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  proto?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const gmail = {
  provider: "gmail",
  connected: true,
  email: "ada@example.com",
  can_send: true,
  can_read: true,
  oauth_configured: true,
} satisfies GmailIntegrationStatus;

function install(provider: string, connected = false): InstallIntegrationStatus {
  return { provider, connected, oauth_configured: true };
}

function props(overrides: Partial<ConnectAppsMarketProps> = {}): ConnectAppsMarketProps {
  return {
    sheetForm: false,
    focus: null,
    onFocusConsumed: () => {},
    onClose: () => {},
    onRevealAdvanced: () => {},
    advanced: <div>MCP 表单</div>,
    gmail,
    slack: install("slack"),
    github: install("github"),
    telegram: install("telegram"),
    feishu: install("feishu"),
    busy: false,
    loading: false,
    msg: "",
    onConnectGmail: vi.fn(),
    onDisconnectGmail: vi.fn(),
    onConnectSlack: vi.fn(),
    onDisconnectSlack: vi.fn(),
    onConnectGitHub: vi.fn(),
    onAttachGitHub: vi.fn(),
    onDisconnectGitHub: vi.fn(),
    onConnectTelegram: vi.fn(),
    onDisconnectTelegram: vi.fn(),
    onConnectFeishu: vi.fn(),
    onDisconnectFeishu: vi.fn(),
    onCopy: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  installMatchMedia();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

async function renderMarket(overrides: Partial<ConnectAppsMarketProps> = {}) {
  await act(async () => {
    root.render(
      <ConfirmProvider>
        <ConnectAppsMarket {...props(overrides)} />
      </ConfirmProvider>,
    );
  });
}

describe("ConnectAppsMarket", () => {
  it("lists the five real providers and hides the recommended rail", async () => {
    await renderMarket();
    const text = container.textContent || "";
    for (const name of ["Gmail", "Slack", "Telegram", "飞书", "GitHub"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("已连接 1");
    expect(container.querySelector('[data-testid="connect-apps-recommended"]')).toBeNull();
    expect(text).not.toContain("推荐");
    expect(text).not.toContain("模板");
    expect(container.querySelector('[aria-label="Telegram Bot token"]')).toBeNull();
    expect(text).not.toContain("MCP 表单");
  });

  it("filters by search and the 代码 pill", async () => {
    await renderMarket();
    const search = container.querySelector('input[aria-label="搜索应用"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(search, "git");
    });
    expect(container.querySelector('.connect-apps-list [data-app="github"]')).not.toBeNull();
    expect(container.querySelector('.connect-apps-list [data-app="gmail"]')).toBeNull();
    expect(container.querySelector('.connect-apps-list [data-app="slack"]')).toBeNull();

    await act(async () => {
      setInputValue(search, "");
    });
    const code = [...container.querySelectorAll('button[role="tab"]')].find((el) => el.textContent?.startsWith("代码"));
    await act(async () => {
      code?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('.connect-apps-list [data-app="github"]')).not.toBeNull();
    expect(container.querySelector('.connect-apps-list [data-app="gmail"]')).toBeNull();
    expect(container.querySelector('.connect-apps-list [data-app="feishu"]')).toBeNull();
  });

  it("opens the existing Gmail detail from 管理 instead of a catalog form", async () => {
    const onConnectGmail = vi.fn();
    await renderMarket({ onConnectGmail });
    const manage = container.querySelector('[data-app="gmail"] .connect-apps-row-action') as HTMLButtonElement;
    expect(manage.textContent).toContain("管理");
    await act(async () => {
      manage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.textContent).toContain("ada@example.com");
    expect(container.textContent).toContain("断开连接");
    expect(onConnectGmail).not.toHaveBeenCalled();
    expect(container.querySelector('[data-app="slack"]')).toBeNull();
  });

  it("shows an empty state and can clear filters", async () => {
    await renderMarket();
    const search = container.querySelector('input[aria-label="搜索应用"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(search, "不存在的应用zzz");
    });
    expect(container.textContent).toContain("没有匹配的应用");
    const clear = [...container.querySelectorAll("button")].find((el) => el.textContent === "清除筛选");
    await act(async () => {
      clear?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('.connect-apps-list [data-app="gmail"]')).not.toBeNull();
    expect(container.querySelector('.connect-apps-list [data-app="github"]')).not.toBeNull();
  });
});
