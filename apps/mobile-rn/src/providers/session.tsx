import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";

import * as api from "@/api";
import { clearSession, getStoredUser, getToken, setSession } from "@/api/session";
import type { User } from "@/api/types";

type SessionState = {
  user: User | null;
  /** 首次从 SecureStore 读盘完成前为 true，用于避免闪一下登录页 */
  restoring: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  /**
   * 接管一份已经在外部拿到的会话（OIDC 回调换回来的 token+user）。
   *
   * 单独提供这个口子，是因为 OIDC 流程在 `lib/oidc.ts` 里自己完成了
   * code → token 交换，登录页拿到的只是结果。如果那里直接调 `setSession`，
   * 内存里的 `user` 不会更新，顶栏会一直显示「?」、返回根路由又会被弹回登录页，
   * 直到重启 App 才对。
   */
  adoptSession: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      const stored = await getStoredUser();
      if (!alive) return;
      // 有 token 就顺手校验一次，失效则清干净回登录页
      if (token) {
        try {
          const me = await api.fetchMe();
          if (alive) setUser(me);
        } catch {
          await clearSession();
        }
      } else {
        setUser(stored);
      }
      if (alive) setRestoring(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const apply = useCallback(
    async (username: string, password: string, mode: "in" | "up") => {
      const res =
        mode === "in"
          ? await api.login(username, password)
          : await api.register(username, password);
      await setSession(res.token, res.user);
      setUser(res.user);
      router.replace("/chats");
    },
    [router]
  );

  const adoptSession = useCallback(
    async (token: string, nextUser: User) => {
      await setSession(token, nextUser);
      setUser(nextUser);
      router.replace("/chats");
    },
    [router]
  );

  const value = useMemo<SessionState>(
    () => ({
      user,
      restoring,
      signIn: (username, password) => apply(username, password, "in"),
      signUp: (username, password) => apply(username, password, "up"),
      adoptSession,
      signOut: async () => {
        await clearSession();
        setUser(null);
        router.replace("/login");
      },
    }),
    [user, restoring, apply, adoptSession, router]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession 必须在 SessionProvider 内使用");
  return ctx;
}
