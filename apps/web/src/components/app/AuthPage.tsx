import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  User,
  fetchOIDCConfig,
  login,
  register,
  startOIDCLogin,
} from "../../api";
import { Button, Card, Input, Label, Separator, Tabs, TextField } from "@heroui/react";
import { ApiServerField } from "../ApiServerField";

type AuthMode = "login" | "register";

export function AuthPage({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, user: User) => void;
}) {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOIDCConfig()
      .then((c) => {
        if (!cancelled) setOidcEnabled(Boolean(c.enabled));
      })
      .catch(() => {
        if (!cancelled) setOidcEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onCasdoorLogin = useCallback(async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const { authorize_url } = await startOIDCLogin();
      window.location.href = authorize_url;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
      setAuthBusy(false);
    }
  }, []);

  const onAuth = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setAuthBusy(true);
      setAuthError("");
      try {
        const fn = authMode === "login" ? login : register;
        const res = await fn(authUser.trim(), authPass);
        onAuthenticated(res.token, res.user);
        setAuthPass("");
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : String(err));
      } finally {
        setAuthBusy(false);
      }
    },
    [authMode, authUser, authPass, onAuthenticated],
  );

  return (
    <main className="grid min-h-full place-items-center bg-background p-6">
      <Card className="w-[min(400px,100%)] p-6">
        <form className="flex flex-col gap-4" onSubmit={onAuth}>
          <Card.Header className="flex-row items-center gap-3 p-0">
            <div
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-md bg-accent font-semibold text-accent-foreground"
            >
              ob
            </div>
            <div className="flex flex-col">
              <Card.Title>open-bot</Card.Title>
              <Card.Description>登录后使用自定义 LLM</Card.Description>
            </div>
          </Card.Header>

          <Tabs
            selectedKey={authMode}
            onSelectionChange={(k) => setAuthMode(k === "register" ? "register" : "login")}
            className="w-full"
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="登录或注册" className="w-full">
                <Tabs.Tab id="login" className="flex-1">
                  登录
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="register" className="flex-1">
                  注册
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          <TextField isRequired name="username" value={authUser} onChange={setAuthUser} minLength={2}>
            <Label>用户名</Label>
            <Input variant="secondary" autoComplete="username" />
          </TextField>
          <TextField
            isRequired
            name="password"
            type="password"
            value={authPass}
            onChange={setAuthPass}
            minLength={4}
          >
            <Label>密码</Label>
            <Input variant="secondary" autoComplete={authMode === "login" ? "current-password" : "new-password"} />
          </TextField>

          {authError ? (
            <p role="alert" className="text-sm text-danger">
              {authError}
            </p>
          ) : null}

          <Button type="submit" fullWidth isPending={authBusy}>
            {authBusy ? "请稍候…" : authMode === "login" ? "登录" : "注册"}
          </Button>

          {oidcEnabled && authMode === "login" ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted">
                <Separator className="flex-1" />
                或
                <Separator className="flex-1" />
              </div>
              <Button variant="outline" fullWidth isDisabled={authBusy} onPress={() => void onCasdoorLogin()}>
                用 Casdoor 登录
              </Button>
            </>
          ) : null}

          <ApiServerField variant="login" />
        </form>
      </Card>
    </main>
  );
}
