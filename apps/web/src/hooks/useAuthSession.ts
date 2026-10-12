import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  User,
  clearSession,
  fetchOIDCConfig,
  getStoredUser,
  getToken,
  login,
  register,
  setSession,
  startOIDCLogin,
} from "../api";

export type AuthMode = "login" | "register";

export type LogoutOptions = {
  beforeClear?: () => void;
  teardownChat?: () => void;
};

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);

  const authed = useMemo(() => Boolean(token && user), [token, user]);

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
        setSession(res.token, res.user);
        setToken(res.token);
        setUser(res.user);
        setAuthPass("");
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : String(err));
      } finally {
        setAuthBusy(false);
      }
    },
    [authMode, authUser, authPass],
  );

  const onLogout = useCallback((opts?: LogoutOptions) => {
    opts?.beforeClear?.();
    opts?.teardownChat?.();
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  return {
    user,
    setUser,
    token,
    setToken,
    authMode,
    setAuthMode,
    authUser,
    setAuthUser,
    authPass,
    setAuthPass,
    authError,
    authBusy,
    oidcEnabled,
    authed,
    onAuth,
    onCasdoorLogin,
    onLogout,
  };
}
