/**
 * 存储分层。
 *
 * 分工是社区通行的做法，也和这个项目的数据性质对得上：
 *
 * | 数据            | 存储                | 理由                                          |
 * | --------------- | ------------------- | --------------------------------------------- |
 * | JWT             | `expo-secure-store` | Keychain / Keystore，不进明文存储，且不可备份 |
 * | 偏好（折叠、引导标记、上次打开、当前 Bot） | `react-native-mmkv` | 高频读写的小 JSON，MMKV 同步且比 AsyncStorage 快一个量级 |
 *
 * 早期版本把偏好也塞进了 SecureStore，那是对的 SecureStore 位置被浪费了：
 * 它每次读写都走系统加密存储，为「助手列表要不要折叠」这种数据付出
 * Keychain 往返的代价不划算，而且偏好数据本来也不需要加密。
 *
 * MMKV 是**同步** API，所以这一层的读取不用 await —— 调用点少一次微任务，
 * 状态也能在同一次 render 里拿到，不用来回闪一次。
 *
 * ## ⚠️ MMKV 需要 dev build，Expo Go 跑不了
 *
 * `react-native-mmkv` v4 走 `react-native-nitro-modules`，是**自定义原生模块**。
 * Expo Go 只内置官方模块，装不下它 —— 表现是启动即崩：
 *
 *   Failed to get NitroModules: The native "NitroModules" Turbo/Native-Module
 *   could not be found.
 *
 * 解决办法二选一：
 * 1. **用 dev build**（推荐，MMKV 才能真正工作）：
 *    `npx expo prebuild && npx expo run:ios` / `run:android`，
 *    或者用 EAS Build。本轮引入的 OIDC 登录也需要 dev build
 *    （自定义 scheme 回调 Expo Go 不支持），两者一起解决最省事。
 * 2. **继续用 Expo Go**：下面的降级分支会自动生效，偏好退化为内存存储 ——
 *    同步 API 契约不变、代码一行不用改，但**重启 App 后偏好丢失**。
 *
 * 早期版本在模块顶层直接 `createMMKV()`，Expo Go 下会在 import 阶段就抛错，
 * 整个应用起不来。改成惰性初始化 + 捕获，是因为「开发环境少一个功能」远比
 * 「应用完全打不开」好。
 */

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
  /** 是否真的落盘。false 表示当前是降级的内存实现 */
  persistent: boolean;
};

/**
 * 降级用的内存实现。
 *
 * 用 Map 而不是 AsyncStorage 是因为**这一层对外是同步契约**：
 * zustand persist 的 storage 可以异步，但那样 hydrate 就变成异步的，
 * 页面会先渲染一帧默认值再跳成真实值 —— 正是我们换成 MMKV 要消掉的那个闪烁。
 * 宁可少一个持久化能力，也不把同步 API 换回异步。
 */
function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    persistent: false,
  };
}

let resolved: KeyValueStore | null = null;
let warned = false;

function store(): KeyValueStore {
  if (resolved) return resolved;

  try {
    // 惰性 + 动态 require：模块顶层直接 import 会让 Expo Go 在加载路由时
    // 就因为 NitroModules 缺失而抛错，整个应用起不来。放进 try 里之后，
    // 失败只影响偏好持久化。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require("react-native-mmkv") as typeof import("react-native-mmkv");
    const mmkv = createMMKV({ id: "openbot-prefs" });
    resolved = {
      getString: (key) => mmkv.getString(key),
      set: (key, value) => mmkv.set(key, value),
      // v4 的删除方法叫 remove，不是 v2 的 delete
      remove: (key) => mmkv.remove(key),
      persistent: true,
    };
  } catch {
    resolved = createMemoryStore();
    if (!warned) {
      warned = true;
      console.warn(
        "[storage] react-native-mmkv 不可用（当前是 Expo Go？），偏好数据降级为内存存储，" +
          "重启后丢失。需要持久化请用 dev build：npx expo prebuild && npx expo run:ios"
      );
    }
  }
  return resolved;
}

/** 读取并反序列化。解析失败返回兜底值，不抛 —— 坏数据不该让设置页白屏。 */
export function readJson<T>(key: string, fallback: T): T {
  const raw = store().getString(key);
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
    store().set(key, JSON.stringify(value));
  } catch {
    /* 写不进去最多是「偏好不生效」，不该把调用方一起拖崩 */
  }
}

export function removeKey(key: string): void {
  try {
    store().remove(key);
  } catch {
    /* 同上 */
  }
}

/** 当前偏好是否真的落盘。false = Expo Go 降级模式，重启会丢。 */
export function isPersistent(): boolean {
  return store().persistent;
}
