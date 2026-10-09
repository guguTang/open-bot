import { Button, Dialog } from "heroui-native";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { View } from "react-native";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作（删除、停止、重置）用红色强调 */
  destructive?: boolean;
};

type ConfirmResult = {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * 确认弹窗。
 *
 * 替代 Web 端的 `window.confirm`：RN 没有同步阻塞的原生确认框，
 * 所以这里把 confirm 包装成 Promise —— `await confirm({...})` 拿布尔值。
 *
 * 和 Web 端 `ConfirmProvider` 语义一致：所有破坏性操作都必须先过这里。
 */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<ConfirmResult | null>(null);
  // 用 ref 存 resolve：state 里放函数会让每次渲染都生成新对象，白白触发重渲染
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ options, resolve });
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  const destructive = pending?.options.destructive ?? false;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        isOpen={pending !== null}
        // 只允许通过按钮收尾：遮罩误触也要走「取消」，不能静默 resolve
        onOpenChange={(open: boolean) => !open && settle(false)}
      >
        <Dialog.Portal>
          <Dialog.Overlay isCloseOnPress>
            <Dialog.Content>
              <Dialog.Title>{pending?.options.title ?? ""}</Dialog.Title>
              {pending?.options.message ? (
                <Dialog.Description>{pending.options.message}</Dialog.Description>
              ) : null}
              <View className="mt-4 flex-row justify-end gap-3">
                <Button variant="secondary" size="sm" onPress={() => settle(false)}>
                  <Button.Label>{pending?.options.cancelLabel ?? "取消"}</Button.Label>
                </Button>
                <Button
                  variant={destructive ? "danger" : "primary"}
                  size="sm"
                  onPress={() => settle(true)}
                >
                  <Button.Label>{pending?.options.confirmLabel ?? "确定"}</Button.Label>
                </Button>
              </View>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm 必须在 ConfirmProvider 内使用");
  return ctx;
}
