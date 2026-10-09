import { Button, FieldError, Input, Spinner, TextField, Typography } from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { Icon } from "@/components/Icon";
import { useSession } from "@/providers/session";

/**
 * 登录 / 注册。
 *
 * 三个刻意的选择：
 * - 不套 Card。整屏本来就空，再浮一个盒子只是把两条输入框装进框里，
 *   并不能帮用户理解这是什么。
 * - 字段不挂可见 label，靠 placeholder + `accessibilityLabel` 表达。
 *   两个字段（用户名 / 密码）本身就说明了要填什么。
 * - 页脚不显示 API 地址。那是部署配置，不是登录信息。
 */
export default function LoginScreen(): JSX.Element {
  const router = useRouter();
  const { signIn, signUp, user, restoring } = useSession();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!restoring && user) {
    router.replace("/chats");
  }

  async function submit(): Promise<void> {
    if (busy) return;
    if (!username.trim() || !password) {
      setError("请填写用户名和密码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (mode === "in" ? signIn(username.trim(), password) : signUp(username.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-center px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-9 pb-safe">
          <View className="gap-3">
            <View className="size-12 items-center justify-center rounded-2xl bg-accent">
              <Icon name="flash" size={24} tone="accent-foreground" />
            </View>
            <View className="gap-1.5">
              <Typography.Heading type="h2">Open Bot</Typography.Heading>
              <Typography.Paragraph color="muted" className="text-sm">
                登录后即可与你的助手对话
              </Typography.Paragraph>
            </View>
          </View>

          <View className="gap-4">
            <TextField isInvalid={Boolean(error)}>
              <Input
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="用户名"
                accessibilityLabel="用户名"
                returnKeyType="next"
              />
            </TextField>

            <TextField isInvalid={Boolean(error)}>
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="密码"
                accessibilityLabel="密码"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
              {error ? <FieldError isInvalid>{error}</FieldError> : null}
            </TextField>
          </View>

          <View className="gap-2">
            <Button size="lg" onPress={() => void submit()} isDisabled={busy}>
              {busy ? <Spinner size="sm" /> : null}
              <Button.Label>{mode === "in" ? "登录" : "注册并登录"}</Button.Label>
            </Button>

            <Button
              variant="ghost"
              onPress={() => {
                setMode(mode === "in" ? "up" : "in");
                setError(null);
              }}
            >
              <Button.Label>
                {mode === "in" ? "还没有账号？去注册" : "已有账号？去登录"}
              </Button.Label>
            </Button>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}