import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  User,
  fetchOIDCConfig,
  login,
  register,
  startOIDCLogin,
} from "../../api";
import { cn } from "@/lib/utils";
import { ApiServerField } from "../ApiServerField";

type AuthMode = "login" | "register";

const authInputClass =
  "rounded-[10px] border border-(--border) bg-white px-3 py-2.5 text-(--text) outline-none focus:border-(--accent) focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)]";

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
    <div
      className="grid min-h-full place-items-center bg-[radial-gradient(ellipse_at_20%_0%,rgba(124,58,237,0.1),transparent_50%),radial-gradient(ellipse_at_80%_100%,rgba(167,139,250,0.08),transparent_45%),var(--bg)] p-6"
    >
      <form
        className="flex w-[min(400px,100%)] flex-col gap-3 rounded-2xl border border-(--border) bg-(--bg-elevated) p-6 shadow-(--shadow-md)"
        onSubmit={onAuth}
      >
        <div className="flex items-center gap-2.5 pb-2">
          <div className="grid size-9 place-items-center rounded-[10px] bg-linear-to-br from-(--accent) to-(--accent-2) font-bold text-white">
            ◈
          </div>
          <div>
            <div className="font-bold tracking-[0.02em]">open-bot</div>
            <div className="text-xs text-(--muted)">登录后使用自定义 LLM</div>
          </div>
        </div>
        <div className="mb-1 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            className={cn(
              "cursor-pointer rounded-[10px] border border-(--border) bg-(--bg-soft) p-2 text-(--muted)",
              authMode === "login" && "border-(--accent) bg-white text-(--text)",
            )}
            onClick={() => setAuthMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={cn(
              "cursor-pointer rounded-[10px] border border-(--border) bg-(--bg-soft) p-2 text-(--muted)",
              authMode === "register" && "border-(--accent) bg-white text-(--text)",
            )}
            onClick={() => setAuthMode("register")}
          >
            注册
          </button>
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] text-(--muted)">
          用户名
          <input
            className={authInputClass}
            value={authUser}
            onChange={(e) => setAuthUser(e.target.value)}
            autoComplete="username"
            required
            minLength={2}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-(--muted)">
          密码
          <input
            className={authInputClass}
            type="password"
            value={authPass}
            onChange={(e) => setAuthPass(e.target.value)}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            required
            minLength={4}
          />
        </label>
        {authError ? <div className="text-[13px] text-(--danger)">{authError}</div> : null}
        <button
          type="submit"
          className="cursor-pointer rounded-xl border-none bg-(--accent) px-3.5 py-2.5 text-white disabled:opacity-55"
          disabled={authBusy}
        >
          {authBusy ? "请稍候…" : authMode === "login" ? "登录" : "注册"}
        </button>
        {oidcEnabled && authMode === "login" ? (
          <>
            <div className="my-1 mb-0 text-center text-xs text-(--muted)">或</div>
            <button
              type="button"
              className="w-full cursor-pointer rounded-[10px] border border-(--border) bg-(--bg-soft) px-3 py-2.5 text-(--text) hover:bg-(--bg-hover) disabled:opacity-55"
              disabled={authBusy}
              onClick={() => void onCasdoorLogin()}
            >
              用 Casdoor 登录
            </button>
          </>
        ) : null}
        <ApiServerField variant="login" />
      </form>
    </div>
  );
}
