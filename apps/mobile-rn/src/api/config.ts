import { Platform } from "react-native";

/**
 * 后端地址。优先级：EXPO_PUBLIC_OPENBOT_API_BASE > 平台默认。
 *
 * - iOS 模拟器 / web：`127.0.0.1` 直连宿主机
 * - Android 模拟器：宿主机是 `10.0.2.2`，`127.0.0.1` 指向模拟器自己
 * - 真机：两者都不通，必须在 `.env` 里写电脑的局域网 IP，例如
 *   `EXPO_PUBLIC_OPENBOT_API_BASE=http://192.168.1.23:18080`
 *   改完要重启 Metro（`pnpm start -c`）才会重新注入。
 */
const DEFAULT_API_BASE =
  Platform.OS === "android" ? "http://10.0.2.2:18080" : "http://127.0.0.1:18080";

export const API_BASE = (
  process.env.EXPO_PUBLIC_OPENBOT_API_BASE?.trim() || DEFAULT_API_BASE
).replace(/\/+$/, "");
