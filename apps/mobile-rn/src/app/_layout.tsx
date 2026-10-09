import { Stack } from "expo-router";
import { HeroUINativeProvider, type HeroUINativeConfig } from "heroui-native";
import type { JSX } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ConfirmProvider } from "@/components/ConfirmDialog";
import { SecretPromptProvider } from "@/providers/secretPrompt";
import { SessionProvider } from "@/providers/session";

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

export default function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={config}>
        <SessionProvider>
          {/* ConfirmProvider 必须挂 —— 所有破坏性操作都走 useConfirm()，缺了会直接 throw */}
          <ConfirmProvider>
            {/* 密钥授权是全局的：助手随时可能发起请求，和当前在哪个页面无关 */}
            <SecretPromptProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="login" />
                <Stack.Screen name="chats" />
                <Stack.Screen name="collab" />
                <Stack.Screen name="settings" />
              </Stack>
            </SecretPromptProvider>
          </ConfirmProvider>
        </SessionProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
