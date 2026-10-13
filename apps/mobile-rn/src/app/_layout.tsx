import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { HeroUINativeProvider, type HeroUINativeConfig } from "heroui-native";
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { reloadApiBaseFromStorage } from "@/api/config";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { hydratePrefs } from "@/lib/storage";
import { queryClient } from "@/queries/client";
import { RealtimeProvider } from "@/providers/realtime";
import { SecretPromptProvider } from "@/providers/secretPrompt";
import { SessionProvider } from "@/providers/session";
import { useCurrentBot, useListPrefs } from "@/stores/client";

import "../global.css";

/**
 * 配置必须定义在组件外 —— 内联对象每次渲染都是新引用，会让 Provider 重新初始化。
 *
 * stylingPrinciples 关掉的是 HeroUI 的样式约定提示条。它不是告警，
 * 只是把官方那条「className 优先、style 可覆盖、动画属性另有通道」的说明
 * 打进控制台；本项目的约定已经写进 ScreenScaffold 等处的注释和 global.css，
 * 没必要每次启动都刷一遍。
 */
const config: HeroUINativeConfig = {
  devInfo: {
    stylingPrinciples: false,
  },
};

/**
 * 等 AsyncStorage → 内存镜像灌完，再重读 API base、rehydrate zustand。
 * 否则首帧会先用默认值，偏好（含服务器地址覆盖）要晚一拍才生效。
 */
function PrefsHydrationGate({ children }: { children: ReactNode }): JSX.Element | null {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      await hydratePrefs();
      reloadApiBaseFromStorage();
      await Promise.all([useCurrentBot.persist.rehydrate(), useListPrefs.persist.rehydrate()]);
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}

export default function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={config}>
        <PrefsHydrationGate>
          {/* QueryClientProvider 必须包在 SessionProvider 里面：
              查询要用 JWT，登录态要先就位。 */}
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              {/* ConfirmProvider 必须挂 —— 所有破坏性操作都走 useConfirm()，缺了会直接 throw */}
              <ConfirmProvider>
                {/* 全局实时通道：在线绿点、presence、跨端表情、群聊他人回复 */}
                <RealtimeProvider>
                  {/* 密钥授权是全局的：助手随时可能发起请求，和当前在哪个页面无关 */}
                  <SecretPromptProvider>
                    <Stack screenOptions={{ headerShown: false }}>
                      <Stack.Screen name="login" />
                      <Stack.Screen name="chats" />
                      <Stack.Screen name="collab" />
                      <Stack.Screen name="settings" />
                      <Stack.Screen name="train" />
                    </Stack>
                  </SecretPromptProvider>
                </RealtimeProvider>
              </ConfirmProvider>
            </SessionProvider>
          </QueryClientProvider>
        </PrefsHydrationGate>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
