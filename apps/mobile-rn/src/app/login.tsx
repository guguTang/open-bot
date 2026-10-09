import {
  Button,
  FieldError,
  Input,
  Separator,
  Spinner,
  TextField,
  Typography,
} from "heroui-native";
import { useRouter } from "expo-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";

import { Icon } from "@/components/Icon";
import { OIDCLoginCancelled, isOIDCEnabled, loginWithOIDC } from "@/lib/oidc";
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
 *
 * Casdoor 入口沿用 Web 端的语义：服务端没启用就整个不渲染，而不是置灰。
 * 置灰按钮等于告诉每个用户「有个东西你用不了」，没启用的部署不该看到这个。
 * 同理只在「登录」模式下出现 —— 注册语义是后端密码接口给的，OIDC 没有
 * 「我明确要注册」这回事，它只会按 Casdoor 的账号自动开户。
 */
export default function LoginScreen(): JSX.Element {
  const router = useRouter();
  const { signIn, signUp, adoptSession, user, restoring } = useSession();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // 两份错误分开存：表单的错误要让输入框变红，OIDC 的错误跟输入框无关，
  // 共用一个 state 会出现「点了 Casdoor，密码框变红并显示授权失败」。
  const [formError, setFormError] = useState<string | null>(null);
  const [oidcError, setOidcError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [oidcBusy, setOidcBusy] = useState(false);

  // 静默探测：不影响首屏渲染，探到就多一个入口，探不到就当没这回事
  useEffect(() => {
    let alive = true;
    void isOIDCEnabled().then((on) => {
      if (alive) setOidcEnabled(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 两条路径共用一把锁：系统浏览器会话期间表单按钮也该是禁用的
  const locked = busy || oidcBusy;

  if (!restoring && user) {
    router.replace("/chats");
  }

  async function submit(): Promise<void> {
    if (locked) return;
    if (!username.trim() || !password) {
      setFormError("请填写用户名和密码");
      return;
    }
    setBusy(true);
    setFormError(null);
    setOidcError(null);
    try {
      await (mode === "in" ? signIn(username.trim(), password) : signUp(username.trim(), password));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "请求失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }

  async function submitOIDC(): Promise<void> {
    if (locked) return;
    setOidcBusy(true);
    setOidcError(null);
    setFormError(null);
    try {
      const res = await loginWithOIDC();
      // 交给 provider 落盘并接管：它会同时更新内存里的 user，
      // 否则顶栏会一直显示「?」，返回根路由又会被弹回登录页。
      await adoptSession(res.token, res.user);
    } catch (err) {
      // 用户自己关掉授权页不算错误，静默收起 loading 就行
      if (!(err instanceof OIDCLoginCancelled)) {
        setOidcError(err instanceof Error ? err.message : "OIDC 登录失败，请重试");
      }
    } finally {
      setOidcBusy(false);
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
            <TextField isInvalid={Boolean(formError)}>
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

            <TextField isInvalid={Boolean(formError)}>
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="密码"
                accessibilityLabel="密码"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
              {formError ? <FieldError isInvalid>{formError}</FieldError> : null}
            </TextField>
          </View>

          <View className="gap-2">
            <Button size="lg" onPress={() => void submit()} isDisabled={locked}>
              {busy ? <Spinner size="sm" /> : null}
              <Button.Label>{mode === "in" ? "登录" : "注册并登录"}</Button.Label>
            </Button>

            {oidcEnabled && mode === "in" ? (
              <>
                <View className="flex-row items-center gap-3 py-1">
                  <Separator orientation="vertical" className="flex-1" />
                  <Typography.Paragraph color="muted" className="text-xs">
                    或
                  </Typography.Paragraph>
                  <Separator orientation="vertical" className="flex-1" />
                </View>

                <Button
                  variant="secondary"
                  onPress={() => void submitOIDC()}
                  isDisabled={locked}
                  accessibilityLabel="用 Casdoor 登录"
                >
                  {oidcBusy ? (
                    <Spinner size="sm" />
                  ) : (
                    <Icon name="shield-checkmark-outline" size={18} />
                  )}
                  <Button.Label>{oidcBusy ? "跳转 Casdoor…" : "用 Casdoor 登录"}</Button.Label>
                </Button>

                {oidcError ? <FieldError isInvalid>{oidcError}</FieldError> : null}
              </>
            ) : null}

            <Button
              variant="ghost"
              onPress={() => {
                setMode(mode === "in" ? "up" : "in");
                setFormError(null);
                setOidcError(null);
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
