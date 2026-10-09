import { Redirect } from "expo-router";
import { Spinner, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { View } from "react-native";

import { useSession } from "@/providers/session";

export default function Index(): JSX.Element {
  const { user, restoring } = useSession();
  const color = useThemeColor("muted");

  // 从 SecureStore 读盘期间不做重定向，否则会先闪一下登录页
  if (restoring) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner color={color} />
      </View>
    );
  }

  return <Redirect href={user ? "/chats" : "/login"} />;
}
