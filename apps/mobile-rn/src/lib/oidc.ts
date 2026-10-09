/**
 * Casdoor OIDC 登录。
 *
 * Web 端可以把整页跳到 Casdoor 再跳回来，RN 不行 —— 它没有地址栏，
 * 只能在系统浏览器会话里授权，靠 URL scheme 把结果接回来：
 *
 *   fetchOIDCConfig  判断后端有没有开 OIDC（没开就不显示入口）
 *        ↓
 *   startOIDCLogin   取 authorize_url + state
 *        ↓
 *   openAuthSessionAsync  系统浏览器授权，授权完自动跳回本应用的 scheme
 *        ↓
 *   解析 code / state → exchangeOIDCCode 换成本地 JWT
 *
 * 写盘不在这里做：调用方拿到 `{token, user}` 后走 `@/api/session` 的 `setSession`，
 * 和密码登录共用同一条落盘路径。
 */

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import * as api from "@/api";
import type { OIDCConfig, User } from "@/api/types";

/**
 * 用户主动关掉了系统浏览器里的授权页。
 *
 * 单独一个错误类型，而不是让调用方去匹配错误字符串：登录页据此安静地收起
 * loading 而不弹红字 —— 用户取消不是出错。
 */
export class OIDCLoginCancelled extends Error {
  constructor() {
    super("已取消登录");
    this.name = "OIDCLoginCancelled";
  }
}

/** 服务端 Casdoor 没配好，登录页本就不该出现这个入口。 */
export class OIDCNotEnabled extends Error {
  constructor() {
    super("服务端未启用 OIDC 登录");
    this.name = "OIDCNotEnabled";
  }
}

/**
 * 后端是否启用了 OIDC。登录页据此决定要不要显示「用 Casdoor 登录」。
 *
 * 读不到就当没启用，和 Web 端一致：探测失败时少一个按钮，比多一个点了
 * 必定失败的按钮要好。
 */
export async function isOIDCEnabled(): Promise<boolean> {
  try {
    return (await api.fetchOIDCConfig()).enabled === true;
  } catch {
    return false;
  }
}

/**
 * 授权结束后用来把用户弹回本应用的地址。
 *
 * 优先用后端下发的 `redirect_uri`：authorize_url 是服务端拼的，浏览器最终
 * 跳去的就是它，这里必须和它对齐，否则授权页跳回来了也接不住。
 * 只有当它还是 Web 端的默认值（http://…），也就是 OIDC 压根没给移动端配过，
 * 才退回本应用自己的 scheme。
 */
function redirectURIFor(config: OIDCConfig): string {
  const configured = config.redirect_uri?.trim();
  if (configured && !/^https?:\/\//i.test(configured)) return configured;
  return Linking.createURL("/auth/callback");
}

/**
 * 取回调 URL 上的 query 参数。
 *
 * 不用 `new URL()`：RN 内置的 URL 是个残缺的 WHATWG 子集，在自定义 scheme 上
 * 解析 query 并不可靠。这里手写二十行，行为完全可控。
 */
function parseCallbackQuery(url: string): Record<string, string> {
  const mark = url.indexOf("?");
  if (mark < 0) return {};
  const params: Record<string, string> = {};
  // OIDC 的 query 是 RFC 3986 编码，不是 form 编码，`+` 不代表空格，不要替换。
  for (const pair of url
    .slice(mark + 1)
    .split("#")[0]
    .split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? "" : pair.slice(eq + 1);
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch {
      // 转义序列坏了就留原样，交给上层判空
      params[key] = value;
    }
  }
  return params;
}

/** 走一遍 Casdoor OIDC 登录，成功时返回本地会话。 */
export async function loginWithOIDC(): Promise<{ token: string; user: User }> {
  const config = await api.fetchOIDCConfig();
  if (config.enabled !== true) throw new OIDCNotEnabled();

  const { authorize_url: authorizeURL, state: expectedState } = await api.startOIDCLogin();

  // 不开 ephemeral：默认复用系统浏览器里 Casdoor 的登录态，否则每登一次
  // 都要把账号密码重输一遍。
  const result = await WebBrowser.openAuthSessionAsync(authorizeURL, redirectURIFor(config), {
    preferEphemeralSession: false,
  });

  if (result.type === "success") {
    const params = parseCallbackQuery(result.url);

    // 在 Casdoor 那页点了「取消 / 拒绝」，会以 error 参数回来
    if (params.error) throw new Error(params.error_description || `授权失败：${params.error}`);

    const code = params.code;
    if (!code) throw new Error("回调里没有授权码");

    // 服务端的 state 校验挂在 cookie 上，而 RN 的 fetch 不保证保存 / 回传 cookie，
    // 那段校验可能整段被跳过 —— 所以客户端必须自己比对。
    if (params.state !== expectedState) throw new Error("state 校验失败，请重新发起登录");

    return api.exchangeOIDCCode(code, params.state);
  }

  if (
    result.type === WebBrowser.WebBrowserResultType.CANCEL ||
    result.type === WebBrowser.WebBrowserResultType.DISMISS
  ) {
    throw new OIDCLoginCancelled();
  }

  throw new Error("授权流程异常结束");
}
