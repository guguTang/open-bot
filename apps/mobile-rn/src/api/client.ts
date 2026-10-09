import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { ClientApp, ClientContext, ClientPlatform } from "./types";

const APP_VERSION = (Constants.expoConfig?.version as string | undefined) ?? "0.1.0";

/**
 * 客户端环境信封。对应 `apps/web/src/lib/clientEnv.ts`。
 *
 * Web 端靠 UA 嗅探 Tauri / Capacitor；RN 端不需要嗅探——它天生就是原生客户端。
 * 所以这里直接把 `Platform.OS` 映射成后端认识的 platform，并把 `app` 标成 `expo`
 * （后端枚举里没有 expo，但 `ClientApp` 是 string，Prompt 侧按未知值降级即可）。
 *
 * capabilities 与 Web 保持一致：host_tools 目前仍是 false（本机工具未接线），
 * 谎报 true 会让模型开始调用还没实现的 host_* 工具。
 */

function detectPlatform(): ClientPlatform {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  // Expo web（pnpm start 后按 w 键）走这里，对齐 Web 端的 web 语义
  return "web";
}

function detectOs(): string {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "macos") return "darwin";
  if (Platform.OS === "windows") return "win32";
  return Platform.OS;
}

function detectArch(): string {
  // RN 在 JS 层拿不到 CPU 架构（没有 navigator.userAgent / navigator.platform）。
  // Hermes 下 Intl 也不暴露架构信息，只能按平台给个大概率值。
  // 这个字段只用于 Prompt 里描述环境，猜错不影响功能。
  if (Platform.OS === "ios") return "arm64";
  if (Platform.OS === "android") return "arm64";
  return "";
}

function detectLocale(): string {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale;
    if (l) return l;
  } catch {
    /* Hermes 未开 Intl 时退回默认值 */
  }
  return "zh-CN";
}

/** RN 端固定为原生客户端；Expo web 也算（它就是浏览器）。 */
function detectApp(platform: ClientPlatform): ClientApp {
  return platform === "web" ? "browser" : "expo";
}

let cached: ClientContext | null = null;

/** 每次调用都很便宜，但缓存一下避免在渲染路径里反复构造对象。 */
export function detectClientContext(): ClientContext {
  if (cached) return cached;

  const platform = detectPlatform();
  cached = {
    platform,
    app: detectApp(platform),
    os: detectOs(),
    arch: detectArch(),
    app_version: APP_VERSION,
    locale: detectLocale(),
    capabilities: { host_tools: false, workspace_tools: true },
  };
  return cached;
}

/* ------------------------------------------------------------------ 本机登记 */

const MACHINE_KEY_STORAGE = "openbot_machine_key";
const MACHINE_ID_STORAGE = "openbot_machine_id";

/**
 * 每次安装的稳定机器标识，用于 `/v1/machines/register`。
 * 存 SecureStore 而不是 AsyncStorage——和 JWT 同等级对待，卸载前不该被轻易读到。
 */
let cachedKey: string | null = null;

export async function getOrCreateMachineKey(): Promise<string> {
  if (cachedKey) return cachedKey;

  const stored = await secureGet(MACHINE_KEY_STORAGE);
  if (stored && stored.trim()) {
    cachedKey = stored.trim();
    return cachedKey;
  }
  const key = makeUuid();
  await secureSet(MACHINE_KEY_STORAGE, key);
  cachedKey = key;
  return key;
}

export async function getStoredMachineId(): Promise<string | null> {
  return secureGet(MACHINE_ID_STORAGE);
}

export async function setStoredMachineId(id: string): Promise<void> {
  await secureSet(MACHINE_ID_STORAGE, id);
}

export async function clearStoredMachineId(): Promise<void> {
  cachedKey = null;
  await secureDelete(MACHINE_ID_STORAGE);
}

export function shouldRegisterAsHost(client: ClientContext = detectClientContext()): boolean {
  // Expo web 只是浏览器，不该登记成本机
  return client.platform === "ios" || client.platform === "android";
}

export function defaultMachineLabel(client: ClientContext): string {
  switch (client.platform) {
    case "ios":
      return "我的 iOS 设备";
    case "android":
      return "我的 Android 设备";
    case "macos":
      return "我的 Mac";
    case "windows":
      return "我的 Windows 电脑";
    case "linux":
      return "我的 Linux 电脑";
    default:
      return "本机";
  }
}

/* ------------------------------------------------------------------ SecureStore 薄封装 */

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* 读不到就当没存过，不阻断登录 */
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

function makeUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  // crypto.randomUUID 在 RN 上不一定可用，退回时间戳 + 随机串
  const rand = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return `mk-${Date.now().toString(16)}-${rand()}${rand()}`;
}
