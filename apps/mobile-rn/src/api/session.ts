import * as SecureStore from "expo-secure-store";

import type { User } from "./types";

const TOKEN_KEY = "openbot_token";
const USER_KEY = "openbot_user";

/**
 * Web 端用 localStorage，移动端改用 SecureStore（iOS Keychain / Android Keystore）。
 * 内存里再缓存一份，避免每次请求都走一次异步磁盘 IO。
 */
let cachedToken: string | null = null;
let cachedUser: User | null = null;
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  const [token, rawUser] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);
  cachedToken = token;
  if (rawUser) {
    try {
      cachedUser = JSON.parse(rawUser) as User;
    } catch {
      cachedUser = null;
    }
  }
  loaded = true;
}

export async function getToken(): Promise<string | null> {
  await load();
  return cachedToken;
}

export async function getStoredUser(): Promise<User | null> {
  await load();
  return cachedUser;
}

export async function setSession(token: string, user: User): Promise<void> {
  cachedToken = token;
  cachedUser = user;
  loaded = true;
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
  ]);
}

export async function clearSession(): Promise<void> {
  cachedToken = null;
  cachedUser = null;
  loaded = true;
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
