/**
 * 连接应用市场目录。一期只收录已有真实连接能力的 provider。
 * 不打 `recommended`：推荐横滑在没有任何标记时整块不渲染。
 */

export const CONNECT_APP_IDS = ["gmail", "slack", "telegram", "feishu", "github"] as const;

export type ConnectAppId = (typeof CONNECT_APP_IDS)[number];

export type ConnectAppCategory = "通信" | "代码";

export type ConnectAppPill = "全部" | "已连接" | "通信" | "代码";

export const CONNECT_APP_PILLS: readonly ConnectAppPill[] = ["全部", "已连接", "通信", "代码"];

export type ConnectAppDef = {
  id: ConnectAppId;
  name: string;
  blurb: string;
  category: ConnectAppCategory;
  /** 仅 true 时进入推荐横滑。一期故意不标记。 */
  recommended?: boolean;
};

export const CONNECT_APPS: readonly ConnectAppDef[] = [
  {
    id: "gmail",
    name: "Gmail",
    blurb: "确认后发信，并按需搜索、阅读邮件摘要。",
    category: "通信",
  },
  {
    id: "slack",
    name: "Slack",
    blurb: "安装到工作区，消息进来时唤醒例行任务。",
    category: "通信",
  },
  {
    id: "telegram",
    name: "Telegram",
    blurb: "粘贴 Bot token，接收消息并在同一会话回复。",
    category: "通信",
  },
  {
    id: "feishu",
    name: "飞书",
    blurb: "粘贴飞书或 Lark 应用凭据，接收消息并回复。",
    category: "通信",
  },
  {
    id: "github",
    name: "GitHub",
    blurb: "连接仓库事件，自动绑定一条入站 Hook。",
    category: "代码",
  },
];

export type ConnectAppConnection = {
  connected?: boolean;
} | null;

export function connectAppById(id: ConnectAppId): ConnectAppDef {
  const found = CONNECT_APPS.find((app) => app.id === id);
  if (!found) {
    throw new Error(`unknown connect app: ${id}`);
  }
  return found;
}

export function connectedAppIds(status: {
  gmail: ConnectAppConnection;
  slack: ConnectAppConnection;
  telegram: ConnectAppConnection;
  feishu: ConnectAppConnection;
  github: ConnectAppConnection;
}): ConnectAppId[] {
  const ids: ConnectAppId[] = [];
  if (status.gmail?.connected) ids.push("gmail");
  if (status.slack?.connected) ids.push("slack");
  if (status.telegram?.connected) ids.push("telegram");
  if (status.feishu?.connected) ids.push("feishu");
  if (status.github?.connected) ids.push("github");
  return ids;
}

/** 搜索 ∩ 当前 pill。品类名也参与搜索。 */
export function filterConnectApps(
  input: {
    query: string;
    pill: ConnectAppPill;
    connected: ReadonlySet<ConnectAppId>;
  },
  apps: readonly ConnectAppDef[] = CONNECT_APPS,
): ConnectAppDef[] {
  const q = input.query.trim().toLowerCase();
  return apps.filter((app) => {
    if (input.pill === "已连接" && !input.connected.has(app.id)) return false;
    if (input.pill === "通信" && app.category !== "通信") return false;
    if (input.pill === "代码" && app.category !== "代码") return false;
    if (!q) return true;
    const hay = `${app.name} ${app.blurb} ${app.category} ${app.id}`.toLowerCase();
    return hay.includes(q);
  });
}

/** 没有 recommended 标记时返回空数组，调用方不得渲染推荐轨。 */
export function recommendedConnectApps(apps: readonly ConnectAppDef[] = CONNECT_APPS): ConnectAppDef[] {
  return apps.filter((app) => app.recommended === true);
}

export function shouldShowRecommendedRail(hasMatches: boolean, apps: readonly ConnectAppDef[] = CONNECT_APPS): boolean {
  return hasMatches && recommendedConnectApps(apps).length > 0;
}

export function sliceConnectedIcons(ids: readonly ConnectAppId[], maxVisible: number): {
  visible: ConnectAppId[];
  overflow: number;
} {
  const cap = Math.max(0, maxVisible);
  if (ids.length <= cap) return { visible: [...ids], overflow: 0 };
  return { visible: ids.slice(0, cap), overflow: ids.length - cap };
}
