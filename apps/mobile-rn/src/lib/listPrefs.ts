/**
 * 列表页的轻量偏好：上次打开的助手 / 群聊，以及各分区的折叠状态。
 *
 * 存在 MMKV 而不是 SecureStore：这些是「界面长什么样」的偏好，不是机密，
 * 而且要频繁读写（每次进列表都读）。理由见 `lib/storage.ts` 顶部的分工表。
 *
 * MMKV 是同步 API，所以这里全部是同步函数 —— 调用点少一次 await，
 * 首屏也不用等一次异步读盘。
 */

import { readJson, writeJson } from "@/lib/storage";

const LAST_KEY = "last_opened";
const COLLAPSE_KEY = "list_collapsed";

export type LastOpened = {
  kind: "agent" | "channel";
  id: string;
  name: string;
  conversation_id?: string;
};

export function getLastOpened(): LastOpened | null {
  const v = readJson<LastOpened | null>(LAST_KEY, null);
  if (!v || (v.kind !== "agent" && v.kind !== "channel") || !v.id) return null;
  return v;
}

export function setLastOpened(value: LastOpened): void {
  writeJson(LAST_KEY, value);
}

export function getCollapsed(): Record<string, boolean> {
  return readJson<Record<string, boolean>>(COLLAPSE_KEY, {});
}

export function setCollapsed(map: Record<string, boolean>): void {
  writeJson(COLLAPSE_KEY, map);
}
