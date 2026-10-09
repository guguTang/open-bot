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
import type { BotSecretRequest } from "@/api/types";
import { SecretPromptModal } from "@/components/SecretPromptModal";
import { useSession } from "@/providers/session";

type SecretPromptContextValue = {
  /** 手动拉一次待授权请求（发消息后立即调用，避免等轮询） */
  refresh: () => Promise<void>;
};

const SecretPromptContext = createContext<SecretPromptContextValue | null>(null);

const POLL_MS = 8000;

/**
 * 全局密钥授权弹窗。
 *
 * 助手在对话里调用 `request_secret` 时，服务端会挂起一条待授权请求。这件事
 * 和当前在哪个页面无关 —— 用户可能在聊天页，也可能在设置页翻密钥列表。
 * 所以这里做成全局 provider 轮询，和 Web 端 `App.tsx` 里的全局
 * `SecretPromptModal` 同构（抢占式弹窗）。
 *
 * 设置页里的内联处理是补充，不是替代：这里只处理「用户不在密钥页时」的拦截。
 */
export function SecretPromptProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useSession();
  const [request, setRequest] = useState<BotSecretRequest | null>(null);

  // `refresh` 直接依赖 user：定时器随之在登录/登出时重建，
  // 避免用 ref 在渲染期同步 user（那会让轮询闭包读到过期的登录态）。
  const refresh = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      const list = await api.listBotSecretRequests();
      const pending = list.find((r) => r.status === "pending") ?? null;
      setRequest(pending);
    } catch {
      // 轮询失败不该打断任何页面，静默跳过这一轮
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [user, refresh]);

  const value = useMemo<SecretPromptContextValue>(() => ({ refresh }), [refresh]);

  return (
    <SecretPromptContext.Provider value={value}>
      {children}
      <SecretPromptModal
        request={request}
        onClose={() => setRequest(null)}
        onResolved={() => {
          setRequest(null);
          // 只刷新列表，绝不跳转：用户可能正停在聊天页或别的设置页，
          // 把人强行送走比不刷新更糟。
          void refresh();
        }}
      />
    </SecretPromptContext.Provider>
  );
}

export function useSecretPrompt(): SecretPromptContextValue {
  const ctx = useContext(SecretPromptContext);
  // 聊天页只是「发完消息顺手催一下」，没有 Provider 也不该崩
  return ctx ?? { refresh: async () => undefined };
}
