import type { useAuthSession } from "../../hooks/useAuthSession";
import { ApiServerField } from "../ApiServerField";

export function AuthPage({ auth }: { auth: ReturnType<typeof useAuthSession> }) {
  const {
    authMode,
    setAuthMode,
    authUser,
    setAuthUser,
    authPass,
    setAuthPass,
    authError,
    authBusy,
    oidcEnabled,
    onAuth,
    onCasdoorLogin,
  } = auth;

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onAuth}>
        <div className="brand auth-brand">
          <div className="logo">◈</div>
          <div>
            <div className="brand-title">open-bot</div>
            <div className="brand-sub">登录后使用自定义 LLM</div>
          </div>
        </div>
        <div className="auth-tabs">
          <button
            type="button"
            className={authMode === "login" ? "active" : ""}
            onClick={() => setAuthMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={authMode === "register" ? "active" : ""}
            onClick={() => setAuthMode("register")}
          >
            注册
          </button>
        </div>
        <label>
          用户名
          <input
            value={authUser}
            onChange={(e) => setAuthUser(e.target.value)}
            autoComplete="username"
            required
            minLength={2}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={authPass}
            onChange={(e) => setAuthPass(e.target.value)}
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            required
            minLength={4}
          />
        </label>
        {authError ? <div className="auth-error">{authError}</div> : null}
        <button type="submit" className="primary" disabled={authBusy}>
          {authBusy ? "请稍候…" : authMode === "login" ? "登录" : "注册"}
        </button>
        {oidcEnabled && authMode === "login" ? (
          <>
            <div className="auth-divider muted small">或</div>
            <button type="button" className="settings-btn" disabled={authBusy} onClick={() => void onCasdoorLogin()}>
              用 Casdoor 登录
            </button>
          </>
        ) : null}
        <ApiServerField variant="login" />
      </form>
    </div>
  );
}
