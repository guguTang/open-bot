import { describe, expect, it } from "vitest";
import {
  CONNECT_APPS,
  type ConnectAppId,
  connectedAppIds,
  filterConnectApps,
  recommendedConnectApps,
  shouldShowRecommendedRail,
  sliceConnectedIcons,
} from "./catalog";

const none = new Set<ConnectAppId>();

describe("connect apps catalog", () => {
  it("lists only the five real providers", () => {
    expect(CONNECT_APPS.map((app) => app.id)).toEqual(["gmail", "slack", "telegram", "feishu", "github"]);
    expect(CONNECT_APPS.map((app) => app.name)).toEqual(["Gmail", "Slack", "Telegram", "飞书", "GitHub"]);
  });

  it("maps 通信 and 代码 without extra apps", () => {
    const comms = filterConnectApps({ query: "", pill: "通信", connected: none });
    const code = filterConnectApps({ query: "", pill: "代码", connected: none });
    expect(comms.map((app) => app.id)).toEqual(["gmail", "slack", "telegram", "feishu"]);
    expect(code.map((app) => app.id)).toEqual(["github"]);
  });

  it("intersects search with the active pill", () => {
    const connected = new Set<ConnectAppId>(["gmail", "github"]);
    expect(
      filterConnectApps({ query: "mail", pill: "全部", connected }).map((app) => app.id),
    ).toEqual(["gmail"]);
    expect(
      filterConnectApps({ query: "仓库", pill: "通信", connected }).map((app) => app.id),
    ).toEqual([]);
    expect(
      filterConnectApps({ query: "git", pill: "代码", connected }).map((app) => app.id),
    ).toEqual(["github"]);
    expect(
      filterConnectApps({ query: "", pill: "已连接", connected }).map((app) => app.id),
    ).toEqual(["gmail", "github"]);
    expect(
      filterConnectApps({ query: "slack", pill: "已连接", connected }).map((app) => app.id),
    ).toEqual([]);
  });

  it("searches name, blurb, and category", () => {
    expect(filterConnectApps({ query: "通信", pill: "全部", connected: none })).toHaveLength(4);
    expect(filterConnectApps({ query: "Bot token", pill: "全部", connected: none }).map((a) => a.id)).toEqual([
      "telegram",
    ]);
    expect(filterConnectApps({ query: "飞书", pill: "全部", connected: none }).map((a) => a.id)).toEqual(["feishu"]);
  });

  it("counts connected providers in catalog order", () => {
    expect(
      connectedAppIds({
        github: { connected: true },
        gmail: { connected: true },
        slack: { connected: false },
        telegram: null,
        feishu: { connected: true },
      }),
    ).toEqual(["gmail", "feishu", "github"]);
    expect(
      connectedAppIds({ gmail: null, slack: null, telegram: null, feishu: null, github: null }),
    ).toEqual([]);
  });

  it("does not show a recommended rail when nothing is flagged", () => {
    expect(recommendedConnectApps()).toEqual([]);
    expect(shouldShowRecommendedRail(true)).toBe(false);
    expect(shouldShowRecommendedRail(false)).toBe(false);
    expect(
      shouldShowRecommendedRail(true, [{ ...CONNECT_APPS[0], recommended: true }]),
    ).toBe(true);
    expect(
      shouldShowRecommendedRail(false, [{ ...CONNECT_APPS[0], recommended: true }]),
    ).toBe(false);
  });

  it("overflows connected icons past one row", () => {
    const ids = connectedAppIds({
      gmail: { connected: true },
      slack: { connected: true },
      telegram: { connected: true },
      feishu: { connected: true },
      github: { connected: true },
    });
    expect(sliceConnectedIcons(ids, 8)).toEqual({ visible: ids, overflow: 0 });
    expect(sliceConnectedIcons(ids, 3)).toEqual({
      visible: ["gmail", "slack", "telegram"],
      overflow: 2,
    });
  });
});
