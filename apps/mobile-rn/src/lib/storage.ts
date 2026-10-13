/**
 * 存储分层。
 *
 * | 数据            | 存储                | 理由                                          |
 * | --------------- | ------------------- | --------------------------------------------- |
 * | JWT             | `expo-secure-store` | Keychain / Keystore，不进明文存储，且不可备份 |
 * | 偏好（折叠、引导标记、上次打开、当前 Bot） | AsyncStorage + 内存镜像 | 非机密、Expo Go 可用；读走内存保持同步契约 |
 *
 * 早期版本把偏好也塞进了 SecureStore，那是对的 SecureStore 位置被浪费了：
 * 它每次读写都走系统加密存储，为「助手列表要不要折叠」这种数据付出
 * Keychain 往返的代价不划算，而且偏好数据本来也不需要加密。
 *
 * 也曾用 `react-native-mmkv`（同步、快），但它依赖 NitroModules，
 * **Expo Go 跑不了**。改成 AsyncStorage 后偏好在 Expo Go 里也能落盘。
 *
 * AsyncStorage 本身是异步的；这一层用内存 Map 做镜像，对外仍是同步
 * `readJson` / `writeJson`。启动时调用 `hydratePrefs()` 灌一次盘，
 * 之后读同一次 render 就能拿到值，避免闪一帧默认值。
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const memory = new Map<string, string>();

let hydrated = false;
let hydratePromise: Promise<void> | null = null;

export function isPrefsHydrated(): boolean {
  return hydrated;
}

/**
 * 从 AsyncStorage 灌入内存。应在根布局里 await 完成后再渲染主树，
 * 并触发 zustand persist.rehydrate / API base 重读。
 */
export function hydratePrefs(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      if (keys.length > 0) {
        const pairs = await AsyncStorage.multiGet(keys);
        for (const [key, value] of pairs) {
          if (value != null) memory.set(key, value);
        }
      }
    } catch (err) {
      console.warn("[storage] AsyncStorage hydrate failed", err);
    } finally {
      hydrated = true;
    }
  })();

  return hydratePromise;
}

/** 读取并反序列化。解析失败返回兜底值，不抛 —— 坏数据不该让设置页白屏。 */
export function readJson<T>(key: string, fallback: T): T {
  const raw = memory.get(key);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    memory.set(key, raw);
    void AsyncStorage.setItem(key, raw).catch(() => {
      /* 写不进去最多是「偏好不生效」，不该把调用方一起拖崩 */
    });
  } catch {
    /* 序列化失败同上 */
  }
}

export function removeKey(key: string): void {
  memory.delete(key);
  void AsyncStorage.removeItem(key).catch(() => {
    /* 同上 */
  });
}

/** 偏好是否落盘。AsyncStorage 在 Expo Go / dev build 都可用，恒为 true。 */
export function isPersistent(): boolean {
  return true;
}
