import type { ReactNode } from "react";
import { toast as heroToast } from "@heroui/react";

/**
 * 应用内统一的轻提示，底层是 HeroUI Toast（main.tsx 里挂 <Toast.Provider />）。
 * 保留原先 sonner 风格的 success / error / message 调用方式，duration 对应 HeroUI 的 timeout。
 */
type ToastOptions = { duration?: number; description?: ReactNode };

const opts = (o?: ToastOptions) => ({
  ...(o?.duration != null ? { timeout: o.duration } : {}),
  ...(o?.description != null ? { description: o.description } : {}),
});

export const toast = {
  success: (message: ReactNode, o?: ToastOptions) => heroToast.success(message, opts(o)),
  error: (message: ReactNode, o?: ToastOptions) => heroToast.danger(message, opts(o)),
  warning: (message: ReactNode, o?: ToastOptions) => heroToast.warning(message, opts(o)),
  message: (message: ReactNode, o?: ToastOptions) => heroToast(message, opts(o)),
  dismiss: (id: string) => heroToast.close(id),
};
