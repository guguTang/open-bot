import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  User,
  fetchOIDCConfig,
  login,
  register,
  startOIDCLogin,
} from "../../api";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
          <CardHeader className="flex-row items-center gap-3 p-0">
            <div
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-md bg-accent font-semibold text-accent-foreground"
            >
              ob
            </div>
            <div className="flex flex-col">
              <CardTitle>open-bot</CardTitle>
              <CardDescription>登录后使用自定义 LLM</CardDescription>
            </div>
          </CardHeader>

          <Tabs
            value={authMode}
            onValueChange={(k) => setAuthMode(k === "register" ? "register" : "login")}
            className="w-full"
          >
            <TabsList aria-label="登录或注册" className="w-full">
              <TabsTrigger value="login" className="flex-1">
                登录
              </TabsTrigger>
              <TabsTrigger value="register" className="flex-1">
                注册
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-username">用户名</Label>
            <Input
              id="auth-username"
              name="username"
              required
              minLength={2}
              autoComplete="username"
              value={authUser}
              onChange={(e) => setAuthUser(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-password">密码</Label>
            <Input
              id="auth-password"
              name="password"
              type="password"
              required
              minLength={4}
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              value={authPass}
              onChange={(e) => setAuthPass(e.target.value)}
            />
          </div>

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
              <Button variant="outline" fullWidth isDisabled={authBusy} onClick={() => void onCasdoorLogin()}>
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
