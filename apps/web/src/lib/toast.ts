import type { ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

/**
 * 应用内统一的轻提示，底层是 Sonner（main.tsx 里挂 <Toaster />）。
 * 保留 success / error / warning / message 调用方式。
 */
type ToastOptions = { duration?: number; description?: ReactNode };

const opts = (o?: ToastOptions) => ({
  ...(o?.duration != null ? { duration: o.duration } : {}),
  ...(o?.description != null ? { description: o.description } : {}),
});

export const toast = {
  success: (message: ReactNode, o?: ToastOptions) => sonnerToast.success(message, opts(o)),
  error: (message: ReactNode, o?: ToastOptions) => sonnerToast.error(message, opts(o)),
  warning: (message: ReactNode, o?: ToastOptions) => sonnerToast.warning(message, opts(o)),
  message: (message: ReactNode, o?: ToastOptions) => sonnerToast(message, opts(o)),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};
