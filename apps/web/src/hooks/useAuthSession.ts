import { useCallback, useMemo, useState } from "react";
import { User, clearSession, getStoredUser, getToken, setSession } from "../api";

export type LogoutOptions = {
  beforeClear?: () => void;
  teardownChat?: () => void;
};

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());

  const authed = useMemo(() => Boolean(token && user), [token, user]);

  const applySession = useCallback((nextToken: string, nextUser: User) => {
    setSession(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const onLogout = useCallback((opts?: LogoutOptions) => {
    opts?.beforeClear?.();
    opts?.teardownChat?.();
    clearSession();
    setToken(null);
    setUser(null);
  }, []);

  return {
    user,
    token,
    authed,
    applySession,
    onLogout,
  };
}
